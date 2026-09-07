import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {initialSchema} from './schema.ts';
import {ensureBillingIssuerSchema} from './billingIssuers.ts';
import {ensureCreditNoteSchema} from './creditNotes.ts';
import {installBillingPublication} from './billingPublication.ts';
import {installEntitySyncState,assertEntitySyncSafe} from './entitySync.ts';
import {planLegacyEntityRepair,applyLegacyEntityRepair,retiredLegacyCompanyIds,type EntitySnapshot} from './legacyEntityRepair.ts';
import {synchronizeEntitiesWithRepair} from '../integrations/entityRepairCoordinator.ts';
const company={id:'11111111-1111-1111-1111-111111111111',name:'Legal Company',address:'',vatNumber:'',registrationNumber:''};
const store={id:'22222222-2222-2222-2222-222222222222',name:'Canonical Store',address:'',phone:'',routeOrder:null,zone:null,company,platformActive:false};
const old='33333333-3333-3333-3333-333333333333';
function fixture(merge=false){
  try {
  const db=new Database(':memory:'); db.pragma('foreign_keys=ON'); db.exec(initialSchema);
  ensureBillingIssuerSchema(db);ensureCreditNoteSchema(db);installBillingPublication(db);installEntitySyncState(db);
  db.exec(`INSERT INTO clients(id,name)VALUES(1,'Fixture');
    INSERT INTO companies(id,client_id,name,supabase_company_id)VALUES(1,1,'Placeholder','vrbaker-unassigned-company');`);
  db.prepare('INSERT INTO companies(id,client_id,name,supabase_company_id)VALUES(2,1,?,?)').run(company.name,company.id);
  db.prepare('INSERT INTO stores(id,company_id,name,supabase_store_id)VALUES(1,1,?,?)').run('Old Store',merge?old:store.id);
  if(merge)db.prepare('INSERT INTO stores(id,company_id,name,supabase_store_id)VALUES(2,2,?,?)').run(store.name,store.id);
  db.exec("INSERT INTO invoices(id,store_id,invoice_number,invoice_date,total_amount,status)VALUES(1,1,'FIX-78','2026-09-01',57.5,'unpaid');INSERT INTO invoice_items(invoice_id,product_name,quantity,unit_price,total_price)VALUES(1,'Bread',5,11.5,57.5)");
  if(merge){
    db.prepare("INSERT INTO invoice_import_batches(id,invoice_id,source,store_external_id,period_start,period_end,source_fingerprint) VALUES(1,1,'vrbaker',?,'2026-08-31','2026-09-06','original-fingerprint')").run(old);
    db.exec("INSERT INTO invoice_source_orders VALUES(1,'order-1','original-timestamp')");
  }
  const snapshot:EntitySnapshot={companies:[company],stores:[store],merges:merge?[{oldStoreId:old,storeId:store.id}]:[]};
  return {db,snapshot};
  } catch(error) { throw new Error((error as Error).message); }
}
test('approved placeholder repair preserves money/items, invalidates document and remains idempotent',()=>{
  const {db,snapshot}=fixture();try{
    const items=db.prepare('SELECT * FROM invoice_items').all();
    assert.throws(()=>assertEntitySyncSafe(db,snapshot.companies,snapshot.stores),/Istoricul/);
    const plan=planLegacyEntityRepair(db,snapshot);assert.equal(plan.moves.length,1);
    assert.throws(()=>applyLegacyEntityRepair(db,snapshot,plan,'backup'),/tranzacție/);
    db.transaction(()=>applyLegacyEntityRepair(db,snapshot,plan,'verified-backup'))();
    assertEntitySyncSafe(db,snapshot.companies,snapshot.stores);
    assert.deepEqual(db.prepare('SELECT invoice_number,total_amount,paid_amount FROM invoices').get(),{invoice_number:'FIX-78',total_amount:57.5,paid_amount:0});
    assert.deepEqual(db.prepare('SELECT * FROM invoice_items').all(),items);
    assert.equal(planLegacyEntityRepair(db,snapshot).moves.length,0);
  }finally{db.close();}
});
test('explicit merge preserves invoice and source identity, changes only store mapping, retains tombstone',()=>{
  const {db,snapshot}=fixture(true);try{
    const orders=db.prepare('SELECT * FROM invoice_source_orders').all();
    db.transaction(()=>applyLegacyEntityRepair(db,snapshot,planLegacyEntityRepair(db,snapshot),'verified'))();
    assert.equal((db.prepare('SELECT store_id FROM invoices').get() as any).store_id,2);
    assert.deepEqual(db.prepare('SELECT store_external_id,source_fingerprint FROM invoice_import_batches').get(),{store_external_id:store.id,source_fingerprint:'original-fingerprint'});
    assert.deepEqual(db.prepare('SELECT * FROM invoice_source_orders').all(),orders);
    assert.equal((db.prepare('SELECT count(*) n FROM stores').get() as any).n,2);
    assert.equal(planLegacyEntityRepair(db,snapshot).moves.length,0);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  }finally{db.close();}
});
test('financial conflicts, duplicate periods, malformed aliases and changed plans never move history',()=>{
  for(const mode of ['paid','period','alias','changed']){
    const {db,snapshot}=fixture(true);try{
      const plan=planLegacyEntityRepair(db,snapshot);
      if(mode==='paid')db.exec('UPDATE invoices SET paid_amount=1');
      if(mode==='period'){
        db.exec("INSERT INTO invoices(id,store_id,invoice_number,invoice_date,total_amount)VALUES(2,2,'FIX-79','2026-09-01',1)");
        db.prepare("INSERT INTO invoice_import_batches(id,invoice_id,store_external_id,period_start,period_end,source_fingerprint)VALUES(2,2,?,'2026-08-31','2026-09-06','other')").run(store.id);
      }
      if(mode==='alias')snapshot.merges!.push(snapshot.merges![0]);
      if(mode==='changed')db.exec("UPDATE stores SET name='Changed' WHERE id=1");
      assert.throws(()=>db.transaction(()=>applyLegacyEntityRepair(db,snapshot,plan,'verified'))());
      assert.equal((db.prepare('SELECT store_id FROM invoices').get() as any).store_id,1);
    }finally{db.close();}
  }
});
test('retired virtual shells are hidden only with exact valid replacement and no financial history',()=>{
  const {db,snapshot}=fixture(true);try{
    db.prepare("INSERT INTO companies(id,client_id,name,supabase_company_id)VALUES(3,1,'Shell',?)").run(`virtual_${store.id}`);
    assert.deepEqual([...retiredLegacyCompanyIds(db)],[3]);
    db.exec('UPDATE companies SET credit_balance=1 WHERE id=3');
    assert.equal(retiredLegacyCompanyIds(db).size,0);
    assert.equal(planLegacyEntityRepair(db,{...snapshot,merges:[]}).moves.length,0); // no name-based merge
  }finally{db.close();}
});
test('coordinator cancels, fails on backup/role drift and rolls back repair with subsequent sync',async()=>{
  for(const mode of ['cancel','backup','role','sync','ok']){
    const {db,snapshot}=fixture(true);try{
      let assertions=0,backups=0;
      const run=()=>synchronizeEntitiesWithRepair({connection:db,
        assertCurrent:()=>{if(mode==='role' && ++assertions===3)throw new Error('viewer');},
        fetchSnapshot:async()=>snapshot,confirm:async()=>mode!=='cancel',
        backup:async()=>{backups++;if(mode==='backup')throw new Error('disk full');return 'verified';},
        synchronize:()=>{if(mode==='sync')throw new Error('sync failed');return {ok:true};}});
      if(mode==='ok'){const result=await run();assert.equal(result.repairedInvoices,1);assert.equal(backups,1);}
      else{await assert.rejects(run());assert.equal((db.prepare('SELECT store_id FROM invoices').get() as any).store_id,1);}
    }finally{db.close();}
  }
});
