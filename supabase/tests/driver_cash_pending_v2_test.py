"""Run only against a disposable local Postgres: python3 <file> <port> --disposable."""
import json, os, subprocess, sys, uuid
from pathlib import Path
port=int(sys.argv[1]); assert sys.argv[2]=='--disposable' and 1024<port<65536
pg=Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin'))
db='cash_v2_test_'+uuid.uuid4().hex[:10]; common=['-h','127.0.0.1','-p',str(port),'-U','postgres']
subprocess.run([str(pg/'createdb'),*common,db],check=True,capture_output=True)
args=[str(pg/'psql'),*common,'-d',db,'-XqAt','-v','ON_ERROR_STOP=1']
def sql(s,ok=True):
 p=subprocess.run(args,input=s,text=True,capture_output=True)
 if ok and p.returncode: raise AssertionError(p.stderr)
 return p

def value(s):return json.loads(sql('select '+s+';').stdout.strip())
def uid():return str(uuid.uuid4())
writer,company,other,owner,store,driver=[uid() for _ in range(6)]
try:
 sql('''
 do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end $$;
 create schema private;
 create table public.billing_control(sync_enabled boolean,writer_source_id uuid);
 create table public.client_company(id uuid primary key);
 create table public.profiles(id uuid primary key,client_company_id uuid references client_company);
 create table public.client_store(id uuid primary key,name text,owner_id uuid references profiles,client_company_id uuid references client_company);
 create table public.drivers(id uuid primary key,name text);
 create table private.driver_cash_receipts(root_operation_id uuid primary key,confirmed_at_ms bigint,driver_id uuid,store_id uuid,company_id uuid);
 create table private.driver_cash_operations(sequence_id bigint generated always as identity,operation_id uuid primary key,
 root_operation_id uuid references private.driver_cash_receipts,previous_operation_id uuid,revision int,recorded_at_ms bigint,
 amount_pence bigint,state text default 'PENDING',hub_result jsonb,unique(root_operation_id,revision));
 create table private.driver_cash_hub_events(operation_id uuid,source_id uuid,state text,result jsonb);
 '''+f"insert into billing_control values(true,'{writer}');insert into client_company values('{company}'),('{other}');"+
 f"insert into profiles values('{owner}','{company}');insert into client_store values('{store}','Store','{owner}',null);insert into drivers values('{driver}','Driver');")
 base=Path(__file__).resolve().parents[1]
 sql((base/'migrations/20261008091332_driver_cash_routing_recovery.sql').read_text())
 sql((base/'migrations/20261009144440_driver_cash_pending_v2.sql').read_text())
 sql((base/'migrations/20261009151312_driver_cash_association_retry_continuity.sql').read_text())
 def pending(v=2,after=0):return value(f"public.hub_driver_cash_pending{'_v2' if v==2 else ''}('{writer}',{after})")
 def receipt(amount=0,revision=1,root=None,previous=None,state='PENDING',result=None):
  op=uid(); root=root or op
  if revision==1:sql(f"insert into private.driver_cash_receipts values('{root}',1791532800000,'{driver}','{store}',null);")
  resultsql="null" if result is None else "'"+json.dumps(result).replace("'","''")+"'::jsonb"
  prev="null" if previous is None else f"'{previous}'"
  sql(f"insert into private.driver_cash_operations(operation_id,root_operation_id,previous_operation_id,revision,recorded_at_ms,amount_pence,state,hub_result) values('{op}','{root}',{prev},{revision},1791532800000+{revision*1000},{amount},'{state}',{resultsql});")
  return op
 zero=receipt();assert pending()==[]
 assert sql('select count(*) from private.driver_cash_hub_events;').stdout.strip()=='0'
 assert len(pending(1))==1 # legacy zero behavior remains.
 positive=receipt(1200,2,zero,zero);q=pending();assert len(q)==1 and q[0]['operation_id']==positive
 assert q[0]['company_id']==company and q[0]['zero_prefix'][0]['operation_id']==zero
 def ack(op,state='PROCESSED',result=None,writer_id=writer):
  body=json.dumps(result or {'revision':2});return f"public.hub_driver_cash_ack_v2('{writer_id}','{op}','{state}','{body}'::jsonb)"
 assert sql('select '+ack(positive)+';').stdout.strip()=='t'
 assert sql('select '+ack(positive)+';').stdout.strip()=='t'
 assert sql(f"select state from private.driver_cash_operations where operation_id='{zero}';").stdout.strip()=='PENDING'
 cancel=receipt(0,3,zero,positive);assert cancel in [x['operation_id'] for x in pending()]
 assert sql('select '+ack(cancel,result={'revision':3})+';').stdout.strip()=='t'
 assert pending(after=10000)==[]
 # A missing processed financial predecessor cannot be bypassed.
 unpaid=receipt(500);later=receipt(600,2,unpaid,unpaid)
 assert sql('select '+ack(later)+';',False).returncode!=0
 # Both direct and owner foreign keys are accepted; disagreement fails closed per root.
 sql(f"update client_store set client_company_id='{other}' where id='{store}';")
 assert all(x['association_error'] for x in pending())
 assert sql(f"select count(*) from private.driver_cash_receipts where company_id='{other}';").stdout.strip()=='0'
 sql(f"update client_store set client_company_id=null where id='{store}';")
 # A previously missing company conflict is offered even behind the cursor, audited without financial reset.
 error='Asocierea magazinului, companiei sau emitentului necesită verificare.'
 blocked=receipt(800,state='CONFLICT',result={'error':error,'company_id':None})
 conflict=next(x for x in pending(after=10000) if x['operation_id']==blocked)
 assert conflict['recoverable_association'] is True and conflict['company_id']==company and conflict['state']=='CONFLICT'
 assert sql(f"select count(*) from private.driver_cash_hub_events where operation_id='{blocked}' and state='ASSOCIATED';").stdout.strip()=='1'
 pending();assert sql(f"select count(*) from private.driver_cash_hub_events where operation_id='{blocked}' and state='ASSOCIATED';").stdout.strip()=='1'
 # Preserve the original missing-company event before the accepted retry.
 sql(f"insert into private.driver_cash_hub_events values('{blocked}','{writer}','CONFLICT','{json.dumps({'error':error,'company_id':None})}'::jsonb);")
 assert sql(f"select public.hub_retry_driver_cash('{writer}','{blocked}');").stdout.strip()=='t'
 assert next(x for x in pending(after=10000) if x['operation_id']==blocked)['recoverable_association'] is True
 # Installed v1 Hub may reject the enriched identity during this pending retry.
 replay={'error':'Operație retrimisă cu alte date.','company_id':company}
 assert sql('select '+ack(blocked,'CONFLICT',replay)+';').stdout.strip()=='t'
 assert next(x for x in pending(after=10000) if x['operation_id']==blocked)['recoverable_association'] is True
 assert sql(f"select public.hub_retry_driver_cash('{writer}','{blocked}');").stdout.strip()=='t'
 assert sql('select '+ack(blocked)+';').stdout.strip()=='t'
 unproven=receipt(600,state='CONFLICT',result=replay)
 assert unproven not in [x['operation_id'] for x in pending(after=10000)]
 # Server rejects wrong Writer and all direct client roles.
 assert sql('select '+ack(unpaid,writer_id=uid())+';',False).returncode!=0
 assert sql(f"select public.hub_driver_cash_pending_v2('{uid()}');",False).returncode!=0
 for role in ('anon','authenticated'):
  assert sql(f"set role {role};select public.hub_driver_cash_pending_v2('{writer}');",False).returncode!=0
  assert sql(f"set role {role};select "+ack(unpaid)+';',False).returncode!=0
 assert sql(f"set role service_role;select public.hub_driver_cash_pending_v2('{writer}');").returncode==0
 print('PASS: v1 compatibility, v2 zero filtering/continuity/cancellation, owner associations, recovery, audit, deduplication, authorization')
finally:
 subprocess.run([str(pg/'dropdb'),*common,db],check=True,capture_output=True)
