import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {initialSchema} from './schema.ts';
import {installBillingPublication} from './billingPublication.ts';
import {installEntitySyncState} from './entitySync.ts';
import {ensureBillingIssuerSchema} from './billingIssuers.ts';
import {ensureCreditNoteSchema} from './creditNotes.ts';
import {installNormalBillingVisibility,replaceNormalBillingVisibility} from './normalBillingVisibility.ts';
import {financialPublicationQueue,pendingFinancialCompanyCount,publicationRetryDelay,savePublicationMetadata} from './financialPublicationState.ts';
function fixture(){const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(initialSchema);ensureBillingIssuerSchema(db);ensureCreditNoteSchema(db);installBillingPublication(db);installEntitySyncState(db);installNormalBillingVisibility(db);
 db.exec("INSERT INTO clients(id,name) VALUES(1,'Client'); INSERT INTO companies(id,client_id,name,supabase_company_id) VALUES(1,1,'Magazine neasociate','vrbaker-unassigned-company'); INSERT INTO stores(id,company_id,name,supabase_store_id) VALUES(1,1,'Magazin test','22222222-2222-4222-8222-222222222222');");replaceNormalBillingVisibility(db,[]);return db;}
test('empty technical shell is omitted without acknowledging or changing any financial row',()=>{const db=fixture();try{
 const before=JSON.stringify(db.prepare('SELECT * FROM billing_publication_queue').all());assert.equal(financialPublicationQueue(db).length,0);assert.equal(pendingFinancialCompanyCount(db),0);assert.equal(JSON.stringify(db.prepare('SELECT * FROM billing_publication_queue').all()),before);
}finally{db.close();}});
test('every financial history or delivery obligation keeps a technical company blocked and visible',()=>{
 for(const sql of ["INSERT INTO invoices(store_id,invoice_number,invoice_date,total_amount,status) VALUES(1,'F-1','2026-11-16',20,'unpaid')", "INSERT INTO payments(company_id,amount,payment_date,method) VALUES(1,5,'2026-11-16','cash')", "INSERT INTO company_credit_entries(company_id,issuer_id,source_type,original_amount,available_amount) VALUES(1,1,'legacy',5,0)", "UPDATE companies SET credit_balance=5 WHERE id=1", "INSERT INTO billing_publication_deleted(company_id,invoice_id) VALUES(1,'old')", "INSERT INTO billing_publication_delivery(company_id,revision,payload) VALUES(1,1,'{}')", "UPDATE billing_publication_queue SET revision=2,published_revision=1"]){const db=fixture();try{db.exec(sql);const row=financialPublicationQueue(db)[0];assert.equal(row.state,'association_required');assert.match(row.reason!,/asociere/);assert.equal(row.nextAttemptAt,null);assert.equal(pendingFinancialCompanyCount(db),1);}finally{db.close();}}
});
test('mapping repair uses actual identity; duplicate/store problems remain blocked and hidden companies remain hidden',()=>{const db=fixture();try{
 db.exec("INSERT INTO invoices(store_id,invoice_number,invoice_date,total_amount,status) VALUES(1,'F-1','2026-11-16',20,'unpaid')");assert.equal(financialPublicationQueue(db)[0].stores[0].name,'Magazin test');
 db.exec("UPDATE companies SET supabase_company_id='11111111-1111-4111-8111-111111111111' WHERE id=1");assert.equal(financialPublicationQueue(db)[0].state,'pending');
 db.exec("UPDATE stores SET supabase_store_id='invalid' WHERE id=1");assert.equal(financialPublicationQueue(db)[0].state,'association_required');
 replaceNormalBillingVisibility(db,[1]);assert.equal(financialPublicationQueue(db).length,0);
}finally{db.close();}});
test('durable blocked revision wakes after changes; transient state retains confirmation and server rate limit',()=>{const db=fixture();try{
 db.exec("UPDATE companies SET supabase_company_id='11111111-1111-4111-8111-111111111111' WHERE id=1");const row=financialPublicationQueue(db)[0];savePublicationMetadata(db,1,{blockedRevision:row.revision,reason:'Configurație',lastConfirmedAt:123,rateLimitUntil:999999});assert.equal(financialPublicationQueue(db)[0].state,'association_required');
 db.exec('UPDATE billing_publication_queue SET revision=revision+1,last_error=\'offline\',retry_at=150');const next=financialPublicationQueue(db,100)[0];assert.equal(next.state,'temporary_error');assert.equal(next.lastConfirmedAt,123);assert.equal(next.nextAttemptAt,999999);
 assert.equal(publicationRetryDelay(0),2000);assert.equal(publicationRetryDelay(3),30000);assert.equal(publicationRetryDelay(100),60000);assert.equal(publicationRetryDelay(0,600000),600000);
}finally{db.close();}});
