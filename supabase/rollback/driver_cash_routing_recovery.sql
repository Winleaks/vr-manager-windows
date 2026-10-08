-- Containment only: revert receiver functions, retaining every financial record and audit event.
CREATE OR REPLACE FUNCTION public.hub_driver_cash_pending(p_source uuid, p_after bigint DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not exists(select 1 from public.billing_control where sync_enabled and writer_source_id=p_source) then raise exception 'Wrong Writer' using errcode='42501';end if;
 if p_after is null or p_after<0 then raise exception 'Invalid cursor' using errcode='22023';end if;
 -- A missing company keeps the declaration durable but blocks financial processing.
 -- Pin the explicit platform association when it becomes available; never use names.
 with associated as (
  update private.driver_cash_receipts r set company_id=s.client_company_id from public.client_store s
   where r.company_id is null and s.id=r.store_id and s.client_company_id is not null
   returning r.root_operation_id,r.company_id
 ) insert into private.driver_cash_hub_events(operation_id,source_id,state,result)
   select root_operation_id,p_source,'ASSOCIATED',jsonb_build_object('company_id',company_id) from associated;
 return coalesce((select jsonb_agg(to_jsonb(q)) from (
  select op.sequence_id,op.state,op.operation_id,op.root_operation_id,op.previous_operation_id,op.revision,op.recorded_at_ms,op.amount_pence,r.confirmed_at_ms AS collected_at_ms,r.driver_id,r.store_id,r.company_id,
  d.name as driver_name,s.name as store_name from private.driver_cash_operations op join private.driver_cash_receipts r using(root_operation_id)
  join public.drivers d on d.id=r.driver_id join public.client_store s on s.id=r.store_id
  where (op.sequence_id>p_after or op.state='PENDING') order by op.sequence_id limit 50
 ) q),'[]'::jsonb);
end $function$
;
CREATE OR REPLACE FUNCTION public.hub_retry_driver_cash(p_source uuid, p_operation_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old private.driver_cash_operations%rowtype;
begin
 if not exists(select 1 from public.billing_control where sync_enabled and writer_source_id=p_source) then raise exception 'Wrong Writer' using errcode='42501';end if;
 select * into old from private.driver_cash_operations where operation_id=p_operation_id for update;
 if not found or old.state<>'CONFLICT' or exists(select 1 from private.driver_cash_operations where root_operation_id=old.root_operation_id and revision>old.revision and state='PROCESSED') then raise exception 'Cash conflict cannot be retried' using errcode='PT409';end if;
 insert into private.driver_cash_hub_events(operation_id,source_id,state,result) values(p_operation_id,p_source,'RETRY',old.hub_result);
 update private.driver_cash_operations set state='PENDING',hub_result=null where root_operation_id=old.root_operation_id and revision>=old.revision and state='CONFLICT';
 return true;
end $function$
;
