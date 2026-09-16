import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyAutomaticProtectedCredit } from '../protectedRegistry/automaticCredit.ts';
import { createEmptyProtectedVault, type ProtectedInvoice } from '../protectedRegistry/types.ts';

function fixture(total = 100, credit = 30) {
  const vault = createEmptyProtectedVault();
  const invoice = { id: 'new', operationId: 'issue-1', companyKey: 'client-1', issuerCode: 'goodness', totalAmount: total, paidAmount: 0, creditedAmount: 0, status: 'unpaid', testDocument: false } as ProtectedInvoice;
  vault.invoices.push(invoice);
  vault.creditEntries.push({ id: 'credit-1', companyKey: 'client-1', issuerCode: 'goodness', sourceType: 'payment_overpayment', sourceId: 'payment-1', originalAmount: credit, availableAmount: credit, createdAt: '2026-09-01', testEntry: false });
  return { vault, invoice };
}

test('protected automatic credit preserves gross/cash, applies FIFO and cannot repeat after reversal', () => {
  const { vault, invoice } = fixture();
  const app = applyAutomaticProtectedCredit(vault, invoice)!;
  assert.equal(app.amount, 30);
  assert.equal(invoice.totalAmount, 100);
  assert.equal(invoice.paidAmount, 0);
  assert.equal(invoice.status, 'partial');
  assert.equal(vault.creditEntries[0].availableAmount, 0);
  assert.equal(vault.audit.length, 1);
  const saved = structuredClone(vault);
  assert.equal(applyAutomaticProtectedCredit(vault, invoice), null);
  assert.deepEqual(vault, saved);
  app.reversedAt = '2026-09-16';
  vault.creditEntries[0].availableAmount = 30;
  assert.equal(applyAutomaticProtectedCredit(vault, invoice), null);
  assert.equal(vault.creditEntries[0].availableAmount, 30);
});

test('protected credit leaves surplus for next invoice and uses exact pennies across entries', () => {
  const { vault, invoice } = fixture(0.3, 0.1);
  vault.creditEntries.push({ ...vault.creditEntries[0], id: 'credit-2', availableAmount: 0.4, originalAmount: 0.4, createdAt: '2026-09-02' });
  const app = applyAutomaticProtectedCredit(vault, invoice)!;
  assert.deepEqual(app.allocations, [{ creditEntryId: 'credit-1', amount: 0.1 }, { creditEntryId: 'credit-2', amount: 0.2 }]);
  assert.equal(invoice.status, 'paid');
  assert.equal(vault.creditEntries[1].availableAmount, 0.2);
  const next = { ...invoice, id: 'new-2', operationId: 'issue-2', status: 'unpaid' as const };
  vault.invoices.push(next);
  assert.equal(applyAutomaticProtectedCredit(vault, next)!.amount, 0.2);
  assert.equal(next.status, 'partial');
});

test('protected credit never crosses company, issuer or test/live scope and candidate rollback is safe', () => {
  for (const changes of [{ companyKey: 'other' }, { issuerCode: 'vatra' as const }, { testEntry: true }]) {
    const { vault, invoice } = fixture();
    Object.assign(vault.creditEntries[0], changes);
    const saved = structuredClone(vault);
    assert.equal(applyAutomaticProtectedCredit(vault, invoice), null);
    assert.deepEqual(vault, saved);
  }
  const { vault } = fixture();
  const saved = structuredClone(vault);
  assert.throws(() => {
    const candidate = structuredClone(vault);
    applyAutomaticProtectedCredit(candidate, candidate.invoices[0]);
    throw new Error('cloud write failed');
  });
  assert.deepEqual(vault, saved);
});

test('all protected creation paths apply credit inside mutation; editing does not', () => {
  const source = readFileSync(new URL('../protectedRegistry/service.ts', import.meta.url), 'utf8');
  assert.equal((source.match(/applyAutomaticProtectedCredit\(next, /g) || []).length, 4);
  assert.match(source, /next\.invoices\.push\(invoice\);\s+applyAutomaticProtectedCredit\(next, invoice\)/);
  assert.match(source, /next\.invoices\.push\(replacement\);\s+applyAutomaticProtectedCredit\(next, replacement\)/);
  assert.match(source, /activeCreditApplied\(next, invoice.id\) > 0.005/);
});
