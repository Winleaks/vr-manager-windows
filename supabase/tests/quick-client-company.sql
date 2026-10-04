-- Run on a database containing at least one linked client. Always rolls back.
BEGIN;
DO $$
DECLARE profile_id uuid; original_company uuid; again uuid; before_count bigint;
BEGIN
  SELECT p.id,p.client_company_id INTO STRICT profile_id,original_company
    FROM public.profiles p WHERE p.client_company_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=p.id AND r.role='client') LIMIT 1;
  SELECT count(*) INTO before_count FROM public.client_company;
  again := public.ensure_quick_client_company(profile_id);
  IF again<>original_company OR (SELECT count(*) FROM public.client_company)<>before_count THEN
    RAISE EXCEPTION 'Idempotent company linking failed';
  END IF;
  IF has_function_privilege('authenticated','public.ensure_quick_client_company(uuid)','EXECUTE') OR
     has_function_privilege('anon','public.ensure_quick_client_company(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Untrusted role can repair companies';
  END IF;
  -- Hide only the selected profile's links inside this rollback-only test.
  UPDATE public.client_store SET client_company_id=NULL WHERE owner_id=profile_id;
  UPDATE public.profiles SET client_company_id=NULL,company_name=(SELECT name FROM public.client_company WHERE id=original_company) WHERE id=profile_id;
  BEGIN
    PERFORM public.ensure_quick_client_company(profile_id);
    RAISE EXCEPTION 'Duplicate-name guard failed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Company name already exists%' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.client_company)<>before_count THEN RAISE EXCEPTION 'Duplicate company created'; END IF;
END;
$$;
ROLLBACK;
