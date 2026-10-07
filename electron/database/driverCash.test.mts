import {processDriverCashBatch} from '../integrations/driverCashProcessor.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { initialSchema } from './schema.ts';
import { ensureBillingIssuerSchema } from './billingIssuers.ts';
import { ensureCreditNoteSchema } from './creditNotes.ts';
import { installBillingPublication } from './billingPublication.ts';
import { installDriverCash,applyDriverCash,type DriverCashCommand } from './driverCash.ts';
import { updatePaymentTransaction } from './repositories/billingTransactions.ts';
function fixture() {
 const db=new Database(':memory:');db.exec(initialSchema);ensureBillingIssuerSchema(db);ensureCreditNoteSchema(db);installBillingPublication(db);installDriverCash(db);
 const issuer=(db.prepare('SELECT id FROM billing_issuers ORDER BY id LIMIT 1').get() as any).id;
 db.prepare('INSERT INTO clients(id,name) VALUES(1,?)').run('Client');
 const company=randomUUID(),store=randomUUID(),driver=randomUUID();
 db.prepare('INSERT INTO companies(id,client_id,name,supabase_company_id,issuer_id) VALUES(1,1,?,?,?)').run('Company',company,issuer);
 db.prepare('INSERT INTO stores(id,company_id,name,supabase_store_id) VALUES(1,1,?,?)').run('Store',store);
 for (let n=1;n<=2;n++) {
  db.prepare("INSERT INTO invoices(id,store_id,invoice_number,invoice_date,total_amount,paid_amount,status) VALUES(?,1,?, ?,50,0,'unpaid')").run(n,'INV'+n,'2026-10-0'+n);
  db.prepare("INSERT INTO invoice_identities(invoice_id,issuer_id,sequence_number,series,reference,issuer_snapshot_json) VALUES(?,?,?,'TEST',?,'{}')").run(n,issuer,n,'INV'+n);
 }
 const root=randomUUID();const command:DriverCashCommand={operation_id:root,root_operation_id:root,previous_operation_id:null,revision:1,recorded_at_ms:Date.parse('2026-10-07T03:00:00Z'),amount_pence:12500,driver_id:driver,driver_name:'Driver',store_id:store,store_name:'Store',company_id:company};
 return {db,command};
}
test('oldest invoices, surplus credit, exact replay and grouped reduction are atomic',()=>{
 const {db,command}=fixture();const r=applyDriverCash(db,command,'2026-10-07');assert.deepEqual(applyDriverCash(db,command,'2026-10-07'),r);
 assert.deepEqual(db.prepare('SELECT paid_amount FROM invoices ORDER BY id').all(),[{paid_amount:50},{paid_amount:50}]);
 assert.equal((db.prepare('SELECT SUM(balance) AS value FROM company_issuer_credits').get() as any).value,25);
 assert.equal((db.prepare('SELECT COUNT(*) AS value FROM cash_transactions').get() as any).value,1);
 assert.throws(()=>applyDriverCash(db,{...command,amount_pence:1}),/alte date/);
 const correction={...command,operation_id:randomUUID(),previous_operation_id:command.operation_id,revision:2,amount_pence:3000};applyDriverCash(db,correction,'2026-10-08');
 assert.deepEqual(db.prepare('SELECT paid_amount FROM invoices ORDER BY id').all(),[{paid_amount:30},{paid_amount:0}]);
 assert.equal((db.prepare('SELECT SUM(balance) AS value FROM company_issuer_credits').get() as any).value,0);
 assert.equal((db.prepare("SELECT SUM(CASE WHEN type='IN' THEN amount ELSE -amount END) AS value FROM cash_transactions").get() as any).value,30);
 const zero={...correction,operation_id:randomUUID(),previous_operation_id:correction.operation_id,revision:3,amount_pence:0};applyDriverCash(db,zero,'2026-10-08');
 assert.equal((db.prepare('SELECT SUM(paid_amount) AS value FROM invoices').get() as any).value,0);
 db.close();
});
test('No, then cash with no invoices becomes credit and direct allocation edits are denied',()=>{
 const {db,command}=fixture();db.exec('DELETE FROM invoice_identities;DELETE FROM invoices;');applyDriverCash(db,{...command,amount_pence:0},'2026-10-07');
 const next={...command,operation_id:randomUUID(),previous_operation_id:command.operation_id,revision:2,amount_pence:1001};applyDriverCash(db,next,'2026-10-07');
 const payment=db.prepare('SELECT * FROM payments').get() as any;assert.equal(payment.amount,10.01);assert.equal(payment.invoice_id,null);
 assert.throws(()=>updatePaymentTransaction(db,{id:payment.id,amount:3,method:'cash',reason:'test',operationId:randomUUID(),expectedRevision:0}),/suma întreagă/);
 db.close();
});
test('consumed credit and injected write failure preserve money, cash and queue',()=>{
 const {db,command}=fixture();applyDriverCash(db,command,'2026-10-07');db.exec('UPDATE company_credit_entries SET available_amount=0;');
 const next={...command,operation_id:randomUUID(),previous_operation_id:command.operation_id,revision:2,amount_pence:0};
 assert.throws(()=>applyDriverCash(db,next,'2026-10-07'),/utilizat/);
 assert.equal((db.prepare('SELECT amount_pence FROM driver_cash_receipts').get() as any).amount_pence,12500);
 assert.equal((db.prepare('SELECT SUM(paid_amount) AS value FROM invoices').get() as any).value,100);
 db.exec('UPDATE company_credit_entries SET available_amount=original_amount;CREATE TRIGGER reject_cash BEFORE INSERT ON cash_transactions BEGIN SELECT RAISE(ABORT,\'injected\');END;');
 assert.throws(()=>applyDriverCash(db,{...next,amount_pence:3000},'2026-10-07'),/injected/);
 assert.equal((db.prepare('SELECT SUM(paid_amount) AS value FROM invoices').get() as any).value,100);
 assert.equal((db.prepare('SELECT COUNT(*) AS value FROM driver_cash_operations').get() as any).value,1);db.close();
});
test('closed current day reopens with audit; unknown mapping rolls back completely',()=>{
 const {db,command}=fixture();db.exec("INSERT INTO cash_days(date,opening_balance,is_closed,closing_balance) VALUES('2026-10-07',0,1,0);");
 applyDriverCash(db,command,'2026-10-07');assert.equal((db.prepare('SELECT is_closed FROM cash_days').get() as any).is_closed,0);
 assert.equal((db.prepare("SELECT count(*) AS value FROM cash_day_events WHERE event_type='reopen'").get() as any).value,1);
 assert.throws(()=>applyDriverCash(db,{...command,operation_id:randomUUID(),root_operation_id:randomUUID(),store_id:randomUUID()}),/inițială/);db.close();
});

test('lost acknowledgment retries once without duplicating money and restored older ledger stops',async()=>{
 const {db,command}=fixture();let cursor=0;let sent=0;
 const input={...command,sequence_id:1,state:'PENDING'};
 const deps={current:()=>true,verifyCompany:()=>{},saveCursor:(n:number)=>{cursor=n;},ack:async()=>{sent++;if(sent===1)throw new Error('lost response');}};
 await assert.rejects(processDriverCashBatch(db,[input],'writer',deps),/lost response/);
 assert.equal(cursor,0);assert.equal((db.prepare('SELECT COUNT(*) AS count FROM cash_transactions').get() as any).count,1);
 await processDriverCashBatch(db,[{...input,driver_name:'Updated driver label'}],'writer',deps);
 assert.equal(cursor,1);assert.equal((db.prepare('SELECT COUNT(*) AS count FROM cash_transactions').get() as any).count,1);
 const other=fixture();await assert.rejects(processDriverCashBatch(other.db,[{...input,state:'PROCESSED'}],'writer',deps),/restaurarea/);
 assert.equal((other.db.prepare('SELECT COUNT(*) AS count FROM payments').get() as any).count,0);
 db.close();other.db.close();
});
test('two stores share oldest-invoice allocation without crossing company or issuer',()=>{
 const {db,command}=fixture();const issuer=(db.prepare('SELECT issuer_id FROM companies WHERE id=1').get() as any).issuer_id;
 db.exec("INSERT INTO stores(id,company_id,name) VALUES(2,1,'Other store');UPDATE invoices SET store_id=2 WHERE id=1;");
 const foreign=(db.prepare('SELECT id FROM billing_issuers WHERE id!=? LIMIT 1').get(issuer) as any).id;
 db.prepare("INSERT INTO invoices(id,store_id,invoice_number,invoice_date,total_amount,paid_amount,status) VALUES(3,1,'OTHER','2020-01-01',100,0,'unpaid')").run();
 db.prepare("INSERT INTO invoice_identities(invoice_id,issuer_id,series,sequence_number,reference,issuer_snapshot_json) VALUES(3,?,'OTHER',1,'OTHER','{}')").run(foreign);
 applyDriverCash(db,{...command,amount_pence:6000},'2026-10-07');
 assert.deepEqual(db.prepare('SELECT paid_amount FROM invoices ORDER BY id').all(),[{paid_amount:50},{paid_amount:10},{paid_amount:0}]);db.close();
});

test('missing explicit company is retained as a conflict without assigning cash by label',async()=>{
 const {db,command}=fixture();let acknowledged:any;
 await processDriverCashBatch(db,[{...command,company_id:null,sequence_id:1,state:'PENDING'}],'writer',{
  current:()=>true,verifyCompany:()=>{},saveCursor:()=>{},ack:async(payload)=>{acknowledged=payload;},
 });
 assert.equal(acknowledged.state,'CONFLICT');assert.match(acknowledged.result.error,/Asocierea/);
 assert.equal((db.prepare('SELECT COUNT(*) AS value FROM payments').get() as any).value,0);
 assert.equal((db.prepare('SELECT COUNT(*) AS value FROM cash_transactions').get() as any).value,0);db.close();
});
