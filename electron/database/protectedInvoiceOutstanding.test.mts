import assert from 'node:assert/strict';
import test from 'node:test';
import { protectedInvoiceOutstanding } from '../protectedRegistry/invoiceOutstanding.ts';
import type { ProtectedInvoice, ProtectedRegistryVault } from '../protectedRegistry/types.ts';

const invoice = (id: string, changes: Partial<ProtectedInvoice> = {}) => ({ id, reference: `VRL-${id}`, invoiceDate: '2026-09-13', companyKey: 'client-a',
  issuerCode: 'vatra', storeExternalId: 'store-a', storeId: 1, testDocument: false, status: 'unpaid',
  totalAmount: 100, paidAmount: 0, creditedAmount: 0, ...changes } as ProtectedInvoice);
const vault = (invoices: ProtectedInvoice[], creditApplications: unknown[] = []) => ({ invoices, creditApplications } as ProtectedRegistryVault);

test('private PDF balance isolates store, company, issuer, test mode and cancelled invoices', () => {
  const current = invoice('2');
  const source = vault([invoice('1'), current,
    invoice('other-store', { storeExternalId: 'store-b', storeId: 2 }),
    invoice('other-company', { companyKey: 'client-b' }),
    invoice('other-issuer', { issuerCode: 'goodness' }),
    invoice('test', { testDocument: true }),
    invoice('cancelled', { status: 'cancelled' }),
    invoice('paid', { paidAmount: 100, status: 'paid' }),
  ]);
  const before = structuredClone(source);
  assert.deepEqual(protectedInvoiceOutstanding(source, current).rows.map(r => r.invoice_number), ['VRL-1', 'VRL-2']);
  assert.equal(protectedInvoiceOutstanding(source, current).total, 200);
  assert.deepEqual(source, before);
});

test('private PDF balance subtracts cash, notes and active applied credit once, rounded in pennies', () => {
  const current = invoice('1', { totalAmount: 100.3, paidAmount: 20.1, creditedAmount: 10.1 });
  const source = vault([current, invoice('2', { totalAmount: .2 }), invoice('paid', { paidAmount: 150 })], [
    { invoiceId: '1', amount: 10, reversedAt: null },
    { invoiceId: '1', amount: 5, reversedAt: '2026-09-13' },
    { invoiceId: 'other-store', amount: 20, reversedAt: null },
  ]);
  const result = protectedInvoiceOutstanding(source, current);
  assert.equal(result.rows[0].outstanding, 60.1);
  assert.equal(result.rows[0].appliedCredit, 10);
  assert.equal(result.total, 60.3);
  assert.equal(result.rows.length, 2);
});

test('store matching uses stable identifiers, never names or two missing IDs', () => {
  const current = invoice('1', { storeExternalId: null });
  assert.equal(protectedInvoiceOutstanding(vault([current, invoice('2')]), current).total, 200);
  const missing = invoice('3', { storeExternalId: null, storeId: null });
  assert.equal(protectedInvoiceOutstanding(vault([missing, invoice('4', { storeExternalId: null, storeId: null })]), missing).total, 100);
  const paid = invoice('paid', { paidAmount: 100 });
  assert.deepEqual(protectedInvoiceOutstanding(vault([paid]), paid), { total: 0, rows: [] });
});
