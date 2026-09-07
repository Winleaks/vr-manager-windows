import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { initialSchema } from "./schema.ts";
import {
  acknowledgeBillingDelivery,
  installBillingPublication,
  moneyInPence,
  prepareBillingDelivery,
} from "./billingPublication.ts";
import {
  recordCompanyPaymentTransaction,
} from "./repositories/billingTransactions.ts";
const company = "11111111-1111-4111-8111-111111111111",
  store = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(initialSchema);
  db.transaction(() => installBillingPublication(db))();
  db.prepare("INSERT INTO clients(id,name)VALUES(1,'Client')").run();
  db.prepare(
    "INSERT INTO companies(id,client_id,name,supabase_company_id)VALUES(1,1,'Company',?)",
  ).run(company);
  db.prepare(
    "INSERT INTO stores(id,company_id,name,supabase_store_id)VALUES(1,1,'Store',?)",
  ).run(store);
  db.prepare(
    "INSERT INTO invoices(id,store_id,invoice_number,invoice_date,total_amount,paid_amount,status)VALUES(1,1,'101','2026-09-01',10,0,'unpaid')",
  ).run();
  return db;
}
test("transaction rollback does not enqueue financial changes", () => {
  const db = fixture();
  try {
    const before = db.prepare("SELECT * FROM billing_publication_queue").get();
    assert.throws(() =>
      db.transaction(() => {
        db.prepare("UPDATE invoices SET paid_amount=5 WHERE id=1").run();
        throw Error("abort");
      })()
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM billing_publication_queue").get(),
      before,
    );
  } finally {
    db.close();
  }
});
test("immutable retry payload and ack preserve newer payment and credit changes", () => {
  const db = fixture();
  try {
    const first = prepareBillingDelivery(db, 1);
    recordCompanyPaymentTransaction(db, {
      companyId: 1,
      amount: 15,
      paymentDate: "2026-09-07",
      method: "cash",
    });
    assert.deepEqual(prepareBillingDelivery(db, 1), first);
    acknowledgeBillingDelivery(db, 1, first.revision);
    const next = prepareBillingDelivery(db, 1);
    assert.equal(next.credit, 500);
    assert.equal(next.invoices[0].paid, 1000);
    assert.ok(next.revision > first.revision);
  } finally {
    db.close();
  }
});
test("delete leaves explicit tombstone and document changes invalidate references", () => {
  const db = fixture();
  try {
    db.prepare(
      "UPDATE invoices SET drive_file_id='drive_file_1234567890' WHERE id=1",
    ).run();
    db.prepare(
      "INSERT INTO invoice_items(invoice_id,product_name,quantity,unit_price,total_price)VALUES(1,'Bread',1,10,10)",
    ).run();
    assert.equal(
      (db.prepare("SELECT drive_file_id FROM invoices").get() as any)
        .drive_file_id,
      null,
    );
    db.transaction(()=>{db.prepare('DELETE FROM invoice_items WHERE invoice_id=1').run();db.prepare('DELETE FROM invoices WHERE id=1').run();})();
    const next = prepareBillingDelivery(db, 1);
    assert.deepEqual(next.deleted, ["1"]);
    assert.equal(next.invoices.length, 0);
  } finally {
    db.close();
  }
});
test("invalid or duplicate external mappings block publication", () => {
  const db = fixture();
  try {
    db.prepare("UPDATE stores SET supabase_store_id=NULL").run();
    assert.throws(() => prepareBillingDelivery(db, 1), /asociere/);
    db.prepare("UPDATE stores SET supabase_store_id=?").run(store);
    db.prepare(
      "INSERT INTO companies(client_id,name,supabase_company_id)VALUES(1,'Duplicate',?)",
    ).run(company);
    assert.throws(() => prepareBillingDelivery(db, 1), /duplicată/);
  } finally {
    db.close();
  }
});
test("currency is integer pence and invalid amounts fail", () => {
  assert.equal(moneyInPence(0.29), 29);
  assert.throws(() => moneyInPence(NaN));
  assert.throws(() => moneyInPence(-1));
});

test('upgrade queues invoices created yesterday and older, including credit settlements', async()=>{
 const {ensureBillingIssuerSchema}=await import('./billingIssuers.ts');
 const {ensureCreditNoteSchema,getInvoiceFinancials}=await import('./creditNotes.ts');
 const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(initialSchema);
 try {
  db.exec("INSERT INTO clients(id,name)VALUES(1,'Client')");
  db.prepare("INSERT INTO companies(id,client_id,name,supabase_company_id,credit_balance)VALUES(1,1,'Company',?,12)").run(company);
  db.prepare("INSERT INTO stores(id,company_id,name,supabase_store_id)VALUES(1,1,'Store',?)").run(store);
  db.exec("INSERT INTO invoices(id,store_id,invoice_number,invoice_date,total_amount,paid_amount)VALUES(1,1,'TGB-1','2026-09-06',100,20),(2,1,'TGB-2','2025-01-01',50,0)");
  ensureBillingIssuerSchema(db);ensureCreditNoteSchema(db);
  const issuer=(db.prepare("SELECT id FROM billing_issuers WHERE code='goodness'").get() as any).id;
  db.prepare("INSERT INTO credit_notes(company_id,issuer_id,reference,series,sequence_number,issue_date,reason,issuer_snapshot_json,customer_snapshot_json,net_amount,total_amount)VALUES(1,?,'CN-TGB-1','CN-TGB',1,'2026-09-06','Return','{}','{}',10,10)").run(issuer);
  db.exec('INSERT INTO credit_note_invoice_links(credit_note_id,invoice_id,credited_net,credited_total)VALUES(1,1,10,10)');
  db.exec("INSERT INTO invoice_credit_applications(credit_entry_id,invoice_id,amount,reason)VALUES(1,1,5,'Existing credit')");
  db.transaction(()=>installBillingPublication(db))();
  const snapshot=prepareBillingDelivery(db,1);
  assert.equal(snapshot.invoices.length,2);assert.equal(snapshot.credit,1200);
  assert.equal(snapshot.invoices[0].outstanding,6500);
  assert.equal(snapshot.invoices[0].outstanding,Math.round(getInvoiceFinancials(db,1).outstanding*100));
  assert.equal(snapshot.invoices[1].date,'2025-01-01');
  acknowledgeBillingDelivery(db,1,snapshot.revision);
  db.exec("UPDATE invoices SET status='cancelled' WHERE id=2");
  const cancelled=prepareBillingDelivery(db,1);assert.equal(cancelled.invoices[1].outstanding,0);assert.equal(cancelled.invoices[1].cancelled,true);
  assert.ok(cancelled.revision>snapshot.revision);
 } finally {db.close();}
});
