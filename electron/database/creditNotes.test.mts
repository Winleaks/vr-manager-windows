import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initialSchema } from './schema.ts';
import { ensureBillingIssuerSchema } from './billingIssuers.ts';
import {
  applyCompanyCreditTransaction,
  cancelCreditNoteTransaction,
  createCreditNoteTransaction,
  ensureCreditNoteSchema,
  getCreditNoteDraft,
  getInvoiceFinancials,
} from './creditNotes.ts';
import {
  deleteInvoiceForTestingTransaction,
  setBillingTestModeTransaction,
  updateInvoiceTransaction,
} from './repositories/billingTransactions.ts';

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dateWithOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function fixture() {
  const connection = new Database(':memory:');
  connection.pragma('foreign_keys = ON');
  connection.exec(initialSchema);
  const clientId = Number(connection.prepare("INSERT INTO clients (name) VALUES ('Client')").run().lastInsertRowid);
  const companyId = Number(connection.prepare("INSERT INTO companies (client_id, name, address, credit_balance) VALUES (?, 'Bakery Client LTD', 'London', 12.5)").run(clientId).lastInsertRowid);
  const otherCompanyId = Number(connection.prepare("INSERT INTO companies (client_id, name) VALUES (?, 'Other Client LTD')").run(clientId).lastInsertRowid);
  const store1 = Number(connection.prepare("INSERT INTO stores (company_id, name) VALUES (?, 'Store One')").run(companyId).lastInsertRowid);
  const store2 = Number(connection.prepare("INSERT INTO stores (company_id, name) VALUES (?, 'Store Two')").run(companyId).lastInsertRowid);
  const otherStore = Number(connection.prepare("INSERT INTO stores (company_id, name) VALUES (?, 'Other Store')").run(otherCompanyId).lastInsertRowid);
  ensureBillingIssuerSchema(connection);
  ensureCreditNoteSchema(connection);
  ensureCreditNoteSchema(connection);
  const goodness = connection.prepare("SELECT * FROM billing_issuers WHERE code = 'goodness'").get() as any;
  connection.prepare("UPDATE billing_issuers SET address = 'London', company_number = '123', bank_name_1 = 'Bank', account_number_1 = '12345678', sort_code_1 = '12-34-56', vat_number = 'GB123', credit_note_series = 'CN-TGB', next_credit_note_number = 7, credit_note_sequence_confirmed = 1, is_active = 1 WHERE id = ?").run(goodness.id);
  const productId = Number(connection.prepare("INSERT INTO finished_products (name, name_ro, external_product_id, current_stock) VALUES ('Bread', 'Pâine', 'product-1', 3)").run().lastInsertRowid);

  function invoice(storeId: number, number: string, total = 20, paid = 0) {
    const invoiceId = Number(connection.prepare("INSERT INTO invoices (store_id, invoice_number, invoice_date, total_amount, paid_amount, status) VALUES (?, ?, ?, ?, ?, ?)").run(storeId, number, today(), total, paid, paid >= total ? 'paid' : 'unpaid').lastInsertRowid);
    connection.prepare('INSERT INTO invoice_identities (invoice_id, issuer_id, series, sequence_number, reference, issuer_snapshot_json) VALUES (?, ?, ?, ?, ?, ?)').run(invoiceId, goodness.id, 'TGB', Number(number.replace(/\D/g, '')) || invoiceId, number, JSON.stringify({ issuerName: 'THE GOODNESS BAKER LTD' }));
    const itemId = Number(connection.prepare("INSERT INTO invoice_items (invoice_id, product_name, product_name_ro, unit, quantity, unit_price, total_price, external_product_id, finished_product_id) VALUES (?, 'Bread', 'Pâine', 'buc', 4, 5, 20, 'product-1', ?)").run(invoiceId, productId).lastInsertRowid);
    return { invoiceId, itemId };
  }
  return { connection, companyId, otherCompanyId, store1, store2, otherStore, issuerId: goodness.id, productId, invoice };
}

test('v13 migration preserves an existing issuer credit once and suggests unconfirmed series', () => {
  const { connection, companyId, issuerId } = fixture();
  try {
    const entries = connection.prepare("SELECT source_type, original_amount, available_amount FROM company_credit_entries WHERE company_id = ? AND issuer_id = ?").all(companyId, issuerId);
    assert.deepEqual(entries, [{ source_type: 'legacy', original_amount: 12.5, available_amount: 12.5 }]);
    assert.equal((connection.prepare("SELECT value FROM app_settings WHERE key = 'credit_ledger_migrated_v13'").get() as any).value, '1');
  } finally { connection.close(); }
});

test('invoice corrections remain blocked for issued Credit Notes and active applied credit', () => {
  const { connection, companyId, store1, issuerId, invoice } = fixture();
  try {
    const credited = invoice(store1, 'TGB-31');
    createCreditNoteTransaction(connection, { issueDate: today(), reason: 'Retur', items: [{ invoiceItemId: credited.itemId, quantity: 1, unitAmount: 5 }] });
    const applied = invoice(store1, 'TGB-32');
    applyCompanyCreditTransaction(connection, { companyId, issuerId, invoiceId: applied.invoiceId, amount: 2, reason: 'Credit existent' });
    for (const target of [credited, applied]) {
      const before = connection.prepare('SELECT * FROM invoices WHERE id = ?').get(target.invoiceId);
      const beforeItems = connection.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(target.invoiceId);
      assert.throws(() => updateInvoiceTransaction(connection, target.invoiceId, 'TGB-31', today(), [{ id: target.itemId, productName: 'Bread', quantity: 2, unitPrice: 8 }]), /Credit Notes sau credit aplicat/);
      assert.deepEqual(connection.prepare('SELECT * FROM invoices WHERE id = ?').get(target.invoiceId), before);
      assert.deepEqual(connection.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(target.invoiceId), beforeItems);
    }
  } finally { connection.close(); }
});

test('issues one Credit Note across stores, keeps an independent number and returns selected stock', () => {
  const { connection, store1, store2, issuerId, productId, invoice } = fixture();
  try {
    const first = invoice(store1, 'TGB-1');
    const second = invoice(store2, 'TGB-2');
    const result = createCreditNoteTransaction(connection, {
      issueDate: today(), reason: 'Marfă deteriorată',
      items: [
        { invoiceItemId: first.itemId, quantity: 1, unitAmount: 5, returnToStock: true },
        { invoiceItemId: second.itemId, quantity: 2, unitAmount: 2.5 },
      ],
    });
    assert.equal(result.reference, 'CN-TGB-7');
    assert.equal(result.totalAmount, 10);
    assert.equal((connection.prepare('SELECT next_credit_note_number FROM billing_issuers WHERE id = ?').get(issuerId) as any).next_credit_note_number, 8);
    assert.equal((connection.prepare('SELECT current_stock FROM finished_products WHERE id = ?').get(productId) as any).current_stock, 4);
    assert.equal(getInvoiceFinancials(connection, first.invoiceId).creditedAmount, 5);
    assert.equal(getInvoiceFinancials(connection, second.invoiceId).creditedAmount, 5);
    assert.equal(getCreditNoteDraft(connection, [first.invoiceId])[0].items[0].remainingQuantity, 3);
  } finally { connection.close(); }
});

test('rejects over-crediting and mixing companies without advancing the counter', () => {
  const { connection, store1, otherStore, issuerId, invoice } = fixture();
  try {
    const first = invoice(store1, 'TGB-1');
    const other = invoice(otherStore, 'TGB-2');
    assert.throws(() => createCreditNoteTransaction(connection, { issueDate: today(), reason: 'Corecție', items: [{ invoiceItemId: first.itemId, quantity: 5, unitAmount: 5 }] }), /depășește/);
    assert.throws(() => createCreditNoteTransaction(connection, { issueDate: today(), reason: 'Corecție', items: [{ invoiceItemId: first.itemId, quantity: 1, unitAmount: 5 }, { invoiceItemId: other.itemId, quantity: 1, unitAmount: 5 }] }), /aceleiași companii/);
    assert.equal((connection.prepare('SELECT next_credit_note_number FROM billing_issuers WHERE id = ?').get(issuerId) as any).next_credit_note_number, 7);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM credit_notes').get() as any).value, 0);
  } finally { connection.close(); }
});

test('blocks unconfirmed numbering and invalid issue dates without consuming a number', () => {
  const { connection, store1, issuerId, invoice } = fixture();
  try {
    const source = invoice(store1, 'TGB-1');
    connection.prepare('UPDATE billing_issuers SET credit_note_sequence_confirmed = 0 WHERE id = ?').run(issuerId);
    assert.throws(() => createCreditNoteTransaction(connection, { issueDate: today(), reason: 'Corecție', items: [{ invoiceItemId: source.itemId, quantity: 1, unitAmount: 5 }] }), /Confirmă seria/);
    connection.prepare('UPDATE billing_issuers SET credit_note_sequence_confirmed = 1 WHERE id = ?').run(issuerId);
    assert.throws(() => createCreditNoteTransaction(connection, { issueDate: dateWithOffset(1), reason: 'Corecție', items: [{ invoiceItemId: source.itemId, quantity: 1, unitAmount: 5 }] }), /viitor/);
    assert.throws(() => createCreditNoteTransaction(connection, { issueDate: dateWithOffset(-1), reason: 'Corecție', backdateReason: 'Corecție contabilă', items: [{ invoiceItemId: source.itemId, quantity: 1, unitAmount: 5 }] }), /înaintea celei mai recente facturi/);
    assert.equal((connection.prepare('SELECT next_credit_note_number FROM billing_issuers WHERE id = ?').get(issuerId) as any).next_credit_note_number, 7);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM credit_notes').get() as any).value, 0);
  } finally { connection.close(); }
});

test('paid invoice creates issuer credit, applies it FIFO and cancellation reverses the cascade and stock', () => {
  const { connection, companyId, store1, issuerId, productId, invoice } = fixture();
  try {
    connection.prepare("UPDATE company_credit_entries SET status = 'reversed', available_amount = 0 WHERE source_type = 'legacy'").run();
    const paid = invoice(store1, 'TGB-1', 20, 20);
    const target = invoice(store1, 'TGB-2', 20, 0);
    const note = createCreditNoteTransaction(connection, { issueDate: today(), reason: 'Retur integral', items: [{ invoiceItemId: paid.itemId, quantity: 4, unitAmount: 5, returnToStock: true }] });
    assert.equal((connection.prepare('SELECT balance FROM company_issuer_credits WHERE company_id = ? AND issuer_id = ?').get(companyId, issuerId) as any).balance, 20);
    const application = applyCompanyCreditTransaction(connection, { companyId, issuerId, invoiceId: target.invoiceId, amount: 10, reason: 'Compensare aprobată' });
    assert.equal(getInvoiceFinancials(connection, target.invoiceId).outstanding, 10);
    assert.equal(application.applications.length, 1);
    assert.throws(() => cancelCreditNoteTransaction(connection, note.creditNoteId, 'Document emis greșit', false), /avertismentul contabil/);
    cancelCreditNoteTransaction(connection, note.creditNoteId, 'Document emis greșit', true);
    assert.equal(getInvoiceFinancials(connection, paid.invoiceId).creditedAmount, 0);
    assert.equal(getInvoiceFinancials(connection, target.invoiceId).outstanding, 20);
    assert.equal((connection.prepare('SELECT balance FROM company_issuer_credits WHERE company_id = ? AND issuer_id = ?').get(companyId, issuerId) as any).balance, 0);
    assert.equal((connection.prepare('SELECT current_stock FROM finished_products WHERE id = ?').get(productId) as any).current_stock, 3);
    assert.ok((connection.prepare('SELECT reversed_at FROM invoice_credit_applications WHERE id = ?').get(application.applications[0]) as any).reversed_at);
  } finally { connection.close(); }
});

test('test invoice deletion removes its Credit Note cascade and restores stock and other balances', () => {
  const { connection, companyId, store1, issuerId, productId, invoice } = fixture();
  try {
    connection.prepare("UPDATE company_credit_entries SET status = 'reversed', available_amount = 0 WHERE source_type = 'legacy'").run();
    const source = invoice(store1, 'TGB-1', 20, 20);
    const target = invoice(store1, 'TGB-2', 20, 0);
    const note = createCreditNoteTransaction(connection, {
      issueDate: today(),
      reason: 'Scenariu de test',
      items: [{ invoiceItemId: source.itemId, quantity: 4, unitAmount: 5, returnToStock: true }],
    });
    applyCompanyCreditTransaction(connection, {
      companyId,
      issuerId,
      invoiceId: target.invoiceId,
      amount: 10,
      reason: 'Aplicare test',
    });
    assert.equal((connection.prepare('SELECT current_stock FROM finished_products WHERE id = ?').get(productId) as any).current_stock, 7);
    assert.equal(getInvoiceFinancials(connection, target.invoiceId).outstanding, 10);

    setBillingTestModeTransaction(connection, true, 'MOD TEST');
    const deleted = deleteInvoiceForTestingTransaction(connection, source.invoiceId, 'STERGE TGB-1');

    assert.equal(deleted.deletedCreditNotes, 1);
    assert.equal(deleted.deletedCreditApplications, 1);
    assert.deepEqual(deleted.deletedCreditNoteReferences, [note.reference]);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoices WHERE id = ?').get(source.invoiceId) as any).value, 0);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM credit_notes WHERE id = ?').get(note.creditNoteId) as any).value, 0);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM credit_note_items WHERE credit_note_id = ?').get(note.creditNoteId) as any).value, 0);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM company_credit_entries WHERE source_type = ? AND source_id = ?').get('credit_note', note.creditNoteId) as any).value, 0);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM finished_product_movements WHERE reference_id = ?').get(note.creditNoteId) as any).value, 0);
    assert.equal((connection.prepare('SELECT current_stock FROM finished_products WHERE id = ?').get(productId) as any).current_stock, 3);
    assert.equal(getInvoiceFinancials(connection, target.invoiceId).outstanding, 20);
    assert.equal((connection.prepare('SELECT balance FROM company_issuer_credits WHERE company_id = ? AND issuer_id = ?').get(companyId, issuerId) as any).balance, 0);
    assert.equal((connection.prepare('SELECT next_credit_note_number FROM billing_issuers WHERE id = ?').get(issuerId) as any).next_credit_note_number, 7);
  } finally { connection.close(); }
});

test('test invoice cascade deletion rolls back every financial and stock change on failure', () => {
  const { connection, store1, issuerId, productId, invoice } = fixture();
  try {
    connection.prepare("UPDATE company_credit_entries SET status = 'reversed', available_amount = 0 WHERE source_type = 'legacy'").run();
    const source = invoice(store1, 'TGB-1', 20, 20);
    const note = createCreditNoteTransaction(connection, {
      issueDate: today(),
      reason: 'Scenariu rollback',
      items: [{ invoiceItemId: source.itemId, quantity: 4, unitAmount: 5, returnToStock: true }],
    });
    setBillingTestModeTransaction(connection, true, 'MOD TEST');
    connection.exec(`
      CREATE TRIGGER block_test_invoice_delete
      BEFORE DELETE ON invoices
      BEGIN
        SELECT RAISE(ABORT, 'simulated delete failure');
      END;
    `);

    assert.throws(
      () => deleteInvoiceForTestingTransaction(connection, source.invoiceId, 'STERGE TGB-1'),
      /simulated delete failure/,
    );
    assert.equal((connection.prepare('SELECT status FROM credit_notes WHERE id = ?').get(note.creditNoteId) as any).status, 'issued');
    assert.equal((connection.prepare('SELECT current_stock FROM finished_products WHERE id = ?').get(productId) as any).current_stock, 7);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoices WHERE id = ?').get(source.invoiceId) as any).value, 1);
    assert.equal((connection.prepare('SELECT next_credit_note_number FROM billing_issuers WHERE id = ?').get(issuerId) as any).next_credit_note_number, 8);
  } finally { connection.close(); }
});
