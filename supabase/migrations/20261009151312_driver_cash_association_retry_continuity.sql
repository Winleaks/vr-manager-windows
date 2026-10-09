-- Older Hubs can reject a pending retry when the formerly null company is filled.
-- Resume only that audited, unfunded identity enrichment; real altered requests
-- still require canonical validation and absence of money in the local Writer.
CREATE OR REPLACE FUNCTION private.driver_cash_association_retry_eligible(p_operation uuid,p_source uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce((
  SELECT (
   (op.state='CONFLICT' AND (
    (op.hub_result->>'error'='Asocierea magazinului, companiei sau emitentului necesită verificare.' AND op.hub_result->>'company_id' IS NULL)
    OR (op.hub_result->>'error'='Operație retrimisă cu alte date.' AND op.hub_result->>'company_id'=r.company_id::text
     AND EXISTS(SELECT 1 FROM private.driver_cash_hub_events initial WHERE initial.operation_id=op.operation_id
      AND initial.source_id=p_source AND initial.state IN ('CONFLICT','RETRY')
      AND initial.result->>'error'='Asocierea magazinului, companiei sau emitentului necesită verificare.' AND initial.result->>'company_id' IS NULL)
     AND EXISTS(SELECT 1 FROM private.driver_cash_hub_events associated WHERE associated.operation_id=r.root_operation_id
      AND associated.source_id=p_source AND associated.state='ASSOCIATED' AND associated.result->>'company_id'=r.company_id::text))))
   OR (op.state='PENDING' AND EXISTS(SELECT 1 FROM private.driver_cash_hub_events retry WHERE retry.operation_id=op.operation_id
    AND retry.source_id=p_source AND retry.state='RETRY'
    AND retry.result->>'error'='Asocierea magazinului, companiei sau emitentului necesită verificare.' AND retry.result->>'company_id' IS NULL))
  ) AND r.company_id IS NOT NULL AND a.association_error IS NULL AND a.company_id=r.company_id
   AND NOT EXISTS(SELECT 1 FROM private.driver_cash_operations done WHERE done.root_operation_id=op.root_operation_id
    AND done.state='PROCESSED' AND done.amount_pence>0)
  FROM private.driver_cash_operations op JOIN private.driver_cash_receipts r USING(root_operation_id)
   CROSS JOIN LATERAL private.driver_cash_store_company(r.store_id) a WHERE op.operation_id=p_operation
 ),false);
$$;
REVOKE ALL ON FUNCTION private.driver_cash_association_retry_eligible(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.hub_driver_cash_pending_contract(p_source uuid,p_after bigint,p_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.billing_control WHERE sync_enabled AND writer_source_id=p_source) THEN
  RAISE EXCEPTION 'Wrong Writer' USING errcode='42501'; END IF;
 IF p_after IS NULL OR p_after<0 OR p_version IS NULL OR p_version NOT IN (1,2) THEN RAISE EXCEPTION 'Invalid cursor or protocol' USING errcode='22023'; END IF;
 WITH associated AS (
  UPDATE private.driver_cash_receipts r SET company_id=a.company_id
  FROM public.client_store s CROSS JOIN LATERAL private.driver_cash_store_company(s.id) a
  WHERE r.company_id IS NULL AND s.id=r.store_id AND a.company_id IS NOT NULL AND a.association_error IS NULL
    AND (p_version=1 OR EXISTS(SELECT 1 FROM private.driver_cash_operations op WHERE op.root_operation_id=r.root_operation_id AND op.amount_pence>0))
  RETURNING r.root_operation_id,r.company_id
 ) INSERT INTO private.driver_cash_hub_events(operation_id,source_id,state,result)
  SELECT root_operation_id,p_source,'ASSOCIATED',jsonb_build_object('company_id',company_id,'association_source','store_or_owner') FROM associated;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (
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
  ORDER BY op.sequence_id LIMIT 50
 ) q),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION private.hub_driver_cash_pending_contract(uuid,bigint,integer) FROM PUBLIC,anon,authenticated;
