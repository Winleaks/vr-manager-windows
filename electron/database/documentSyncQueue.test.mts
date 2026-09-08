import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installDocumentSyncQueue, documentSyncStatus, dueDocuments, retryDocumentSync, trackDocumentUpload, queueInvoiceDocument } from './documentSyncQueue.ts';
import { documentSyncFailure } from '../integrations/documentSyncErrors.ts';
import { isChannelAllowedForRole } from '../device/viewerPolicy.ts';
import { generateInvoicePDF } from '../../src/utils/pdfGenerator.ts';
import { initialSchema } from './schema.ts';
import { ensureBillingIssuerSchema } from './billingIssuers.ts';
import { ensureCreditNoteSchema } from './creditNotes.ts';
import { installBillingPublication } from './billingPublication.ts';

function fixture(filename = ':memory:') {
  const db = new Database(filename);
  db.exec(`CREATE TABLE invoices(id INTEGER PRIMARY KEY, status TEXT, invoice_number TEXT, document_revision INTEGER DEFAULT 1,drive_file_id TEXT,total_amount REAL);
    CREATE TABLE credit_notes(id INTEGER PRIMARY KEY,status TEXT,reference TEXT,cloud_status TEXT,total_amount REAL);
    INSERT INTO invoices VALUES(1,'issued','FIX-1',1,NULL,20),(2,'issued','FIX-2',1,'known_file',40),(3,'cancelled','FIX-3',1,NULL,9);
    INSERT INTO credit_notes VALUES(1,'issued','CN-1','error',5);`);
  return db;
}

test('migration queues missing invoices and credits, preserves finances and rolls back atomically', () => {
  const db=fixture(); try {
    const before=db.prepare('SELECT * FROM invoices').all();
    assert.throws(()=>db.transaction(()=>{installDocumentSyncQueue(db);throw new Error('rollback')})());
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='document_sync_queue'").get(),undefined);
    db.transaction(()=>installDocumentSyncQueue(db))();
    assert.deepEqual(db.prepare('SELECT * FROM invoices').all(),before);
    assert.equal(documentSyncStatus(db).pending,2);
    assert.deepEqual(dueDocuments(db).map(x=>[x.kind,x.document_id]),[['credit_note',1],['invoice',1]]);
    const source=readFileSync(new URL('./db.ts',import.meta.url),'utf8');
    assert.match(source,/createPreMigrationSnapshotIfNeeded\(20\)/);
    assert.match(source,/version:19.*installDocumentSyncQueue/);
  } finally {db.close()}
});

test('migration coexists with real publication/item triggers without requeue loops or financial changes', async () => {
  const db=new Database(':memory:');try{
    db.pragma('foreign_keys=ON');db.exec(initialSchema);
    ensureBillingIssuerSchema(db);ensureCreditNoteSchema(db);installBillingPublication(db);
    db.exec("INSERT INTO clients(id,name) VALUES(1,'Fixture');INSERT INTO companies(id,client_id,name) VALUES(1,1,'Fixture');INSERT INTO stores(id,company_id,name) VALUES(1,1,'Fixture');INSERT INTO invoices(id,store_id,invoice_number,invoice_date,total_amount,paid_amount) VALUES(1,1,'FIX-1','2026-09-08',20,3)");
    installDocumentSyncQueue(db);
    const generation=dueDocuments(db)[0].generation;
    db.exec("INSERT INTO invoice_items(invoice_id,product_name,quantity,unit_price,total_price) VALUES(1,'Bread',4,5,20)");
    assert.ok(dueDocuments(db)[0].generation>generation);
    const before=db.prepare('SELECT invoice_number,total_amount,paid_amount FROM invoices').get();
    await trackDocumentUpload(db,'invoice',1,()=>true,async()=>{db.exec("UPDATE invoices SET drive_file_id='verified_fixture' WHERE id=1");return {success:true}});
    assert.equal(documentSyncStatus(db).pending,0);
    assert.deepEqual(db.prepare('SELECT invoice_number,total_amount,paid_amount FROM invoices').get(),before);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
    assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
  }finally{db.close()}
});

test('document edits enqueue transactionally, finance-only changes do not, cancellation/deletion retire work', () => {
  const db=fixture(); try {
    installDocumentSyncQueue(db);
    assert.throws(()=>db.transaction(()=>{db.exec('UPDATE invoices SET document_revision=2 WHERE id=2');throw new Error('rollback')})());
    assert.equal(documentSyncStatus(db).pending,2);
    db.exec('UPDATE invoices SET total_amount=41 WHERE id=2');
    assert.equal(documentSyncStatus(db).pending,2);
    db.exec('UPDATE invoices SET document_revision=2 WHERE id=2');
    assert.equal(documentSyncStatus(db).pending,3);
    db.exec("UPDATE invoices SET status='cancelled' WHERE id=2;DELETE FROM credit_notes WHERE id=1");
    assert.equal(documentSyncStatus(db).pending,1);
  } finally {db.close()}
});

test('regenerating a saved PDF queues it again without modifying invoice data; normal IPC queues only on Writer', async () => {
  const db=fixture();try{
    installDocumentSyncQueue(db);
    const before=db.prepare('SELECT * FROM invoices WHERE id=2').get();
    queueInvoiceDocument(db,2);
    await trackDocumentUpload(db,'invoice',2,()=>true,async()=>({success:true}));
    queueInvoiceDocument(db,2);
    assert.ok(dueDocuments(db).some(x=>x.kind==='invoice'&&x.document_id===2));
    assert.deepEqual(db.prepare('SELECT * FROM invoices WHERE id=2').get(),before);
    const source=readFileSync(new URL('../ipc/systemHandlers.ts',import.meta.url),'utf8');
    assert.match(source,/if \(getDeviceRole\(\) === 'writer'\) queueInvoiceDocument\(db,options.invoiceId\)/);
  }finally{db.close()}
});

test('failed upload survives restart and success is recorded only after verification', async () => {
  const directory=mkdtempSync(path.join(os.tmpdir(),'vr-document-queue-'));
  const file=path.join(directory,'fixture.db'); let db=fixture(file);
  try {
    installDocumentSyncQueue(db);
    const result=await trackDocumentUpload(db,'invoice',1,()=>true,async()=>({success:false,error:'Synthetic network failure',retryable:true}));
    assert.equal(result.success,false);
    assert.equal(dueDocuments(db).some(x=>x.kind==='invoice'),false);
    db.close(); db=new Database(file);
    assert.equal(documentSyncStatus(db).items.find(x=>x.kind==='invoice')?.attempts,1);
    assert.ok(dueDocuments(db,Date.now()+100000).some(x=>x.kind==='invoice'));
    await trackDocumentUpload(db,'invoice',1,()=>true,async()=>({success:true}));
    assert.equal(documentSyncStatus(db).pending,1);
  } finally {db.close();rmSync(directory,{recursive:true,force:true})}
});

test('an edit, cancellation, role switch or database replacement during upload never acknowledges stale work', async () => {
  for (const mode of ['edit','cancel','role','database']) {
    const db=fixture(); try {
      installDocumentSyncQueue(db); let current=true;
      const result=await trackDocumentUpload(db,'invoice',1,()=>current,async()=>{
        if(mode==='edit')db.exec('UPDATE invoices SET document_revision=2 WHERE id=1');
        else if(mode==='cancel')db.exec("UPDATE invoices SET status='cancelled' WHERE id=1");
        else current=false;
        return {success:true};
      });
      assert.equal(result.success,false);
      const job=db.prepare("SELECT state,attempts FROM document_sync_queue WHERE kind='invoice' AND document_id=1").get() as any;
      if(mode==='cancel') assert.equal(job,undefined);
      else assert.deepEqual(job,{state:'pending',attempts:0});
    } finally {db.close()}
  }
});

test('Viewer and nonexistent IDs perform no IO, permission errors block until explicit retry', async () => {
  const db=fixture(); try {
    installDocumentSyncQueue(db);let calls=0;
    const upload=async()=>{calls++;return {success:true}};
    await trackDocumentUpload(db,'invoice',1,()=>false,upload);
    await trackDocumentUpload(db,'invoice',999,()=>true,upload);
    assert.equal(calls,0);
    await trackDocumentUpload(db,'invoice',1,()=>true,async()=>documentSyncFailure({response:{status:403}}));
    assert.equal(documentSyncStatus(db).blocked,1);
    assert.ok(!dueDocuments(db,Number.MAX_SAFE_INTEGER).some(x=>x.kind==='invoice'));
    retryDocumentSync(db);
    assert.equal(documentSyncStatus(db).blocked,0);
    assert.ok(dueDocuments(db).some(x=>x.kind==='invoice'));
    assert.equal(isChannelAllowedForRole('viewer','system:documentSyncStatus'),true);
    assert.equal(isChannelAllowedForRole('viewer','system:retryDocumentSync'),false);
  } finally {db.close()}
});

test('retries stop after eight failures and do not report success for unverified bytes', async () => {
  const db=fixture();try {
    installDocumentSyncQueue(db);
    for(let attempt=0;attempt<8;attempt++) await trackDocumentUpload(db,'invoice',1,()=>true,async()=>({success:false,retryable:true,error:'Checksum mismatch'}));
    assert.equal(documentSyncStatus(db).blocked,1);
    assert.equal(documentSyncStatus(db).items.find(x=>x.kind==='invoice')?.attempts,8);
  } finally {db.close()}
});

test('provider errors expose actionable categories without leaking raw payloads', () => {
  for(const code of [401,403,404,429,500]) {
    const result=documentSyncFailure({response:{status:code},message:'secret-token-private-client'});
    assert.doesNotMatch(result.error,/secret-token|private-client/);
    assert.equal(result.retryable,[429,500].includes(code));
  }
  assert.equal(documentSyncFailure({response:{status:403,data:{error:{errors:[{reason:'rateLimitExceeded'}]}}}}).retryable,true);
});

test('a retried invoice revision renders identical bytes without changing its visible content', () => {
  const settings={invoiceSeries:'FIX',issuerName:'Fixture issuer'};
  const data={invoiceNumber:'FIX-1',invoiceDate:'2026-09-08',client:{name:'Fixture'},items:[{productName:'Bread',quantity:1,unitPrice:2,totalPrice:2}],totalAmount:2};
  const metadata={fileId:'12345678901234567890123456789012',creationDate:'2026-09-08'};
  const first=generateInvoicePDF(settings,data,metadata);
  assert.deepEqual(generateInvoicePDF(settings,data,metadata),first);
  assert.notDeepEqual(generateInvoicePDF(settings,{...data,totalAmount:3},metadata),first);
});
