import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {initialSchema} from '../database/schema.ts';
import {ensureBillingIssuerSchema} from '../database/billingIssuers.ts';
import {ensureCreditNoteSchema} from '../database/creditNotes.ts';
import {installBillingPublication} from '../database/billingPublication.ts';
import {installEntitySyncState,assertEntitySyncSafe} from '../database/entitySync.ts';
import {synchronizeEntitiesWithRepair} from './entityRepairCoordinator.ts';
import {synchronizeWeeklySnapshot} from './weeklyEntitySync.ts';
import {aggregateWeeklyOrders} from './weeklyInvoiceImport.ts';
import {validateWeeklyPeriod} from './vrBakerApiClient.ts';

const companies=[1,2].map(n=>({id:`${n}`.repeat(8)+'-1111-1111-1111-111111111111',name:`Fixture Company ${n}`,address:'',vatNumber:'',registrationNumber:''}));
const stores=companies.map((company,n)=>({id:`${n+3}`.repeat(8)+'-1111-1111-1111-111111111111',name:`Fixture Store ${n+1}`,company,address:'',phone:'',routeOrder:null,zone:null,platformActive:false}));
const code=ts.transpileModule(readFileSync(new URL('../ipc/billingHandlers.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;

// Execute the real registered IPC handler, not just its repair helper. External
// services/dialogs are controlled fixtures; all history checks use real SQLite.
function fixture(mode='ok'){
 const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(initialSchema);
 ensureBillingIssuerSchema(db);ensureCreditNoteSchema(db);installBillingPublication(db);installEntitySyncState(db);
 db.exec("INSERT INTO clients(id,name)VALUES(1,'Fixture');INSERT INTO companies(id,client_id,name,supabase_company_id)VALUES(1,1,'Unassigned','vrbaker-unassigned-company')");
 for(const [n,store] of stores.entries()){
  db.prepare('INSERT INTO companies(id,client_id,name,supabase_company_id)VALUES(?,1,?,?)').run(n+2,store.company.name,store.company.id);
  db.prepare('INSERT INTO stores(id,company_id,name,supabase_store_id)VALUES(?,1,?,?)').run(n+1,store.name,store.id);
  db.prepare("INSERT INTO invoices(id,store_id,invoice_number,invoice_date,total_amount)VALUES(?,?,?,'2026-09-01',10)").run(n+1,n+1,`FIX-${n+1}`);
 }
 let role=mode==='viewer'?'viewer':'writer',repairs=0,confirmed=0,backups=0,issued=0;
 const periods:string[]=[];const database={db};
 const handlers=new Map<string,Function>();
 const synchronize=(cs:any[],ss:any[])=>db.transaction(()=>assertEntitySyncSafe(db,cs,ss,false))();
 const mocks:any={
  '../database/repositories/billingRepo':{syncEntitiesFromVrBaker:synchronize,getIssuerPreviewByStoreExternalId:()=>({}),getWeeklyImportState:()=>({billingState:'invoiced'}),createWeeklyInvoices:()=>{issued++;throw Error('Must not issue');}},
  '../database/db':database,
  '../ipc/trustedHandler':{},
  './trustedHandler':{handleTrustedIpc:(name:string,handler:Function)=>handlers.set(name,handler)},
  '../integrations/weeklyEntitySync':{synchronizeWeeklySnapshot},
  '../integrations/weeklyInvoiceImport':{aggregateWeeklyOrders},
  '../integrations/vrBakerApiClient':{validateWeeklyPeriod},
  '../device/deviceRole':{getDeviceRole:()=>role},
  '../integrations/vrBakerIntegration':{
   createVrBakerClient:()=>({fetchWeeklyBillingSnapshot:async(start:string,end:string)=>{
    periods.push(`${start}/${end}`);
    if(mode==='network')throw Error('Network unavailable');
    if(mode==='switch')database.db={...db} as any;
    const store=stores[start==='2026-09-07'?0:1];
    return {zones:[],orders:[{id:'aaaaaaaa-1111-1111-1111-111111111111',updatedAt:'2026-09-01',status:'open',deliveryDate:start,store,
      items:[{productId:'bbbbbbbb-1111-1111-1111-111111111111',productName:'Bread',nameRo:'Bread',unit:'buc',unitPrice:5,quantity:2}]}]};
   }}),
   syncVrBakerEntities:async()=>{repairs++;
    if(mode==='unresolved')return;
    if(mode==='drift'){role='viewer';return;}
    return synchronizeEntitiesWithRepair({connection:db,assertCurrent:()=>{assert.equal(role,'writer');},
      fetchSnapshot:async()=>({companies,stores}),confirm:async()=>{confirmed++;return mode!=='cancel';},
      backup:async()=>{backups++;if(mode==='backup')throw Error('Backup failed');return 'verified-fixture';},
      synchronize:({companies,stores})=>{assertEntitySyncSafe(db,companies,stores);return {};}});
   },
  },
  '../protectedRegistry/service':{filterNormalWeeklyGroups:async(groups:any)=>groups,withRegistryRoutingLock:async(fn:Function)=>fn()},
  '../../src/utils/invoicePreviewNumbering':{assignEstimatedInvoiceReferences:(groups:any)=>groups},
 };
 const exports:any={};runInNewContext(code,{exports,console,require:(id:string)=>mocks[id]||{}});
 exports.registerBillingHandlers();
 return {db,periods,stats:()=>({repairs,confirmed,backups,issued}),
  preview:(start:string,end:string)=>handlers.get('billing:previewWeeklyInvoices')!(null,start,end),
  issue:()=>handlers.get('billing:createWeeklyInvoices')!(null,'2026-09-07','2026-09-13',[stores[0].id])};
}
test('real weekly preview repairs historical association from either week, preserves invoices and refetches same period',async()=>{
 for(const [start,end] of [['2026-09-07','2026-09-13'],['2026-08-31','2026-09-06']]){
  const f=fixture();try{
   const before=f.db.prepare('SELECT * FROM invoices ORDER BY id').all() as any[];
   const result=await f.preview(start,end);
   assert.equal(result.success,true,result.message);assert.equal(result.ordersByStore.length,1);
   assert.deepEqual(f.stats(),{repairs:1,confirmed:1,backups:1,issued:0});assert.deepEqual(f.periods,[`${start}/${end}`,`${start}/${end}`]);
   const after=f.db.prepare('SELECT * FROM invoices ORDER BY id').all() as any[];
   for(let n=0;n<before.length;n++){const {document_revision:_,...old}=before[n];const {document_revision:__,...now}=after[n];assert.deepEqual(now,old);}
   assert.deepEqual(f.db.pragma('foreign_key_check'),[]);
   assert.equal((await f.preview(start,end)).success,true);assert.equal(f.stats().repairs,1);
  }finally{f.db.close();}
 }
});
test('real preview cancellation, backup failure, role/database drift, unrelated failures and unresolved conflicts remain safe',async()=>{
 for(const mode of ['cancel','backup','viewer','switch','network','unresolved','drift']){
  const f=fixture(mode);try{
   const result=await f.preview('2026-09-07','2026-09-13');assert.equal(result.success,false,mode);
   assert.equal((f.db.prepare('SELECT count(*) n FROM stores WHERE company_id=1').get() as any).n,2);
   assert.equal(f.stats().issued,0);assert.ok(f.stats().repairs<=1);
   if(mode==='viewer'){assert.equal(f.periods.length,0);assert.equal(f.stats().repairs,0);}
   if(mode==='network'||mode==='switch')assert.equal(f.stats().repairs,0);
   if(mode==='unresolved')assert.equal(f.periods.length,2);
  }finally{f.db.close();}
 }
});
test('invoice issuance does not open repair dialogs or silently change association',async()=>{
 const f=fixture();try{const result=await f.issue();assert.equal(result.success,false);assert.deepEqual(f.stats(),{repairs:0,confirmed:0,backups:0,issued:0});}finally{f.db.close();}
});
