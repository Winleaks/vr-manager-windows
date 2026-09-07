-- Requires the existing billing publication + credit settlement migrations.
-- Change only the association predicate in the installed function; preserve all
-- newer settlement, Writer, revision, tombstone, privilege and RLS behavior.
-- No store/profile/invoice is reassigned or backfilled by this migration.
DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.billing_commit(uuid,uuid,bigint)'::regprocedure);
  previous_predicate text := 'not exists(select 1 from public.client_store where id=(item->>''store_id'')::uuid and client_company_id=p_company)';
  resolved_predicate text := 'not exists(
     select 1 from public.client_store s
     left join public.profiles owner_profile on owner_profile.id=s.owner_id
     where s.id=(item->>''store_id'')::uuid
       and coalesce(s.client_company_id,owner_profile.client_company_id)=p_company
       and (s.client_company_id is null or owner_profile.client_company_id is null
            or s.client_company_id=owner_profile.client_company_id)
   )';
BEGIN
  IF strpos(definition, resolved_predicate)>0 AND strpos(definition, previous_predicate)=0 THEN
    RETURN; -- already installed
  END IF;
  IF (length(definition)-length(replace(definition,previous_predicate,'')))<>length(previous_predicate) THEN
    RAISE EXCEPTION 'billing_commit association predicate changed; review the current function before migration';
  END IF;
  EXECUTE replace(definition,previous_predicate,resolved_predicate);
END $migration$;
