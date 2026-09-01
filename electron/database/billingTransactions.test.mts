import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initialSchema } from './schema.ts';
import {
  createInvoiceBatchTransaction,
  createWeeklyInvoiceBatchTransaction,
  recordCompanyPaymentTransaction,
  updateInvoiceTransaction,
} from './repositories/billingTransactions.ts';

function createBillingFixture() {
  const connection = new Database(':memory:');
  connection.pragma('foreign_keys = ON');
  connection.exec(initialSchema);
  const clientId = Number(connection.prepare("INSERT INTO clients (name) VALUES ('Client')").run().lastInsertRowid);
  const companyId = Number(connection.prepare(
    "INSERT INTO companies (client_id, name) VALUES (?, 'Companie')",
  ).run(clientId).lastInsertRowid);
  const storeId = Number(connection.prepare(
    "INSERT INTO stores (company_id, name) VALUES (?, 'Magazin')",
  ).run(companyId).lastInsertRowid);
  return { connection, clientId, companyId, storeId };
}

test('creates an invoice batch and advances its counter in one transaction', () => {
  const { connection, storeId } = createBillingFixture();
  try {
    connection.prepare("INSERT INTO app_settings (key, value) VALUES ('invoice_start_number', '10')").run();
    const created = createInvoiceBatchTransaction(connection, [
      { storeId, items: [{ productName: 'Produs A', quantity: 2, unitPrice: 3 }] },
      { storeId, items: [{ productName: 'Produs B', quantity: 1, unitPrice: 4.5 }] },
    ], '2026-08-11');

    assert.deepEqual(created.map((invoice) => invoice.invoiceNumber), ['10', '11']);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoices').get() as any).value, 2);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoice_items').get() as any).value, 2);
    assert.equal((connection.prepare("SELECT value FROM app_settings WHERE key = 'invoice_start_number'").get() as any).value, '12');
  } finally {
    connection.close();
  }
});

test('weekly VR Baker invoices are unique per store/week and source order', () => {
  const { connection, storeId } = createBillingFixture();
  try {
    const input = {
      storeId,
      storeExternalId: '11111111-1111-4111-8111-111111111111',
      periodStart: '2026-08-10',
      periodEnd: '2026-08-16',
      sourceFingerprint: 'a'.repeat(64),
      sourceOrders: [{ id: '22222222-2222-4222-8222-222222222222', updatedAt: '2026-08-11T12:00:00Z' }],
      items: [{
        productName: 'Cheese Pie',
        name_ro: 'Plăcintă cu brânză',
        variant_label: 'Large',
        unit: 'buc',
        quantity: 2,
        unitPrice: 3,
      }],
    };
    const [created] = createWeeklyInvoiceBatchTransaction(connection, [input], '2026-08-11');
    assert.equal(created.totalAmount, 6);
    assert.deepEqual(connection.prepare(`
      SELECT product_name, product_name_ro, variant_label, unit
      FROM invoice_items WHERE invoice_id = ?
    `).get(created.invoiceId), {
      product_name: 'Cheese Pie',
      product_name_ro: 'Plăcintă cu brânză',
      variant_label: 'Large',
      unit: 'buc',
    });
    assert.throws(() => createWeeklyInvoiceBatchTransaction(connection, [input], '2026-08-12'), /deja o factură/);
    assert.throws(() => updateInvoiceTransaction(connection, created.invoiceId, created.invoiceNumber, '2026-08-12', input.items), /nu poate fi modificată automat/);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoice_import_batches').get() as any).value, 1);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoice_source_orders').get() as any).value, 1);
  } finally {
    connection.close();
  }
});

test('weekly invoice lot rolls back invoices and source links on conflict', () => {
  const { connection, storeId } = createBillingFixture();
  try {
    connection.prepare("INSERT INTO app_settings (key, value) VALUES ('invoice_start_number', '30')").run();
    const base = {
      storeId,
      periodStart: '2026-08-10', periodEnd: '2026-08-16', sourceFingerprint: 'b'.repeat(64),
      items: [{ productName: 'Produs', quantity: 1, unitPrice: 5 }],
    };
    assert.throws(() => createWeeklyInvoiceBatchTransaction(connection, [
      { ...base, storeExternalId: '11111111-1111-4111-8111-111111111111', sourceOrders: [{ id: '33333333-3333-4333-8333-333333333333', updatedAt: '2026-08-11T12:00:00Z' }] },
      { ...base, storeExternalId: '44444444-4444-4444-8444-444444444444', sourceOrders: [{ id: '33333333-3333-4333-8333-333333333333', updatedAt: '2026-08-11T12:00:00Z' }] },
    ], '2026-08-11'), /deja facturată/);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoices').get() as any).value, 0);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoice_source_orders').get() as any).value, 0);
    assert.equal((connection.prepare("SELECT value FROM app_settings WHERE key = 'invoice_start_number'").get() as any).value, '30');
  } finally { connection.close(); }
});

test('rolls back the complete invoice batch and counter when any invoice fails', () => {
  const { connection, storeId } = createBillingFixture();
  try {
    connection.prepare("INSERT INTO app_settings (key, value) VALUES ('invoice_start_number', '20')").run();
    assert.throws(() => createInvoiceBatchTransaction(connection, [
      { storeId, items: [{ productName: 'Valid', quantity: 1, unitPrice: 2 }] },
      { storeId: 999999, items: [{ productName: 'Invalid', quantity: 1, unitPrice: 2 }] },
    ], '2026-08-11'), /Magazinul/);

    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoices').get() as any).value, 0);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoice_items').get() as any).value, 0);
    assert.equal((connection.prepare("SELECT value FROM app_settings WHERE key = 'invoice_start_number'").get() as any).value, '20');
  } finally {
    connection.close();
  }
});

test('allocates a payment to invoices and keeps surplus as company credit atomically', () => {
  const { connection, companyId, storeId } = createBillingFixture();
  try {
    const [invoice] = createInvoiceBatchTransaction(connection, [
      { storeId, items: [{ productName: 'Produs', quantity: 2, unitPrice: 5 }] },
    ], '2026-08-11');

    const result = recordCompanyPaymentTransaction(connection, {
      companyId,
      invoiceId: invoice.invoiceId,
      amount: 15,
      paymentDate: '2026-08-12',
      method: 'transfer',
      bankName: 'Barclays',
    });
    assert.deepEqual(result.allocations, [
      { invoiceId: invoice.invoiceId, amount: 10 },
      { invoiceId: null, amount: 5 },
    ]);
    const savedInvoice = connection.prepare(
      'SELECT paid_amount, status FROM invoices WHERE id = ?',
    ).get(invoice.invoiceId) as any;
    assert.deepEqual(savedInvoice, { paid_amount: 10, status: 'paid' });
    assert.equal((connection.prepare('SELECT credit_balance AS value FROM companies WHERE id = ?').get(companyId) as any).value, 5);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM payments').get() as any).value, 2);
  } finally {
    connection.close();
  }
});

test('rejects cross-company payment without changing balances or payment history', () => {
  const { connection, clientId, companyId, storeId } = createBillingFixture();
  try {
    const otherCompanyId = Number(connection.prepare(
      "INSERT INTO companies (client_id, name) VALUES (?, 'Altă companie')",
    ).run(clientId).lastInsertRowid);
    const [invoice] = createInvoiceBatchTransaction(connection, [
      { storeId, items: [{ productName: 'Produs', quantity: 1, unitPrice: 10 }] },
    ], '2026-08-11');

    assert.throws(() => recordCompanyPaymentTransaction(connection, {
      companyId: otherCompanyId,
      invoiceId: invoice.invoiceId,
      amount: 10,
      paymentDate: '2026-08-12',
      method: 'cash',
    }), /nu aparține/);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM payments').get() as any).value, 0);
    assert.equal((connection.prepare('SELECT paid_amount AS value FROM invoices WHERE id = ?').get(invoice.invoiceId) as any).value, 0);
    assert.equal((connection.prepare('SELECT credit_balance AS value FROM companies WHERE id = ?').get(companyId) as any).value, 0);
  } finally {
    connection.close();
  }
});

test('invoice editing preserves payment state', () => {
  const { connection, companyId, storeId } = createBillingFixture();
  try {
    const [invoice] = createInvoiceBatchTransaction(connection, [
      { storeId, items: [{ productName: 'Inițial', quantity: 1, unitPrice: 10 }] },
    ], '2026-08-11');
    recordCompanyPaymentTransaction(connection, {
      companyId,
      invoiceId: invoice.invoiceId,
      amount: 6,
      paymentDate: '2026-08-12',
      method: 'cash',
    });

    assert.throws(() => updateInvoiceTransaction(
      connection,
      invoice.invoiceId,
      invoice.invoiceNumber,
      '2026-08-11',
      [{ productName: 'Prea mic', quantity: 1, unitPrice: 5 }],
    ), /mai mic decât suma deja achitată/);
    assert.equal((connection.prepare('SELECT total_amount AS value FROM invoices WHERE id = ?').get(invoice.invoiceId) as any).value, 10);
    assert.equal((connection.prepare('SELECT product_name AS value FROM invoice_items WHERE invoice_id = ?').get(invoice.invoiceId) as any).value, 'Inițial');

    const updated = updateInvoiceTransaction(
      connection,
      invoice.invoiceId,
      invoice.invoiceNumber,
      '2026-08-13',
      [{ productName: 'Actualizat', quantity: 2, unitPrice: 6 }],
    );
    assert.deepEqual(updated, {
      invoiceId: invoice.invoiceId,
      totalAmount: 12,
      paidAmount: 6,
      status: 'partial',
    });
  } finally {
    connection.close();
  }
});
