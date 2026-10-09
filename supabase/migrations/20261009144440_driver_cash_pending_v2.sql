-- Resolve the same authoritative store/owner foreign keys as the entity export.
-- No names, activation status, financial state resets, or new companies.
CREATE OR REPLACE FUNCTION private.driver_cash_store_company(p_store uuid)
RETURNS TABLE(company_id uuid,association_error text)
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(s.client_company_id,p.client_company_id),
 CASE WHEN (s.owner_id IS NOT NULL AND p.id IS NULL)
   OR (s.client_company_id IS NOT NULL AND direct.id IS NULL)
   OR (p.client_company_id IS NOT NULL AND inherited.id IS NULL)
   OR (s.client_company_id IS NOT NULL AND p.client_company_id IS NOT NULL AND s.client_company_id<>p.client_company_id)
 THEN 'Asocierea magazinului și companiei este contradictorie. Verifică legăturile din platformă.' END
 FROM public.client_store s LEFT JOIN public.profiles p ON p.id=s.owner_id
 LEFT JOIN public.client_company direct ON direct.id=s.client_company_id
 LEFT JOIN public.client_company inherited ON inherited.id=p.client_company_id WHERE s.id=p_store;
$$;
REVOKE ALL ON FUNCTION private.driver_cash_store_company(uuid) FROM PUBLIC,anon,authenticated;

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
   (((op.state='CONFLICT' AND op.hub_result->>'error'='Asocierea magazinului, companiei sau emitentului necesită verificare.'
      AND op.hub_result->>'company_id' IS NULL)
     OR (op.state='PENDING' AND EXISTS(SELECT 1 FROM private.driver_cash_hub_events retry
      WHERE retry.operation_id=op.operation_id AND retry.source_id=p_source AND retry.state='RETRY'
      AND retry.result->>'error'='Asocierea magazinului, companiei sau emitentului necesită verificare.'
      AND retry.result->>'company_id' IS NULL)))
    AND r.company_id IS NOT NULL AND a.association_error IS NULL
    AND a.company_id=r.company_id AND NOT EXISTS(SELECT 1 FROM private.driver_cash_operations done
      WHERE done.root_operation_id=op.root_operation_id AND done.state='PROCESSED' AND done.amount_pence>0)) IS TRUE AS recoverable_association,
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
    (op.hub_result->>'error'='Asocierea magazinului, companiei sau emitentului necesită verificare.' AND op.hub_result->>'company_id' IS NULL))))
  ORDER BY op.sequence_id LIMIT 50
 ) q),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION private.hub_driver_cash_pending_contract(uuid,bigint,integer) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.hub_driver_cash_pending(p_source uuid,p_after bigint DEFAULT 0)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT private.hub_driver_cash_pending_contract(p_source,p_after,1);
$$;
CREATE OR REPLACE FUNCTION public.hub_driver_cash_pending_v2(p_source uuid,p_after bigint DEFAULT 0)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT private.hub_driver_cash_pending_contract(p_source,p_after,2);
$$;
CREATE OR REPLACE FUNCTION public.hub_driver_cash_ack_v2(p_source uuid, p_operation_id uuid, p_state text, p_result jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old private.driver_cash_operations%rowtype;
begin
 if not exists(select 1 from public.billing_control where sync_enabled and writer_source_id=p_source) then raise exception 'Wrong Writer' using errcode='42501';end if;
 if p_state is null or p_state not in ('PROCESSED','CONFLICT') or jsonb_typeof(p_result) is distinct from 'object' then raise exception 'Invalid acknowledgment' using errcode='22023';end if;
 select * into old from private.driver_cash_operations where operation_id=p_operation_id for update;
 if not found then raise exception 'Unknown operation' using errcode='22023';end if;
 if old.state<>'PENDING' then
  if old.state<>p_state or old.hub_result<>p_result then raise exception 'Conflicting acknowledgment' using errcode='PT409';end if;
  return true;
 end if;
 if p_state='PROCESSED' and old.previous_operation_id is not null and not exists(select 1 from private.driver_cash_operations where operation_id=old.previous_operation_id and state='PROCESSED')
 and not (old.amount_pence>0 and old.revision<=1001 and
  (select count(*)=old.revision-1 and bool_and(z.amount_pence=0 and z.revision=z.ordinal and
    z.previous_operation_id is not distinct from z.expected_previous)
   from (select op.*,row_number() over(order by revision) ordinal,lag(operation_id) over(order by revision) expected_previous
    from private.driver_cash_operations op where root_operation_id=old.root_operation_id and revision<old.revision) z)
  and (select operation_id from private.driver_cash_operations where root_operation_id=old.root_operation_id and revision=old.revision-1)=old.previous_operation_id)
 then raise exception 'Preceding cash operation not processed' using errcode='PT409';end if;
 insert into private.driver_cash_hub_events(operation_id,source_id,state,result) values(p_operation_id,p_source,p_state,p_result);
 update private.driver_cash_operations set state=p_state,hub_result=p_result where operation_id=p_operation_id;
 if p_state='CONFLICT' then
  update private.driver_cash_operations set state='CONFLICT',hub_result=jsonb_build_object('error','Preceding receipt requires office review')
   where root_operation_id=old.root_operation_id and revision>old.revision and state='PENDING';
 end if;
 return true;
end $function$
;

REVOKE ALL ON FUNCTION public.hub_driver_cash_pending(uuid,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hub_driver_cash_pending_v2(uuid,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hub_driver_cash_ack_v2(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hub_driver_cash_pending(uuid,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_driver_cash_pending_v2(uuid,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.hub_driver_cash_ack_v2(uuid,uuid,text,jsonb) TO service_role;
