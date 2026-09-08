import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {initialSchema} from './schema.ts';
import {installBillingPublication,prepareBillingDelivery} from './billingPublication.ts';
import {installInvoiceDriveIdentity} from './invoiceDriveIdentity.ts';
import {createInvoiceBatchTransaction,createWeeklyInvoiceBatchTransaction,updateInvoiceTransaction} from './repositories/billingTransactions.ts';

test('migration 20 preserves published IDs and finances, rolls back, and transport identity survives edits',()=>{
  const db=new Database(':memory:');try{
    db.pragma('foreign_keys=ON');db.exec(initialSchema);installBillingPublication(db);
    db.exec("INSERT INTO clients(id,name) VALUES(1,'Fixture');INSERT INTO companies(id,client_id,name,supabase_company_id) VALUES(1,1,'Fixture','11111111-1111-4111-8111-111111111111');INSERT INTO stores(id,company_id,name,supabase_store_id) VALUES(1,1,'Fixture','22222222-2222-4222-8222-222222222222');INSERT INTO invoices(id,store_id,invoice_number,invoice_date,total_amount,paid_amount,drive_file_id) VALUES(1,1,'FIX-1','2026-09-08',20,0,'existing_drive_123')");
    const before=db.prepare('SELECT * FROM invoices').get();
    assert.throws(()=>db.transaction(()=>{installInvoiceDriveIdentity(db);throw new Error('rollback')})());
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='invoice_drive_identity'").get(),undefined);
    db.transaction(()=>installInvoiceDriveIdentity(db))();assert.deepEqual(db.prepare('SELECT * FROM invoices').get(),before);
    db.exec('UPDATE invoices SET total_amount=25 WHERE id=1');
    assert.equal((db.prepare('SELECT drive_file_id FROM invoices').get() as any).drive_file_id,null);
    assert.equal((db.prepare('SELECT file_id FROM invoice_drive_identity').get() as any).file_id,'existing_drive_123');
    db.exec("UPDATE invoices SET drive_file_id='existing_drive_123' WHERE id=1");
    assert.equal(prepareBillingDelivery(db,1).invoices[0].drive_file_id,'existing_drive_123');
    assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
  }finally{db.close()}
});
test('unchanged normal/imported save preserves line IDs, PDF reference, document revision and publication queue',()=>{
  for(const imported of [false,true]){
    const db=new Database(':memory:');try{
      db.exec(initialSchema);installBillingPublication(db);
      db.exec("INSERT INTO clients(id,name) VALUES(1,'Fixture');INSERT INTO companies(id,client_id,name) VALUES(1,1,'Fixture');INSERT INTO stores(id,company_id,name) VALUES(1,1,'Fixture')");
      const item={productName:'Bread',quantity:2,unitPrice:3};
      const [invoice]=imported?createWeeklyInvoiceBatchTransaction(db,[{storeId:1,storeExternalId:'22222222-2222-4222-8222-222222222222',periodStart:'2026-09-07',periodEnd:'2026-09-13',sourceFingerprint:'a'.repeat(64),sourceOrders:[{id:'33333333-3333-4333-8333-333333333333',updatedAt:'2026-09-08T12:00:00Z'}],items:[item]}],'2026-09-08'):
        createInvoiceBatchTransaction(db,[{storeId:1,items:[item]}],'2026-09-08');
      db.exec("UPDATE invoices SET drive_file_id='known_invoice_123'");
      const before=db.prepare('SELECT * FROM invoices').all(),lines=db.prepare('SELECT * FROM invoice_items').all(),queue=db.prepare('SELECT * FROM billing_publication_queue').all();
      const id=(lines[0] as any).id;
      updateInvoiceTransaction(db,invoice.invoiceId,invoice.invoiceNumber,'2026-09-08',[{...item,id}]);
      assert.deepEqual(db.prepare('SELECT * FROM invoices').all(),before);assert.deepEqual(db.prepare('SELECT * FROM invoice_items').all(),lines);assert.deepEqual(db.prepare('SELECT * FROM billing_publication_queue').all(),queue);
      updateInvoiceTransaction(db,invoice.invoiceId,invoice.invoiceNumber,'2026-09-08',[{...item,id,unitPrice:4}]);
      assert.equal((db.prepare('SELECT total_amount FROM invoices').get() as any).total_amount,8);
    }finally{db.close()}
  }
});
