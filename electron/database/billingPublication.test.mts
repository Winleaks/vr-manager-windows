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
  deleteUnpaidInvoiceTransaction,
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
    deleteUnpaidInvoiceTransaction(db, 1);
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
