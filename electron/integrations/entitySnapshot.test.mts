import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VrBakerApiClient } from './vrBakerApiClient.ts';
const company={id:'11111111-1111-1111-1111-111111111111',name:'Fixture Company'};
const store={id:'22222222-2222-2222-2222-222222222222',name:'Fixture Store',active:false,client_company_id:company.id,client_company:company};
const envelope=(rows:any[])=>({version:1,rows,count:rows.length,complete:true});
const client=(companyData:any=envelope([company]),storeData:any=envelope([store]))=>new VrBakerApiClient('a'.repeat(48),{maxAttempts:1,fetchImpl:(async(_url:any,init:any)=>{
  const body=JSON.parse(init.body);assert.equal(body.include_meta,true);
  return new Response(JSON.stringify({success:true,data:body.action==='companies.list'?companyData:storeData}),{status:200});
}) as typeof fetch});
test('complete export keeps inactive store and its company without requiring a client login',async()=>{
  const result=await client().fetchEntitySnapshot();
  assert.equal(result.stores[0].platformActive,false);
  assert.equal(result.stores[0].company?.id,company.id);
});
test('old API, empty/truncated exports and count mismatch never permit absence reconciliation',async()=>{
  for(const value of [[company],envelope([]),{...envelope([company]),complete:false},{...envelope([company]),count:2}]){
    await assert.rejects(client(value).fetchEntitySnapshot());
  }
});
test('duplicate IDs, omitted status and broken company relationship reject snapshot',async()=>{
  for(const [companies,stores] of [[envelope([company,company]),envelope([store])],[envelope([company]),envelope([{...store,active:undefined}])],
    [envelope([company]),envelope([{...store,client_company:null}])]]){
    await assert.rejects(client(companies,stores).fetchEntitySnapshot());
  }
});
test('API count envelope is opt-in, read-only and does not filter inactive stores',()=>{
  const source=readFileSync(new URL('../../supabase/functions/external-api/index.ts',import.meta.url),'utf8');
  const endpoints=source.slice(source.indexOf('"companies.list":'),source.indexOf('"orders.weekly_export":'));
  assert.equal((endpoints.match(/payload.include_meta === true/g)||[]).length,2);
  assert.equal((endpoints.match(/count: "exact"/g)||[]).length,2);
  assert.equal((endpoints.match(/mutates: false/g)||[]).length,2);
  assert.doesNotMatch(endpoints,/\.eq\("active"/);
  assert.match(endpoints,/return data \?\? \[\]/);
});

test('entity sync UI checks resolved IPC failures and shows numeric success counts',()=>{
  const page=readFileSync(new URL('../../src/pages/BillingClients.tsx',import.meta.url),'utf8');
  const handler=readFileSync(new URL('../ipc/billingHandlers.ts',import.meta.url),'utf8');
  assert.match(page,/if \(!result.success\) throw new Error\(result.message/);
  assert.match(page,/role=\{syncError \? 'alert' : 'status'\}/);
  assert.match(handler,/success: true, \.\.\.result, message:/);
  const status=readFileSync(new URL('../../src/components/BillingPublicationSettings.tsx',import.meta.url),'utf8');
  assert.match(status,/setInterval\(\(\)=>void poll\(\),5000\)/);
  assert.match(status,/active=false;clearInterval\(timer\)/);
  assert.match(status,/if\(!folderEdited.current\)setFolder/);
});
