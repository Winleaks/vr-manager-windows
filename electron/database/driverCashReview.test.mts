import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {initialSchema} from './schema.ts';
import {ensureBillingIssuerSchema} from './billingIssuers.ts';
import {ensureCreditNoteSchema} from './creditNotes.ts';
import {installBillingPublication} from './billingPublication.ts';
import {installDriverCash,upgradeDriverCashRouting,recordDriverCashConflict,applyDriverCash} from './driverCash.ts';
import {installDriverCashQueue,deferDriverCash} from './driverCashQueue.ts';
import {holdManualReview,decideManualReview,finishManualReview,manualReviewError} from './driverCashReview.ts';
import {processDriverCashBatch} from '../integrations/driverCashProcessor.ts';
function fixture() {
 const db=new Database(':memory:');db.exec(initialSchema);ensureBillingIssuerSchema(db);ensureCreditNoteSchema(db);installBillingPublication(db);installDriverCash(db);upgradeDriverCashRouting(db);installDriverCashQueue(db);
 const root=randomUUID(),driver=randomUUID(),company=randomUUID(),store=randomUUID();
 const c={operation_id:root,root_operation_id:root,previous_operation_id:null,revision:1,recorded_at_ms:Date.parse('2026-10-09T11:00:00Z'),amount_pence:1234,
 driver_id:driver,driver_name:'Driver',store_id:store,store_name:'Store',company_id:company,state:'PENDING',sequence_id:1};
 db.exec("INSERT INTO clients(id,name) VALUES(1,'Client');INSERT INTO cash_days(id,date,opening_balance) VALUES(1,'2026-10-09',0)");
 const issuer=(db.prepare('SELECT id FROM billing_issuers LIMIT 1').get() as any).id;
 db.prepare('INSERT INTO companies(id,client_id,name,supabase_company_id,issuer_id) VALUES(1,1,?,?,?)').run('Company',company,issuer);
 db.prepare('INSERT INTO stores(id,company_id,name,supabase_store_id) VALUES(1,1,?,?)').run('Store',store);
 db.prepare('INSERT INTO drivers(id,name,supabase_driver_id) VALUES(1,?,?)').run('Driver',driver);
 db.exec("INSERT INTO cash_transactions(id,cash_day_id,type,category,amount,reference_id) VALUES(1,1,'IN','driver_collection',12.34,1)");
 return {db,c};
}
test('suspected duplicate requires explicit review; manual resolution and response-loss replay create no money',()=>{
 const {db,c}=fixture();try {
  assert.throws(()=>holdManualReview(db,c),/Posibilă/);recordDriverCashConflict(db,c,manualReviewError);
  assert.throws(()=>decideManualReview(db,c.operation_id,'manual',999),/nu corespunde/);
  decideManualReview(db,c.operation_id,'manual',1);
  const result=finishManualReview(db,c);assert.equal(result?.result.disposition,'recorded_manually');
  assert.deepEqual(finishManualReview(db,c),result);
  assert.equal((db.prepare('SELECT count(*) n FROM payments').get() as any).n,0);
  assert.equal((db.prepare('SELECT sum(amount) n FROM cash_transactions').get() as any).n,12.34);
  const corrected={...c,operation_id:randomUUID(),previous_operation_id:c.operation_id,revision:2,amount_pence:0};
  assert.throws(()=>holdManualReview(db,corrected),/Posibilă/);recordDriverCashConflict(db,corrected,manualReviewError);
  assert.throws(()=>decideManualReview(db,corrected.operation_id,'distinct',null),/Corectează/);
  decideManualReview(db,corrected.operation_id,'manual',1);finishManualReview(db,corrected);
  assert.equal((db.prepare('SELECT sum(amount) n FROM cash_transactions').get() as any).n,12.34);
 } finally {db.close();}
});
test('distinct receipt is imported once and a manual cash entry cannot cover two unrelated receipts',()=>{
 const {db,c}=fixture();try {
  assert.throws(()=>holdManualReview(db,c),/Posibilă/);recordDriverCashConflict(db,c,manualReviewError);
  decideManualReview(db,c.operation_id,'distinct',null);holdManualReview(db,c);
  db.prepare("UPDATE driver_cash_operations SET state='RETRY_READY' WHERE operation_id=?").run(c.operation_id);
  applyDriverCash(db,c,'2026-10-09');applyDriverCash(db,c,'2026-10-09');
  assert.equal((db.prepare('SELECT sum(amount) n FROM cash_transactions').get() as any).n,24.68);
  const id=randomUUID(),other={...c,operation_id:id,root_operation_id:id};
  assert.throws(()=>holdManualReview(db,other),/Posibilă/);recordDriverCashConflict(db,other,manualReviewError);decideManualReview(db,id,'manual',1);finishManualReview(db,other);
  const id2=randomUUID(),another={...c,operation_id:id2,root_operation_id:id2};
  assert.throws(()=>holdManualReview(db,another),/Posibilă/);recordDriverCashConflict(db,another,manualReviewError);
  assert.throws(()=>decideManualReview(db,id2,'manual',1),/nu acoperă/);
 } finally {db.close();}
});
test('a transient root is durable and does not stop another root, while storage corruption still stops the batch',async()=>{
 const {db,c}=fixture();try {
  const id=randomUUID(),other={...c,operation_id:id,root_operation_id:id,sequence_id:2};const ack:string[]=[];
  await processDriverCashBatch(db,[c,other],'writer',{current:()=>true,saveCursor:()=>{},defer:x=>deferDriverCash(db,x,1000),
   apply:async x=>{if(x.operation_id===c.operation_id)throw Object.assign(Error('Drive unavailable'),{retryable:true});return applyDriverCash(db,x,'2026-10-09');},
   ack:async p=>{ack.push(String(p.operation_id));}});
  assert.deepEqual(ack,[id]);assert.equal((db.prepare('SELECT next_attempt_ms FROM driver_cash_delivery_retries').get() as any).next_attempt_ms,6000);
  await assert.rejects(processDriverCashBatch(db,[c],'writer',{current:()=>true,saveCursor:()=>{},defer:x=>deferDriverCash(db,x),ack:async()=>{},
   apply:async()=>{throw Object.assign(Error('storage'),{code:'SQLITE_IOERR'});}}),/storage/);
 } finally {db.close();}
});
