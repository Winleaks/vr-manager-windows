-- Additive paged protocol; v1/v2 keep their installed-client behavior.
CREATE OR REPLACE FUNCTION public.hub_driver_cash_pending_v3(p_source uuid,p_after bigint DEFAULT 0,p_page_after bigint DEFAULT 0,p_through bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p_version integer:=2; items jsonb; watermark bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.billing_control WHERE sync_enabled AND writer_source_id=p_source) THEN
  RAISE EXCEPTION 'Wrong Writer' USING errcode='42501'; END IF;
 SELECT coalesce(max(sequence_id),0) INTO watermark FROM private.driver_cash_operations;
 watermark:=coalesce(p_through,watermark);
 IF p_page_after IS NULL OR p_page_after<0 OR watermark<0 OR p_page_after>watermark THEN RAISE EXCEPTION 'Invalid page' USING errcode='22023';END IF;
 IF p_after IS NULL OR p_after<0 OR p_version IS NULL OR p_version NOT IN (1,2) THEN RAISE EXCEPTION 'Invalid cursor or protocol' USING errcode='22023'; END IF;
 WITH associated AS (
  UPDATE private.driver_cash_receipts r SET company_id=a.company_id
  FROM public.client_store s CROSS JOIN LATERAL private.driver_cash_store_company(s.id) a
  WHERE r.company_id IS NULL AND s.id=r.store_id AND a.company_id IS NOT NULL AND a.association_error IS NULL
    AND (p_version=1 OR EXISTS(SELECT 1 FROM private.driver_cash_operations op WHERE op.root_operation_id=r.root_operation_id AND op.amount_pence>0))
  RETURNING r.root_operation_id,r.company_id
 ) INSERT INTO private.driver_cash_hub_events(operation_id,source_id,state,result)
  SELECT root_operation_id,p_source,'ASSOCIATED',jsonb_build_object('company_id',company_id,'association_source','store_or_owner') FROM associated;
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) INTO items FROM (
  SELECT op.sequence_id,op.state,op.operation_id,op.root_operation_id,op.previous_operation_id,op.revision,
   op.recorded_at_ms,op.amount_pence,op.hub_result,r.confirmed_at_ms AS collected_at_ms,r.driver_id,r.store_id,r.company_id,
   d.name AS driver_name,s.name AS store_name,
   coalesce(a.association_error,CASE WHEN r.company_id IS NOT NULL AND a.company_id IS DISTINCT FROM r.company_id
    THEN 'Asocierea încasării s-a modificat. Verifică legăturile din platformă.' END) AS association_error,
   private.driver_cash_association_retry_eligible(op.operation_id,p_source) AS recoverable_association,
   CASE WHEN p_version=2 AND op.amount_pence>0 AND op.revision>1 AND op.revision<=1001
      AND NOT EXISTS(SELECT 1 FROM private.driver_cash_operations earlier
       WHERE earlier.root_operation_id=op.root_operation_id AND earlier.revision<op.revision AND earlier.amount_pence>0)
    THEN (SELECT jsonb_agg(jsonb_build_object('operation_id',z.operation_id,'previous_operation_id',z.previous_operation_id,
     'revision',z.revision,'recorded_at_ms',z.recorded_at_ms,'amount_pence',z.amount_pence) ORDER BY z.revision)
     FROM private.driver_cash_operations z WHERE z.root_operation_id=op.root_operation_id AND z.revision<op.revision)
    ELSE NULL END AS zero_prefix
  FROM private.driver_cash_operations op JOIN private.driver_cash_receipts r USING(root_operation_id)
  JOIN public.drivers d ON d.id=r.driver_id JOIN public.client_store s ON s.id=r.store_id
  CROSS JOIN LATERAL private.driver_cash_store_company(s.id) a
  WHERE (p_version=1 OR op.amount_pence>0 OR EXISTS(SELECT 1 FROM private.driver_cash_operations earlier
    WHERE earlier.root_operation_id=op.root_operation_id AND earlier.revision<op.revision AND earlier.amount_pence>0))
   AND (op.sequence_id>p_after OR op.state='PENDING' OR (op.state='CONFLICT' AND (
    op.hub_result->>'error'='Compania nu este disponibilă în facturarea normală. Verifică asocierea încasării.' OR
    private.driver_cash_association_retry_eligible(op.operation_id,p_source))))
   AND op.sequence_id>p_page_after AND op.sequence_id<=watermark
  ORDER BY op.sequence_id LIMIT 51
 ) q;
 RETURN jsonb_build_object('protocol_version',3,'through',watermark,'has_more',jsonb_array_length(items)>50,
  'next_page_after',coalesce((items->(least(jsonb_array_length(items),50)-1)->>'sequence_id')::bigint,p_page_after),
  'items',(SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(items) WITH ORDINALITY a(value,ord) WHERE ord<=50));
END $$;

REVOKE ALL ON FUNCTION public.hub_driver_cash_pending_v3(uuid,bigint,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hub_driver_cash_pending_v3(uuid,bigint,bigint,bigint) TO service_role;

CREATE FUNCTION public.hub_driver_cash_queue_status(p_source uuid,p_after bigint DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.billing_control WHERE sync_enabled AND writer_source_id=p_source) THEN
  RAISE EXCEPTION 'Wrong Writer' USING errcode='42501'; END IF;
 IF p_after IS NULL OR p_after<0 THEN RAISE EXCEPTION 'Invalid cursor' USING errcode='22023';END IF;
 RETURN (SELECT jsonb_build_object('protocol_version',3,'latest_sequence',coalesce(max(op.sequence_id),0),
  'has_work',coalesce(bool_or(op.sequence_id>p_after OR op.state='PENDING' OR (op.state='CONFLICT' AND (
   op.hub_result->>'error'='Compania nu este disponibilă în facturarea normală. Verifică asocierea încasării.' OR
   private.driver_cash_association_retry_eligible(op.operation_id,p_source)))),false))
  FROM private.driver_cash_operations op WHERE op.amount_pence>0 OR EXISTS(
   SELECT 1 FROM private.driver_cash_operations previous WHERE previous.root_operation_id=op.root_operation_id
    AND previous.revision<op.revision AND previous.amount_pence>0));
END $$;
REVOKE ALL ON FUNCTION public.hub_driver_cash_queue_status(uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hub_driver_cash_queue_status(uuid,bigint) TO service_role;

-- Atomically establish the review conflict and release it. This also covers a
-- Writer crash after storing the conflict locally but before acknowledging it.
CREATE FUNCTION public.hub_retry_driver_cash_review(p_source uuid,p_operation_id uuid,p_result jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old private.driver_cash_operations%rowtype;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.billing_control WHERE sync_enabled AND writer_source_id=p_source) THEN
  RAISE EXCEPTION 'Wrong Writer' USING errcode='42501';END IF;
 IF p_result->>'error' IS DISTINCT FROM 'Posibilă încasare introdusă manual. Verifică înainte de import.' THEN
  RAISE EXCEPTION 'Invalid review' USING errcode='22023';END IF;
 SELECT * INTO old FROM private.driver_cash_operations WHERE operation_id=p_operation_id FOR UPDATE;
 IF NOT FOUND OR old.state='PROCESSED' THEN RAISE EXCEPTION 'Review changed' USING errcode='PT409';END IF;
 IF old.state='PENDING' AND EXISTS(SELECT 1 FROM private.driver_cash_hub_events WHERE operation_id=p_operation_id AND source_id=p_source AND state='RETRY') THEN RETURN true;END IF;
 IF old.state='PENDING' THEN PERFORM public.hub_driver_cash_ack_v2(p_source,p_operation_id,'CONFLICT',p_result);
 ELSIF old.hub_result IS DISTINCT FROM p_result THEN RAISE EXCEPTION 'Review changed' USING errcode='PT409';END IF;
 RETURN public.hub_retry_driver_cash(p_source,p_operation_id);
END $$;
REVOKE ALL ON FUNCTION public.hub_retry_driver_cash_review(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hub_retry_driver_cash_review(uuid,uuid,jsonb) TO service_role;
