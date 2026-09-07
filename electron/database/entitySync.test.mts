import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { initialSchema } from './schema.ts';
import { installEntitySyncState, assertEntitySyncSafe, reconcileEntityPresence, flagPossibleCompanyDuplicates } from './entitySync.ts';
import { installBillingPublication, prepareBillingDelivery } from './billingPublication.ts';
import type { VrBakerCompany, VrBakerStore } from '../integrations/vrBakerApiClient.ts';

const company:VrBakerCompany={id:'11111111-1111-1111-1111-111111111111',name:'Fixture Company',address:'',vatNumber:'',registrationNumber:''};
const store:VrBakerStore={id:'22222222-2222-2222-2222-222222222222',name:'Fixture Store',address:'',phone:'',routeOrder:null,zone:null,company,platformActive:false};
function fixture() {
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(initialSchema);
  db.transaction(()=>{installBillingPublication(db);installEntitySyncState(db);})();
  db.exec("INSERT INTO clients(id,name)VALUES(1,'Fixture');");
  db.prepare('INSERT INTO companies(id,client_id,name,supabase_company_id)VALUES(1,1,?,?)').run(company.name,company.id);
  db.prepare('INSERT INTO stores(id,company_id,name,supabase_store_id)VALUES(1,1,?,?)').run(store.name,store.id);
  db.exec("INSERT INTO invoices(id,store_id,invoice_number,invoice_date,total_amount,paid_amount)VALUES(1,1,'FIX-1','2026-09-01',10,3)");
  return db;
}

test('inactive platform store keeps company association, local billing eligibility and complete financial history',()=>{
  const db=fixture();try{
    const invoice=db.prepare('SELECT * FROM invoices').get();
    assertEntitySyncSafe(db,[company],[store]);
    const result=db.transaction(()=>reconcileEntityPresence(db,[company],[store]))();
    assert.equal(result.inactiveStores,1);
    assert.deepEqual(db.prepare('SELECT company_id,is_active,platform_active,vrbaker_missing FROM stores').get(),{company_id:1,is_active:1,platform_active:0,vrbaker_missing:0});
    assert.deepEqual(db.prepare('SELECT * FROM invoices').get(),invoice);
    assert.equal(prepareBillingDelivery(db,1).invoices.length,1); // includes legacy PostgreSQL UUIDs
  }finally{db.close();}
});

test('missing company/store are retained, publication stops even with a cached delivery, return restores presence',()=>{
  const db=fixture();try{
    prepareBillingDelivery(db,1);
    const before=db.prepare('SELECT * FROM invoices').get();
    const other={...company,id:'33333333-3333-3333-3333-333333333333'};
    const otherStore={...store,id:'44444444-4444-4444-4444-444444444444',company:other};
    assertEntitySyncSafe(db,[other],[otherStore]);
    const result=db.transaction(()=>reconcileEntityPresence(db,[other],[otherStore]))();
    assert.equal(result.missingCompanies,1);assert.equal(result.missingStores,1);
    assert.throws(()=>prepareBillingDelivery(db,1),/nu mai apare/);
    assert.deepEqual(db.prepare('SELECT * FROM invoices').get(),before);
    assert.equal((db.prepare('SELECT count(*) AS n FROM billing_publication_delivery').get() as any).n,1);
    reconcileEntityPresence(db,[company],[{...store,platformActive:true}]);
    assert.equal((db.prepare('SELECT vrbaker_missing FROM companies').get() as any).vrbaker_missing,0);
    assert.equal((db.prepare('SELECT platform_active FROM stores').get() as any).platform_active,1);
    assert.equal(prepareBillingDelivery(db,1).invoices.length,1);
  }finally{db.close();}
});

test('manual company is not inferred missing and repeated names are flagged without merging',()=>{
  const db=fixture();try{
    db.prepare('INSERT INTO companies(client_id,name)VALUES(1,?)').run(company.name);
    reconcileEntityPresence(db,[company],[store]);
    assert.equal((db.prepare('SELECT vrbaker_missing FROM companies WHERE id=2').get() as any).vrbaker_missing,0);
    const rows=flagPossibleCompanyDuplicates(db.prepare('SELECT id,name FROM companies').all() as {id:number;name:string}[]);
    assert.equal(rows.length,2);assert.ok(rows.every(row=>row.possible_duplicate));
    assert.equal((db.prepare('SELECT company_id FROM stores').get() as any).company_id,1);
  }finally{db.close();}
});

test('invoiced store cannot automatically transfer historical invoices to another company',()=>{
  const db=fixture();try{
    const other={...company,id:'33333333-3333-3333-3333-333333333333'};
    assert.throws(()=>assertEntitySyncSafe(db,[company,other],[{...store,company:other}]),/istoricul nu a fost mutat/i);
    assert.equal((db.prepare('SELECT company_id FROM stores').get() as any).company_id,1);
  }finally{db.close();}
});

test('empty/inconsistent exports and duplicate local external IDs fail before mutation',()=>{
  const db=fixture();try{
    assert.throws(()=>assertEntitySyncSafe(db,[],[store]),/nu este complet/);
    assert.throws(()=>assertEntitySyncSafe(db,[company],[]),/nu este complet/);
    assert.throws(()=>assertEntitySyncSafe(db,[company],[{...store,platformActive:undefined}]),/nu este complet/);
    db.prepare('INSERT INTO companies(client_id,name,supabase_company_id)VALUES(1,?,?)').run(company.name,company.id);
    assert.throws(()=>assertEntitySyncSafe(db,[company],[store]),/mai multor/);
  }finally{db.close();}
});

test('entity presence changes roll back with the caller transaction',()=>{
  const db=fixture();try{
    assert.throws(()=>db.transaction(()=>{reconcileEntityPresence(db,[company],[store]);throw new Error('rollback');})(),/rollback/);
    assert.equal((db.prepare('SELECT platform_active FROM stores').get() as any).platform_active,null);
  }finally{db.close();}
});

test('partial weekly previews accept omitted platform status and never infer other companies missing',()=>{
  const db=fixture();try{
    assert.doesNotThrow(()=>assertEntitySyncSafe(db,[],[],false));
    assert.doesNotThrow(()=>assertEntitySyncSafe(db,[company],[{...store,platformActive:undefined}],false));
    const source=readFileSync(new URL('./repositories/billingRepo.ts',import.meta.url),'utf8');
    assert.match(source,/options: \{complete\?:boolean\} = \{\}/);
    assert.match(source,/options.complete === true \? reconcileEntityPresence/);
    assert.equal((db.prepare('SELECT vrbaker_missing FROM companies').get() as any).vrbaker_missing,0);
  }finally{db.close();}
});

test('migration is additive, rollback retains original data and backup precedes migration 18',()=>{
  const db=new Database(':memory:');try{
    db.exec(initialSchema);db.exec("INSERT INTO clients(id,name)VALUES(1,'Fixture');INSERT INTO companies(client_id,name)VALUES(1,'Keep me')");
    assert.throws(()=>db.transaction(()=>{installEntitySyncState(db);throw new Error('rollback');})(),/rollback/);
    assert.ok(!(db.pragma('table_info(companies)') as any[]).some(row=>row.name==='vrbaker_missing'));
    db.transaction(()=>installEntitySyncState(db))();
    assert.equal((db.prepare('SELECT name,vrbaker_missing FROM companies').get() as any).name,'Keep me');
    const source=readFileSync(new URL('./db.ts',import.meta.url),'utf8');
    assert.match(source,/createPreMigrationSnapshotIfNeeded\(18\)/);
    assert.match(source,/version:18.*installEntitySyncState/);
  }finally{db.close();}
});

test('entity list is read-only, publisher excludes missing but never inactive platform stores',()=>{
  const repo=readFileSync(new URL('./repositories/billingRepo.ts',import.meta.url),'utf8');
  assert.doesNotMatch(repo,/cleanupOrphanCompanies/);
  const publisher=readFileSync(new URL('../integrations/billingPublisher.ts',import.meta.url),'utf8');
  assert.match(publisher,/c.vrbaker_missing=0/);
  assert.doesNotMatch(publisher,/platform_active/);
  const integration=readFileSync(new URL('../integrations/vrBakerIntegration.ts',import.meta.url),'utf8');
  assert.match(integration,/connection !== db \|\| getDeviceRole\(\) !== 'writer'/);
});
