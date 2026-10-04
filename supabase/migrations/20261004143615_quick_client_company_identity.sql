-- Service-only, atomic repair/creation by authoritative profile identity.
-- No company is selected by display name. Ambiguous existing names stop creation.
CREATE OR REPLACE FUNCTION public.ensure_quick_client_company(p_profile_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  p public.profiles%ROWTYPE;
  company_id uuid;
  store_companies uuid[];
BEGIN
  SELECT * INTO STRICT p FROM public.profiles WHERE id=p_profile_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p.id AND role='client') THEN
    RAISE EXCEPTION 'Profile is not a client';
  END IF;
  SELECT array_agg(DISTINCT s.client_company_id) FILTER(WHERE s.client_company_id IS NOT NULL)
    INTO store_companies FROM public.client_store s WHERE s.owner_id=p.id;
  company_id := p.client_company_id;
  IF cardinality(store_companies)>1 OR
    (company_id IS NOT NULL AND cardinality(store_companies)>0 AND store_companies[1]<>company_id) THEN
    RAISE EXCEPTION 'Conflicting store company associations';
  END IF;
  company_id := coalesce(company_id,store_companies[1]);
  IF company_id IS NULL THEN
    IF nullif(trim(p.company_name),'') IS NULL THEN RAISE EXCEPTION 'Company name required'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(lower(trim(p.company_name)),0));
    IF EXISTS(SELECT 1 FROM public.client_company c WHERE lower(trim(c.name))=lower(trim(p.company_name))) THEN
      RAISE EXCEPTION 'Company name already exists; verify identity before linking';
    END IF;
    INSERT INTO public.client_company(name,address,phone,email,contact_person,discount_percent,active)
      VALUES(p.company_name,p.company_address,p.company_phone,p.email,p.full_name,coalesce(p.discount_percent,0),p.active)
      RETURNING id INTO company_id;
  END IF;
  IF p.client_company_id IS DISTINCT FROM company_id THEN
    UPDATE public.profiles SET client_company_id=company_id WHERE id=p.id;
  END IF;
  RETURN company_id;
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_quick_client_company(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_quick_client_company(uuid) TO service_role;
