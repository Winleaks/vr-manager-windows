import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyProtectedVault, type ProtectedInvoice, type ProtectedPayment, type ProtectedCreditNote, type ProtectedCreditApplication } from '../protectedRegistry/types.ts';
import { protectedStatementReport, validateProtectedStatement } from '../protectedRegistry/statement.ts';
import type { ProtectedStatementInput } from '../../src/shared/protectedStatement.ts';

const input: ProtectedStatementInput = { companyKey: 'a', issuerCode: 'goodness', storeInvoiceId: null, from: '2026-10-01', to: '2026-10-31', action: 'open' };
const invoice = (id: string, storeId: number, extra = {}) => ({ id, storeId, storeExternalId: `store-${storeId}`, companyKey: 'a', companyName: 'Synthetic Company', issuerCode: 'goodness', invoiceDate: '2026-10-01', reference: id, totalAmount: 100, paidAmount: 0, creditedAmount: 0, status: 'unpaid', testDocument: false, storeName: 'Same name', ...extra } as ProtectedInvoice);
const payment = (id: string, invoiceId: string | null, amount: number, extra = {}) => ({ id, invoiceId, amount, companyKey: 'a', issuerCode: 'goodness', paymentDate: '2026-10-02', method: 'cash', testEntry: false, reversedAt: null, ...extra } as ProtectedPayment);
const note = (id: string, items: Array<{sourceInvoiceId: string; totalPrice: number}>, extra = {}) => ({ id, reference: id, companyKey: 'a', issuerCode: 'goodness', issueDate: '2026-10-03', testDocument: false, status: 'issued', items, totalAmount: items.reduce((sum, item) => sum + item.totalPrice, 0), ...extra } as ProtectedCreditNote);
const application = (id: string, invoiceId: string, amount: number, extra = {}) => ({ id, invoiceId, amount, companyKey: 'a', issuerCode: 'goodness', testEntry: false, reversedAt: null, createdAt: '2026-10-04T12:00:00Z', ...extra } as ProtectedCreditApplication);
function fixture() {
  const vault = createEmptyProtectedVault(); vault.mode = 'live';
  vault.invoices = [invoice('A', 1), invoice('B', 2)];
  vault.payments = [payment('pA', 'A', 30), payment('pB', 'B', 50), payment('advance', null, 40)];
  vault.creditNotes = [note('CN', [{ sourceInvoiceId: 'A', totalPrice: 10 }, { sourceInvoiceId: 'B', totalPrice: 20 }])];
  vault.creditApplications = [application('appA', 'A', 15), application('appB', 'B', 25)];
  return vault;
}

test('company statement matches normal ledger semantics and never counts credit twice', () => {
  const vault = fixture(), before = JSON.stringify(vault);
  const report = protectedStatementReport(vault, input);
  assert.equal(report.opening, 0); assert.equal(report.closing, 50);
  assert.equal(report.rows.filter(row => row.kind === 'Credit Note')[0].credit, 30);
  assert.equal(report.rows.filter(row => row.kind === 'Payment').length, 3);
  assert.ok(!report.rows.some(row => row.kind === 'Credit applied'));
  assert.equal(JSON.stringify(vault), before);
});

test('two stores with equal names remain isolated; multi-store CN is split by source item', () => {
  const vault = fixture();
  for (const [id, closing, cn] of [['A', 45, 10], ['B', 5, 20]] as const) {
    const report = protectedStatementReport(vault, { ...input, storeInvoiceId: id });
    assert.equal(report.closing, closing);
    assert.equal(report.rows.find(row => row.kind === 'Credit Note')?.credit, cn);
    assert.equal(report.rows.filter(row => row.kind === 'Payment').length, 1);
    assert.ok(!report.rows.some(row => row.reference.includes('Advance')));
  }
});

test('opening balance uses earlier movements; inclusive end excludes future movements', () => {
  const report = protectedStatementReport(fixture(), { ...input, storeInvoiceId: 'A', from: '2026-10-03', to: '2026-10-03' });
  assert.equal(report.opening, 70); assert.equal(report.closing, 60); assert.equal(report.rows.length, 1);
  const empty = protectedStatementReport(fixture(), { ...input, from: '2026-11-01', to: '2026-11-30' });
  assert.equal(empty.opening, 50); assert.equal(empty.closing, 50); assert.equal(empty.rows.length, 0);
});

test('cancelled and reversed records, other issuers/companies and TEST records do not leak', () => {
  const vault = fixture();
  vault.invoices.push(invoice('cancelled', 1, { status: 'cancelled' }), invoice('foreign', 1, { companyKey: 'other' }), invoice('vatra', 1, { issuerCode: 'vatra' }), invoice('test', 1, { testDocument: true }));
  vault.payments.push(payment('reversed', 'A', 99, { reversedAt: 'now' }), payment('foreign', 'A', 99, { companyKey: 'other' }), payment('test', 'A', 99, { testEntry: true }));
  vault.creditNotes.push(note('cancelled', [{ sourceInvoiceId: 'A', totalPrice: 99 }], { status: 'cancelled' }));
  vault.creditApplications.push(application('reversed', 'A', 99, { reversedAt: 'now' }), application('foreign', 'A', 99, { issuerCode: 'vatra' }));
  assert.equal(protectedStatementReport(vault, input).closing, 50);
  assert.equal(protectedStatementReport(vault, { ...input, storeInvoiceId: 'A' }).closing, 45);
  for (const id of ['foreign', 'vatra', 'test', 'missing']) assert.throws(() => protectedStatementReport(vault, { ...input, storeInvoiceId: id }), /nu aparține/);
});

test('CN on paid invoice transfers excess to company account before reuse, including same-store reuse', () => {
  for (const targetStore of [1, 2]) {
    const vault = fixture(); vault.invoices = [invoice('A', 1), invoice('B', targetStore, { totalAmount: 50 })];
    vault.payments = [payment('paid', 'A', 100)];
    vault.creditNotes = [note('CN', [{ sourceInvoiceId: 'A', totalPrice: 20 }])];
    vault.creditApplications = [application('use', 'B', 20)];
    assert.equal(protectedStatementReport(vault, input).closing, 30);
    const a = protectedStatementReport(vault, { ...input, storeInvoiceId: 'A' });
    assert.equal(a.closing, targetStore === 1 ? 30 : 0);
    assert.equal(a.rows.find(row => row.kind === 'Excess to company account')?.debit, 20);
    assert.equal(protectedStatementReport(vault, { ...input, storeInvoiceId: 'B' }).closing, 30);
  }
});

test('unallocated company advances do not reduce a store balance; partial and reversed applications', () => {
  const vault = fixture(); vault.payments = [payment('advance', null, 150)]; vault.creditNotes = [];
  vault.creditApplications = [application('active', 'A', 20), application('reversed', 'A', 80, { reversedAt: 'now' })];
  assert.equal(protectedStatementReport(vault, input).closing, 50);
  assert.equal(protectedStatementReport(vault, { ...input, storeInvoiceId: 'A' }).closing, 80);
});

test('cent arithmetic, identity fallback and zero-activity assigned clients', () => {
  const vault = fixture(); vault.invoices = [invoice('A', 1, { totalAmount: 0.3, storeExternalId: null })];
  vault.payments = [payment('one', 'A', 0.1), payment('two', 'A', 0.2)]; vault.creditNotes = []; vault.creditApplications = [];
  assert.equal(protectedStatementReport(vault, { ...input, storeInvoiceId: 'A' }).closing, 0);
  vault.invoices = []; vault.payments = []; vault.assignments.push({ companyKey: 'a', companyName: 'Empty', localCompanyId: 1, assignedAt: '' });
  assert.equal(protectedStatementReport(vault, input).closing, 0);
  assert.throws(() => protectedStatementReport(vault, { ...input, companyKey: 'missing' }), /nu există/);
});

test('invalid report requests are rejected before financial reads', () => {
  for (const change of [{ from: '2026-02-30' }, { to: '2025-01-01' }, { issuerCode: 'all' }, { action: 'delete' }, { companyKey: '' }, { storeInvoiceId: undefined }]) {
    assert.throws(() => validateProtectedStatement({ ...input, ...change } as any));
  }
  assert.throws(() => validateProtectedStatement(null as any));
});
