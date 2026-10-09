import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import Database from 'better-sqlite3';
import {initialSchema} from '../database/schema.ts';
import {ensureBillingIssuerSchema} from '../database/billingIssuers.ts';
import {ensureCreditNoteSchema} from '../database/creditNotes.ts';
import {installBillingPublication} from '../database/billingPublication.ts';
import * as cash from '../database/driverCash.ts';
import * as recovery from './driverCashRecovery.ts';
import * as processor from './driverCashProcessor.ts';
import {EntityAssociationConflict} from '../database/entitySync.ts';
const code=ts.transpileModule(readFileSync(new URL('./driverCashSync.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture() {
 const db=new Database(':memory:');db.exec(initialSchema);ensureBillingIssuerSchema(db);ensureCreditNoteSchema(db);installBillingPublication(db);cash.installDriverCash(db);cash.upgradeDriverCashRouting(db);
 const issuer=(db.prepare('SELECT id FROM billing_issuers LIMIT 1').get() as any).id;
 const company=randomUUID(),store=randomUUID(),root=randomUUID();
 db.exec("INSERT INTO clients(id,name) VALUES(1,'Client')");
 db.prepare('INSERT INTO companies(id,client_id,name,supabase_company_id,issuer_id) VALUES(1,1,?,?,?)').run('Company',company,issuer);
 db.prepare('INSERT INTO stores(id,company_id,name,supabase_store_id) VALUES(1,1,?,?)').run('Store',store);
 const c={operation_id:root,root_operation_id:root,previous_operation_id:null,revision:1,recorded_at_ms:Date.parse('2026-10-09T09:00:00Z'),amount_pence:1234,
  driver_id:randomUUID(),driver_name:'Driver',store_id:store,store_name:'Store',company_id:company,sequence_id:1,state:'PENDING'};
 const state={role:'writer',incoming:[] as any[],published:0,imports:0,requests:[] as any[],snapshots:[] as string[][]};
 const mockClient={request:async(action:string,payload:any)=>{
  state.requests.push({action,payload});
  if(action==='driver.cash.pending')return structuredClone(state.incoming);
  if(action==='driver.cash.retry'){for(const x of state.incoming)if(x.operation_id===payload.operation_id)x.state='PENDING';}
  return true;
 },fetchEntitySnapshot:async(ids:string[])=>{state.snapshots.push(ids);return {companies:[{id:company,name:'Company'}],stores:[{id:store,name:'Store',company:{id:company,name:'Company'}}]};}};
 const mocks:any={
  'node:crypto':{randomUUID},'../database/db':{db,waitForDatabaseReady:async()=>{}},'../device/deviceRole':{getDeviceRole:()=>state.role},
  './vrBakerIntegration':{createVrBakerClient:()=>mockClient},'./driverCashProcessor':processor,'../database/driverCash':cash,
  './driverCashRecovery':recovery,'../database/repositories/billingRepo':{syncEntitiesFromVrBaker:()=>{state.imports++;}},
  '../database/entitySync':{EntityAssociationConflict},'../database/normalBillingVisibility':{invalidateNormalBillingVisibility:()=>{}},
  './billingPublisher':{publishBilling:async()=>{state.published++;}},'../protectedRegistry/service':{applyRoutedDriverCash:async(c:any)=>cash.applyDriverCash(db,c)},
 };
 const api:any={};runInNewContext(code,{exports:api,require:(id:string)=>{if(!(id in mocks))throw Error(id);return mocks[id];}});
 return {db,c,state,api};
}
test('No-only v2 poll performs no entity import, individual acknowledgment or publication; Viewer makes no requests',async()=>{
 const f=fixture();try {
  cash.recordDriverCashConflict(f.db,{...f.c,company_id:null,amount_pence:0},recovery.legacyDriverCashRoutingError);
  await f.api.syncDriverCash();assert.equal(f.state.imports,0);assert.equal(f.state.published,0);
  assert.deepEqual(f.state.requests.map(x=>x.action),['driver.cash.pending']);assert.equal(f.state.requests[0].payload.protocol_version,2);
  f.state.role='viewer';f.state.incoming=[f.c];await f.api.syncDriverCash();assert.equal(f.state.requests.length,1);
 }finally{f.db.close();}
});
test('server-preserved missing-company receipt recovers through exact entity IDs and publishes only after one financial application',async()=>{
 const f=fixture();try {
  const error='Asocierea magazinului, companiei sau emitentului necesită verificare.';
  cash.recordDriverCashConflict(f.db,{...f.c,company_id:null},error);
  f.state.incoming=[{...f.c,state:'CONFLICT',recoverable_association:true,hub_result:{error}}];
  await f.api.syncDriverCash();assert.equal(f.state.imports,1);assert.deepEqual(f.state.snapshots.map(ids=>Array.from(ids)),[[f.c.store_id]]);
  assert.equal(f.state.requests.filter(x=>x.action==='driver.cash.retry').length,1);
  assert.equal(f.state.requests.find(x=>x.action==='driver.cash.ack').payload.protocol_version,2);
  assert.equal((f.db.prepare('SELECT sum(amount) AS n FROM cash_transactions').get() as any).n,12.34);
  await f.api.syncDriverCash();assert.equal((f.db.prepare('SELECT count(*) AS n FROM cash_transactions').get() as any).n,1);
 }finally{f.db.close();}
});
test('operational status hides preserved zero declarations but keeps cancellations after positive cash',()=>{
 const f=fixture();try {
  cash.applyDriverCash(f.db,{...f.c,amount_pence:0});assert.equal(f.api.driverCashStatus().receipts.length,0);
  const positive={...f.c,operation_id:randomUUID(),previous_operation_id:f.c.operation_id,revision:2};cash.applyDriverCash(f.db,positive);
  cash.applyDriverCash(f.db,{...positive,operation_id:randomUUID(),previous_operation_id:positive.operation_id,revision:3,amount_pence:0});
  const receipts=f.api.driverCashStatus().receipts;assert.equal(receipts.length,1);assert.equal(receipts[0].amount_pence,0);
 }finally{f.db.close();}
});
