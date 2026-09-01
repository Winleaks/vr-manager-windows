import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initialSchema } from './schema.ts';
import {
  assignCompanyIssuer,
  ensureBillingIssuerSchema,
  getBillingIssuers,
  updateBillingIssuer,
} from './billingIssuers.ts';
import {
  cancelInvoiceTransaction,
  createWeeklyInvoiceBatchTransaction,
  recordCompanyPaymentTransaction,
  reissueCancelledWeeklyInvoiceTransaction,
} from './repositories/billingTransactions.ts';

function issuerInput(issuer: any, overrides: Record<string, unknown> = {}) {
  return {
    id: issuer.id,
    legalName: issuer.legal_name,
    address: '1 Bakery Road, London',
    companyNumber: issuer.code === 'goodness' ? 'GOOD123' : 'VATRA123',
    vatRegistered: issuer.code === 'goodness',
    vatNumber: issuer.code === 'goodness' ? 'GB123456789' : '',
    bankName1: 'Business Bank',
    accountNumber1: '12345678',
    sortCode1: '12-34-56',
    bankName2: '', accountNumber2: '', sortCode2: '', footer: '',
    invoiceSeries: issuer.code === 'goodness' ? 'TGB' : 'VATRA',
    nextInvoiceNumber: issuer.code === 'goodness' ? 10 : 1,
    color: issuer.code === 'goodness' ? '#4F46E5' : '#B45309',
    alternateRowColor: issuer.code === 'goodness' ? '#4F46E5' : '#B45309',
    alternateRowOpacity: 5,
    isActive: true,
    ...overrides,
  };
}

function fixture() {
  const connection = new Database(':memory:');
  connection.pragma('foreign_keys = ON');
  connection.exec(initialSchema);
  connection.prepare("INSERT INTO app_settings (key, value) VALUES ('invoice_series', 'FACT'), ('invoice_start_number', '10'), ('issuer_name', 'THE GOODNESS BAKER LTD')").run();
  const clientId = Number(connection.prepare("INSERT INTO clients (name) VALUES ('Client')").run().lastInsertRowid);
  const company1 = Number(connection.prepare("INSERT INTO companies (client_id, name) VALUES (?, 'Client Goodness')").run(clientId).lastInsertRowid);
  const company2 = Number(connection.prepare("INSERT INTO companies (client_id, name) VALUES (?, 'Client Vatra')").run(clientId).lastInsertRowid);
  const store1 = Number(connection.prepare("INSERT INTO stores (company_id, name, supabase_store_id) VALUES (?, 'Store Goodness', 'store-goodness')").run(company1).lastInsertRowid);
  const store2 = Number(connection.prepare("INSERT INTO stores (company_id, name, supabase_store_id) VALUES (?, 'Store Vatra', 'store-vatra')").run(company2).lastInsertRowid);
  ensureBillingIssuerSchema(connection);
  const issuers = getBillingIssuers(connection);
  const goodness = issuers.find((issuer) => issuer.code === 'goodness')!;
  const vatra = issuers.find((issuer) => issuer.code === 'vatra')!;
  updateBillingIssuer(connection, issuerInput(goodness));
  updateBillingIssuer(connection, issuerInput(vatra));
  assignCompanyIssuer(connection, company2, vatra.id);
  return { connection, company1, company2, store1, store2, goodnessId: goodness.id, vatraId: vatra.id };
}

function weekly(storeId: number, storeExternalId: string, orderId: string) {
  return {
    storeId,
    storeExternalId,
    periodStart: '2026-08-24',
    periodEnd: '2026-08-30',
    sourceFingerprint: orderId.repeat(16).slice(0, 64),
    sourceOrders: [{ id: orderId, updatedAt: '2026-08-27T10:00:00Z' }],
    items: [{ productName: 'Bread', name_ro: 'Pâine', quantity: 2, unitPrice: 5 }],
  };
}

test('migrates the configured issuer and keeps historical invoice identity immutable', () => {
  const connection = new Database(':memory:');
  connection.pragma('foreign_keys = ON'); connection.exec(initialSchema);
  connection.prepare("INSERT INTO app_settings (key, value) VALUES ('invoice_series', 'FACT'), ('invoice_start_number', '8'), ('issuer_name', 'THE GOODNESS BAKER LTD'), ('issuer_vat', 'GB123')").run();
  const client = Number(connection.prepare("INSERT INTO clients (name) VALUES ('Client')").run().lastInsertRowid);
  const company = Number(connection.prepare("INSERT INTO companies (client_id, name, credit_balance) VALUES (?, 'Company', 12.5)").run(client).lastInsertRowid);
  const store = Number(connection.prepare("INSERT INTO stores (company_id, name) VALUES (?, 'Store')").run(company).lastInsertRowid);
  const invoice = Number(connection.prepare("INSERT INTO invoices (store_id, invoice_number, invoice_date, total_amount) VALUES (?, '7', '2026-08-01', 10)").run(store).lastInsertRowid);
  const prefixedInvoice = Number(connection.prepare("INSERT INTO invoices (store_id, invoice_number, invoice_date, total_amount) VALUES (?, 'FACT-12', '2026-08-02', 10)").run(store).lastInsertRowid);
  ensureBillingIssuerSchema(connection);
  ensureBillingIssuerSchema(connection);
  const goodness = getBillingIssuers(connection).find((issuer) => issuer.code === 'goodness')!;
  assert.equal(goodness.next_invoice_number, 13);
  assert.equal((connection.prepare('SELECT issuer_id FROM companies WHERE id = ?').get(company) as any).issuer_id, goodness.id);
  assert.deepEqual(connection.prepare('SELECT series, sequence_number, reference FROM invoice_identities WHERE invoice_id = ?').get(invoice), { series: 'FACT', sequence_number: 7, reference: 'FACT-7' });
  assert.deepEqual(connection.prepare('SELECT series, sequence_number, reference FROM invoice_identities WHERE invoice_id = ?').get(prefixedInvoice), { series: 'FACT', sequence_number: 12, reference: 'FACT-12' });
  assert.equal((connection.prepare('SELECT balance FROM company_issuer_credits WHERE company_id = ? AND issuer_id = ?').get(company, goodness.id) as any).balance, 12.5);
  connection.close();
});

test('issues a mixed batch with independent counters and immutable issuer snapshots', () => {
  const { connection, store1, store2, goodnessId, vatraId } = fixture();
  try {
    const created = createWeeklyInvoiceBatchTransaction(connection, [weekly(store1, 'store-goodness', 'order-goodness'), weekly(store2, 'store-vatra', 'order-vatra')], '2026-08-31');
    assert.deepEqual(created.map((row) => row.invoiceNumber), ['TGB-10', 'VATRA-1']);
    assert.equal(created[0].issuerSettings.vatRegistered, true);
    assert.equal(created[1].issuerSettings.vatRegistered, false);
    const originalSnapshot = (connection.prepare('SELECT issuer_snapshot_json FROM invoice_identities WHERE invoice_id = ?').get(created[0].invoiceId) as any).issuer_snapshot_json;
    assert.deepEqual(connection.prepare('SELECT id, next_invoice_number FROM billing_issuers WHERE id IN (?, ?) ORDER BY id').all(goodnessId, vatraId).map((row: any) => row.next_invoice_number), [11, 2]);
    const snapshots = connection.prepare('SELECT COUNT(*) AS value FROM invoice_identities').get() as any;
    assert.equal(snapshots.value, 2);
    const goodness = getBillingIssuers(connection).find((issuer) => issuer.id === goodnessId)!;
    assert.throws(() => updateBillingIssuer(connection, issuerInput(goodness, { nextInvoiceNumber: 20 })), /Motivul/);
    assert.throws(() => updateBillingIssuer(connection, issuerInput(goodness, { invoiceSeries: 'NEW', nextInvoiceNumber: 11 })), /nu poate fi modificată/);
    updateBillingIssuer(connection, issuerInput(goodness, { nextInvoiceNumber: 20, counterChangeReason: 'Continuare după registrul extern verificat' }));
    assert.equal((connection.prepare('SELECT next_invoice_number FROM billing_issuers WHERE id = ?').get(goodnessId) as any).next_invoice_number, 20);
    assert.equal((connection.prepare('SELECT issuer_snapshot_json FROM invoice_identities WHERE invoice_id = ?').get(created[0].invoiceId) as any).issuer_snapshot_json, originalSnapshot);
  } finally { connection.close(); }
});

test('separates payments by issuer and reissues a cancelled weekly invoice with a new number', () => {
  const { connection, company1, company2, store1, store2, goodnessId, vatraId } = fixture();
  try {
    const [goodnessInvoice, vatraInvoice] = createWeeklyInvoiceBatchTransaction(connection, [weekly(store1, 'store-goodness', 'order-goodness'), weekly(store2, 'store-vatra', 'order-vatra')], '2026-08-31');
    recordCompanyPaymentTransaction(connection, { companyId: company1, issuerId: goodnessId, invoiceId: goodnessInvoice.invoiceId, amount: 15, paymentDate: '2026-09-01', method: 'transfer' });
    assert.equal((connection.prepare('SELECT balance FROM company_issuer_credits WHERE company_id = ? AND issuer_id = ?').get(company1, goodnessId) as any).balance, 5);
    assert.equal((connection.prepare('SELECT balance FROM company_issuer_credits WHERE company_id = ? AND issuer_id = ?').get(company2, vatraId) as any).balance, 0);
    assert.equal((connection.prepare('SELECT paid_amount FROM invoices WHERE id = ?').get(vatraInvoice.invoiceId) as any).paid_amount, 0);

    cancelInvoiceTransaction(connection, vatraInvoice.invoiceId, 'Emitent atribuit greșit');
    const replacement = reissueCancelledWeeklyInvoiceTransaction(connection, vatraInvoice.invoiceId, '2026-09-01');
    assert.equal(replacement.invoiceNumber, 'VATRA-2');
    assert.equal((connection.prepare('SELECT status FROM invoices WHERE id = ?').get(vatraInvoice.invoiceId) as any).status, 'cancelled');
    assert.equal((connection.prepare('SELECT replacement_invoice_id FROM invoice_replacements WHERE cancelled_invoice_id = ?').get(vatraInvoice.invoiceId) as any).replacement_invoice_id, replacement.invoiceId);
    assert.throws(() => cancelInvoiceTransaction(connection, goodnessInvoice.invoiceId, 'Nu mai este necesară'), /plăți/);
  } finally { connection.close(); }
});

test('rolls back the entire mixed batch when one issuer is incomplete', () => {
  const { connection, store1, store2, vatraId } = fixture();
  try {
    connection.prepare('UPDATE billing_issuers SET is_active = 0 WHERE id = ?').run(vatraId);
    assert.throws(() => createWeeklyInvoiceBatchTransaction(connection, [weekly(store1, 'store-goodness', 'order-goodness'), weekly(store2, 'store-vatra', 'order-vatra')], '2026-08-31'), /configurat complet/);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoices').get() as any).value, 0);
    assert.equal((connection.prepare("SELECT next_invoice_number FROM billing_issuers WHERE code = 'goodness'").get() as any).next_invoice_number, 10);
  } finally { connection.close(); }
});
