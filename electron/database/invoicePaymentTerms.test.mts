import test from 'node:test';
import assert from 'node:assert/strict';
import { invoicePaymentTerms, firstFridayAfter } from '../../src/shared/invoicePaymentTerms.ts';
test('weekly terms use billed week even when issued late', () => {
  for (const issue of ['2026-10-04','2026-10-05','2026-10-10']) assert.equal(invoicePaymentTerms(issue,'2026-09-28','2026-10-04').due_date,'2026-10-08');
  assert.equal(invoicePaymentTerms('2027-01-04','2026-12-28','2027-01-03').due_date,'2027-01-07');
});
test('manual same-day terms and strictly subsequent Friday', () => {
  assert.equal(invoicePaymentTerms('2026-10-04').due_date,'2026-10-04');
  assert.equal(invoicePaymentTerms('2026-10-05').due_date,'2026-10-05');
  assert.equal(firstFridayAfter('2026-10-08'),'2026-10-09');
  assert.equal(firstFridayAfter('2026-10-09'),'2026-10-16');
  assert.equal(firstFridayAfter('2026-10-06'),'2026-10-09');
});
test('DST, leap day and incomplete data', () => {
  assert.equal(invoicePaymentTerms('2026-03-29').due_date,'2026-03-29');
  assert.equal(invoicePaymentTerms('2026-10-25').due_date,'2026-10-25');
  assert.equal(invoicePaymentTerms('2028-02-26').due_date,'2028-02-26');
  assert.equal(invoicePaymentTerms('2026-02-30').due_basis,'review');
  assert.equal(invoicePaymentTerms('2026-10-04',null,null,true).due_basis,'review');
  assert.equal(invoicePaymentTerms('2026-10-04','2026-09-28',null).due_basis,'review');
  assert.equal(invoicePaymentTerms('2026-10-04','2026-10-04','2026-09-28').due_basis,'review');
});
