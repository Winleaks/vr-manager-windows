-- Isolated PostgreSQL only: run after billing fixtures and all billing migrations.
BEGIN;
ALTER TABLE public.client_store ADD COLUMN IF NOT EXISTS owner_id uuid;
INSERT INTO public.client_company(id,name) VALUES
 ('11111111-1111-4111-8111-111111111111','Company A'),
 ('22222222-2222-4222-8222-222222222222','Company B');
INSERT INTO public.profiles(id,active,activated,client_company_id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false,false,'11111111-1111-4111-8111-111111111111'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true,true,'22222222-2222-4222-8222-222222222222');
INSERT INTO public.client_store(id,client_company_id,name,owner_id) VALUES
 ('33333333-3333-4333-8333-333333333333',null,'Owner-only store','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','Direct store',null),
 ('66666666-6666-4666-8666-666666666666',null,'No company',null),
 ('77777777-7777-4777-8777-777777777777','22222222-2222-4222-8222-222222222222','Conflicting store','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
UPDATE public.billing_control SET sync_enabled=true,client_enabled=true,activated_at=now(),writer_source_id='55555555-5555-4555-8555-555555555555';

-- Neither owner activity nor client login is required for Writer publication.
SELECT public.billing_stage('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111',1,0,1,500,
 '[{"id":"1","store_id":"33333333-3333-4333-8333-333333333333","number":"A-1","date":"2026-09-01","total":10000,"paid":2000,"credited":1000,"applied_credit":500},
   {"id":"2","store_id":"44444444-4444-4444-8444-444444444444","number":"A-2","date":"2026-09-01","total":5000,"paid":0,"cancelled":true}]','[]');
SELECT public.billing_commit('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111',1);
SELECT public.billing_commit('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111',1);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.billing_invoices)<>2
    OR (SELECT outstanding FROM public.billing_accounts)<>6500
    OR (SELECT credit FROM public.billing_accounts)<>500 THEN RAISE EXCEPTION 'Settlement or idempotency regression'; END IF;
 IF (SELECT client_company_id FROM public.client_store WHERE id='33333333-3333-4333-8333-333333333333') IS NOT NULL
    OR (SELECT active FROM public.profiles WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') THEN RAISE EXCEPTION 'Source association/login was mutated'; END IF;
 IF has_function_privilege('authenticated','public.billing_commit(uuid,uuid,bigint)','execute')
    OR has_function_privilege('anon','public.billing_commit(uuid,uuid,bigint)','execute') THEN RAISE EXCEPTION 'Publication privilege widened'; END IF;
END $$;

-- SQL ownership checks must agree with export resolution and reject ambiguity.
DO $$ DECLARE target uuid; shop uuid; rev bigint:=10; BEGIN
 FOR target,shop IN SELECT * FROM (VALUES
   ('22222222-2222-4222-8222-222222222222'::uuid,'33333333-3333-4333-8333-333333333333'::uuid),
   ('11111111-1111-4111-8111-111111111111'::uuid,'66666666-6666-4666-8666-666666666666'::uuid),
   ('11111111-1111-4111-8111-111111111111'::uuid,'77777777-7777-4777-8777-777777777777'::uuid),
   ('22222222-2222-4222-8222-222222222222'::uuid,'77777777-7777-4777-8777-777777777777'::uuid)
 ) AS cases(company_id,store_id) LOOP
   PERFORM public.billing_stage('55555555-5555-4555-8555-555555555555',target,rev,0,1,0,
     jsonb_build_array(jsonb_build_object('id','3','store_id',shop,'number','X-3','date','2026-09-01','total',1000,'paid',0)),'[]');
   BEGIN
     PERFORM public.billing_commit('55555555-5555-4555-8555-555555555555',target,rev);
     RAISE EXCEPTION 'Expected association rejection';
   EXCEPTION WHEN OTHERS THEN
     IF SQLERRM<>'Invalid invoice or store association' THEN RAISE; END IF;
   END;
   rev:=rev+1;
 END LOOP;
 IF (SELECT count(*) FROM public.billing_invoices)<>2 OR (SELECT outstanding FROM public.billing_accounts)<>6500 THEN
   RAISE EXCEPTION 'Failed association partially changed financial data';
 END IF;
END $$;

-- Company scoping and inactive-client denial are unchanged after owner resolution.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
DO $$ BEGIN IF (SELECT count(*) FROM public.billing_invoices)<>0 THEN RAISE EXCEPTION 'Inactive client gained visibility'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
DO $$ BEGIN IF (SELECT count(*) FROM public.billing_invoices)<>0 THEN RAISE EXCEPTION 'Other company gained visibility'; END IF; END $$;
RESET ROLE;
UPDATE public.profiles SET active=true,activated=true WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
DO $$ BEGIN IF (SELECT count(*) FROM public.billing_invoices)<>2 THEN RAISE EXCEPTION 'Own company invoices unavailable'; END IF; END $$;
RESET ROLE;
ROLLBACK;
