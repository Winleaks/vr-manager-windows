import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createEmptyProtectedVault } from '../protectedRegistry/types.ts';
import { protectedRegistryOverview } from '../protectedRegistry/overview.ts';

function fixture() {
  const vault = createEmptyProtectedVault();
  vault.assignments = [{ companyKey: 'synthetic' } as any];
  vault.invoices = ['2026-08-31', '2026-09-01', '2026-09-07', '2026-09-13', '2026-09-14', '2026-09-30', '2026-10-01'].map((invoiceDate, index) => ({
    id: String(index), invoiceDate, issuerCode: index % 2 ? 'vatra' : 'goodness',
    totalAmount: 10.10, paidAmount: 1, creditedAmount: 0, status: 'partial',
  })) as any;
  vault.invoices.push({ id: 'cancelled', invoiceDate: '2026-09-07', issuerCode: 'goodness', totalAmount: 999, paidAmount: 0, creditedAmount: 0, status: 'cancelled' } as any);
  vault.creditNotes = [
    { issueDate: '2026-09-07', issuerCode: 'goodness', totalAmount: 2, status: 'issued' },
    { issueDate: '2026-08-31', issuerCode: 'vatra', totalAmount: 3, status: 'issued' },
    { issueDate: '2026-09-10', issuerCode: 'goodness', totalAmount: 999, status: 'cancelled' },
  ] as any;
  vault.payments = [
    { paymentDate: '2026-09-13', issuerCode: 'vatra', amount: 4, reversedAt: null },
    { paymentDate: '2026-10-01', issuerCode: 'goodness', amount: 5, reversedAt: null },
    { paymentDate: '2026-09-13', issuerCode: 'vatra', amount: 999, reversedAt: '2026-09-14' },
  ] as any;
  vault.creditEntries = [{ issuerCode: 'goodness', availableAmount: 8 }] as any;
  vault.creditApplications = [
    { invoiceId: '0', amount: 2, reversedAt: null },
    { invoiceId: '1', amount: 999, reversedAt: '2026-09-02' },
  ] as any;
  return vault;
}

test('protected dashboard filters inclusive issue dates, issuer totals, note/payment dates; balances stay current', () => {
  const vault = fixture(), before = structuredClone(vault);
  const all = protectedRegistryOverview(vault);
  const month = protectedRegistryOverview(vault, '2026-09-01', '2026-09-30');
  const week = protectedRegistryOverview(vault, '2026-09-07', '2026-09-13');
  assert.equal(all.invoices, 7); assert.equal(all.invoiced, 70.7);
  assert.equal(month.invoices, 5); assert.equal(month.invoiced, 50.5);
  assert.equal(week.invoices, 2); assert.equal(week.invoiced, 20.2);
  assert.equal(week.byIssuer.goodness.invoiced, 10.1); assert.equal(week.byIssuer.vatra.invoiced, 10.1);
  assert.equal(week.credited, 2); assert.equal(week.paid, 4);
  assert.equal(all.credited, 5); assert.equal(all.paid, 9);
  for (const result of [all, month, week]) {
    assert.equal(result.outstanding, 61.7); assert.equal(result.availableCredit, 8);
    assert.equal(result.assignedCompanies, 1); assert.deepEqual(result.counters, vault.counters);
  }
  const empty = protectedRegistryOverview(vault, '2025-01-01', '2025-01-31');
  assert.equal(empty.invoices, 0); assert.equal(empty.invoiced, 0); assert.equal(empty.paid, 0); assert.equal(empty.credited, 0);
  assert.equal(empty.outstanding, all.outstanding);
  assert.deepEqual(vault, before, 'filtering must not mutate the vault');
});

test('protected dashboard rejects partial/reversed/non-calendar date ranges', () => {
  const vault = fixture();
  for (const [from, to] of [['2026-09-01', undefined], [undefined, '2026-09-30'], ['2026-09-30', '2026-09-01'], ['2026-02-30', '2026-03-01'], [null, null], [{}, '2026-09-01'], ['2026-09-01T00:00:00Z', '2026-09-30']]) {
    assert.throws(() => protectedRegistryOverview(vault, from, to));
  }
  assert.equal(protectedRegistryOverview(vault, '2024-02-29', '2024-02-29').invoiced, 0);
});

test('overview service requires an unlocked session and passes filters to read-only aggregation', async () => {
  const source = ts.createSourceFile('service.ts', readFileSync(new URL('../protectedRegistry/service.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'getProtectedRegistryOverview')!;
  const code = ts.transpileModule(fn.getText(source).replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  let locked = true;
  const read = new Function('freshSession', 'protectedRegistryOverview', code + '; return getProtectedRegistryOverview;')(
    async (id: number) => { assert.equal(id, 7); if (locked) throw Error('locked'); return { vault: fixture() }; }, protectedRegistryOverview);
  await assert.rejects(read(7, '2026-09-07', '2026-09-13'), /locked/);
  locked = false;
  assert.equal((await read(7, '2026-09-07', '2026-09-13')).invoiced, 20.2);
  assert.equal((await read(7)).invoiced, 70.7);
});
