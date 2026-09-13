import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyProtectedVault } from '../protectedRegistry/types.ts';
import { protectedPaymentDisplay } from '../protectedRegistry/paymentDisplay.ts';

test('protected payment recipient includes invoice snapshot and store, without changing the vault', () => {
  const vault = createEmptyProtectedVault();
  vault.assignments.push({ companyKey: 'client-a', localCompanyId: 7, companyName: 'Current name', assignedAt: '' });
  vault.invoices.push({ id: 'invoice-a', companyKey: 'client-a', companyId: 7, companyName: 'Invoice customer', storeName: 'Shop A', issuerCode: 'goodness', reference: 'TGB-1' } as any);
  vault.payments.push({ id: 'payment', companyKey: 'client-a', issuerCode: 'goodness', invoiceId: 'invoice-a', amount: 3, paymentDate: '2026-09-13', createdAt: '' } as any);
  const original = structuredClone(vault);
  const [row] = protectedPaymentDisplay(vault);
  assert.equal(row.companyName, 'Invoice customer');
  assert.equal(row.companyId, 7);
  assert.equal(row.storeName, 'Shop A');
  assert.equal(row.invoiceReference, 'TGB-1');
  assert.deepEqual(vault, original);
});

test('advances, reversed and orphan payments stay visible without borrowing another customer or issuer invoice', () => {
  const vault = createEmptyProtectedVault();
  vault.assignments.push({ companyKey: 'a', localCompanyId: 1, companyName: 'Customer A', assignedAt: '' });
  vault.invoices.push({ id: 'b', companyKey: 'b', companyId: 2, companyName: 'Customer B', issuerCode: 'vatra', reference: 'VR-2' } as any);
  vault.payments.push(...[
    { id: 'advance', companyKey: 'a', invoiceId: null },
    { id: 'invalid', companyKey: 'a', invoiceId: 'b', reversedAt: '2026-09-13' },
    { id: 'orphan', companyKey: 'missing', invoiceId: 'gone' },
  ].map(row => ({ ...row, issuerCode: 'goodness', amount: 5, paymentDate: '2026-09-13', createdAt: '' } as any)));
  const rows = protectedPaymentDisplay(vault);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].companyName, 'Customer A');
  assert.equal(rows[0].storeName, null);
  assert.equal(rows[1].invoiceReference, null);
  assert.equal(rows[1].companyName, 'Customer A');
  assert.ok(rows[1].reversedAt);
  assert.equal(rows[2].companyName, 'Companie istorică neidentificată');
});
