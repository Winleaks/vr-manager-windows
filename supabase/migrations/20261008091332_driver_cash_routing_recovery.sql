-- Compatible with existing Drivers and Hub clients. No receipt/amount is deleted or rewritten.
CREATE OR REPLACE FUNCTION public.hub_driver_cash_pending(p_source uuid, p_after bigint DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.billing_control WHERE sync_enabled AND writer_source_id=p_source) THEN
  RAISE EXCEPTION 'Wrong Writer' USING errcode='42501';
 END IF;
 IF p_after IS NULL OR p_after<0 THEN RAISE EXCEPTION 'Invalid cursor' USING errcode='22023';END IF;
 WITH associated AS (
  UPDATE private.driver_cash_receipts r SET company_id=s.client_company_id FROM public.client_store s
   WHERE r.company_id IS NULL AND s.id=r.store_id AND s.client_company_id IS NOT NULL
   RETURNING r.root_operation_id,r.company_id
 ) INSERT INTO private.driver_cash_hub_events(operation_id,source_id,state,result)
  SELECT root_operation_id,p_source,'ASSOCIATED',jsonb_build_object('company_id',company_id) FROM associated;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (
  SELECT op.sequence_id,op.state,op.operation_id,op.root_operation_id,op.previous_operation_id,op.revision,
   op.recorded_at_ms,op.amount_pence,op.hub_result,r.confirmed_at_ms AS collected_at_ms,r.driver_id,r.store_id,r.company_id,
   d.name AS driver_name,s.name AS store_name
  FROM private.driver_cash_operations op JOIN private.driver_cash_receipts r USING(root_operation_id)
  JOIN public.drivers d ON d.id=r.driver_id JOIN public.client_store s ON s.id=r.store_id
  WHERE op.sequence_id>p_after OR op.state='PENDING' OR (op.state='CONFLICT' AND
    op.hub_result->>'error'='Compania nu este disponibilă în facturarea normală. Verifică asocierea încasării.')
  ORDER BY op.sequence_id LIMIT 50
 ) q),'[]'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION public.hub_retry_driver_cash(p_source uuid,p_operation_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE old private.driver_cash_operations%rowtype;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.billing_control WHERE sync_enabled AND writer_source_id=p_source) THEN
  RAISE EXCEPTION 'Wrong Writer' USING errcode='42501';
 END IF;
 SELECT * INTO old FROM private.driver_cash_operations WHERE operation_id=p_operation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cash conflict cannot be retried' USING errcode='PT409';END IF;
 -- The previous request may have committed before its response reached Hub.
 IF old.state='PENDING' AND EXISTS(SELECT 1 FROM private.driver_cash_hub_events
    WHERE operation_id=p_operation_id AND source_id=p_source AND state='RETRY') THEN RETURN true;END IF;
 IF old.state<>'CONFLICT' OR EXISTS(SELECT 1 FROM private.driver_cash_operations
    WHERE root_operation_id=old.root_operation_id AND revision>old.revision AND state='PROCESSED') THEN
  RAISE EXCEPTION 'Cash conflict cannot be retried' USING errcode='PT409';
 END IF;
 INSERT INTO private.driver_cash_hub_events(operation_id,source_id,state,result) VALUES(p_operation_id,p_source,'RETRY',old.hub_result);
 UPDATE private.driver_cash_operations SET state='PENDING',hub_result=null
  WHERE root_operation_id=old.root_operation_id AND revision>=old.revision AND state='CONFLICT';
 RETURN true;
END $function$;

REVOKE ALL ON FUNCTION public.hub_driver_cash_pending(uuid,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hub_retry_driver_cash(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hub_driver_cash_pending(uuid,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_retry_driver_cash(uuid,uuid) TO service_role;
