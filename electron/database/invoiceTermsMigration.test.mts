import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {initialSchema} from './schema.ts';
import {installBillingPublication,prepareBillingDelivery} from './billingPublication.ts';
import {installInvoicePaymentTerms,installSameDayInvoicePaymentTerms,readInvoicePaymentTerms} from './invoicePaymentTerms.ts';
function fixture(){const db=new Database(':memory:');db.exec(initialSchema);installBillingPublication(db);db.exec(`INSERT INTO clients(id,name)VALUES(1,'Fixture');INSERT INTO companies(id,client_id,name,supabase_company_id)VALUES(1,1,'Company','11111111-1111-4111-8111-111111111111');INSERT INTO stores(id,company_id,name,supabase_store_id)VALUES(1,1,'Store','22222222-2222-4222-8222-222222222222');INSERT INTO invoices(id,store_id,invoice_number,invoice_date,total_amount)VALUES(1,1,'1','2026-10-10',100),(2,1,'2','2026-10-05',30);INSERT INTO invoice_import_batches(invoice_id,store_external_id,period_start,period_end,source_fingerprint)VALUES(1,'22222222-2222-4222-8222-222222222222','2026-09-28','2026-10-04','fixture');`);return db;}
test('migration preserves money and prepared publications; dates persist and follow their correct source',()=>{const db=fixture();try{const before=prepareBillingDelivery(db,1);db.transaction(()=>{installInvoicePaymentTerms(db);installSameDayInvoicePaymentTerms(db);})();assert.deepEqual(prepareBillingDelivery(db,1),before);const rows=db.prepare('SELECT due_date,due_basis,total_amount FROM invoices ORDER BY id').all();assert.deepEqual(rows,[{due_date:'2026-10-08',due_basis:'weekly',total_amount:100},{due_date:'2026-10-05',due_basis:'manual',total_amount:30}]);db.exec("UPDATE invoices SET invoice_date='2026-10-12'");assert.equal((db.prepare('SELECT due_date FROM invoices WHERE id=1').get() as any).due_date,'2026-10-08');assert.equal((db.prepare('SELECT due_date FROM invoices WHERE id=2').get() as any).due_date,'2026-10-12');db.exec("UPDATE invoice_import_batches SET period_start='2026-10-05',period_end='2026-10-11'");assert.equal(readInvoicePaymentTerms(db,1,'2026-10-12').due_date,'2026-10-15');}finally{db.close();}});
test('failed upgrade rolls back all new columns without touching pending finance',()=>{const db=fixture();try{const before=db.prepare('SELECT * FROM billing_publication_queue').all();assert.throws(()=>db.transaction(()=>{installInvoicePaymentTerms(db);throw Error('power loss');})());assert.ok(!(db.prepare('PRAGMA table_info(invoices)').all() as {name:string}[]).some(c=>c.name==='due_date'));assert.deepEqual(db.prepare('SELECT * FROM billing_publication_queue').all(),before);}finally{db.close();}});
test('v24 upgrade corrects manual terms, preserves prepared deliveries and queues a new revision',()=>{
 const db=fixture();try {
  installInvoicePaymentTerms(db);
  db.exec("UPDATE invoices SET due_date='2026-10-09' WHERE id=2");
  const prepared=prepareBillingDelivery(db,1);
  const before=db.prepare('SELECT revision FROM billing_publication_queue').get() as {revision:number};
  db.transaction(()=>installSameDayInvoicePaymentTerms(db))();
  assert.deepEqual(prepareBillingDelivery(db,1),prepared);
  assert.equal((db.prepare('SELECT due_date FROM invoices WHERE id=2').get() as {due_date:string}).due_date,'2026-10-05');
  assert.ok((db.prepare('SELECT revision FROM billing_publication_queue').get() as {revision:number}).revision>before.revision);
  assert.equal((db.prepare('SELECT total_amount FROM invoices WHERE id=2').get() as {total_amount:number}).total_amount,30);
 }finally{db.close();}
});
test('same-day upgrade failure restores old terms, triggers and pending revisions',()=>{
 const db=fixture();try {
  installInvoicePaymentTerms(db);db.exec("UPDATE invoices SET due_date='2026-10-09' WHERE id=2");
  const before=db.prepare('SELECT * FROM billing_publication_queue').all();
  assert.throws(()=>db.transaction(()=>{installSameDayInvoicePaymentTerms(db);throw Error('power loss');})());
  assert.equal((db.prepare('SELECT due_date FROM invoices WHERE id=2').get() as {due_date:string}).due_date,'2026-10-09');
  assert.deepEqual(db.prepare('SELECT * FROM billing_publication_queue').all(),before);
  db.exec("UPDATE invoices SET invoice_date='2026-10-06' WHERE id=2");
  assert.equal((db.prepare('SELECT due_date FROM invoices WHERE id=2').get() as {due_date:string}).due_date,'2026-10-10');
 }finally{db.close();}
});
test('weekly reissues inherit the billed period, while manual reissues use their own date',()=>{
 const db=fixture();
 try{
  db.exec('CREATE TABLE invoice_replacements(cancelled_invoice_id INTEGER PRIMARY KEY,replacement_invoice_id INTEGER UNIQUE)');
  installInvoicePaymentTerms(db);
  installSameDayInvoicePaymentTerms(db);
  db.exec("INSERT INTO invoices(id,store_id,invoice_number,invoice_date,total_amount)VALUES(3,1,'3','2026-10-20',100),(4,1,'4','2026-10-20',30);INSERT INTO invoice_replacements VALUES(1,3),(2,4)");
  assert.equal((db.prepare('SELECT due_date FROM invoices WHERE id=3').get() as any).due_date,'2026-10-08');
  assert.equal((db.prepare('SELECT due_date FROM invoices WHERE id=4').get() as any).due_date,'2026-10-20');
  assert.equal(readInvoicePaymentTerms(db,3,'2026-10-20').due_date,'2026-10-08');
  db.exec("UPDATE invoice_import_batches SET period_start='2026-10-05',period_end='2026-10-11'");
  assert.equal((db.prepare('SELECT due_date FROM invoices WHERE id=3').get() as any).due_date,'2026-10-15');
 }finally{db.close();}
});
