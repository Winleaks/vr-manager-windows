import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { generateCreditNotePdf } from '../reports/creditNotePdf.ts';
import { generateDailyCashPdf } from '../reports/dailyCashPdf.ts';
import { generateStatementPdf } from '../reports/statementPdf.ts';
import { generateTablePdf } from '../../src/utils/tablePdf.ts';
import { DAILY_CASH_CATEGORY_LABELS } from './dailyCashReport.ts';
import { readFileSync } from 'node:fs';

// Exercise the actual rendered glyphs, not just the template source.
const popplerAvailable = spawnSync('pdftotext', ['-v']).status === 0;
const extractionOptions = { skip: popplerAvailable ? false : 'Install Poppler to verify PDF text' };
function pdfText(pdf: Uint8Array) {
  const result = spawnSync('pdftotext', ['-layout', '-', '-'], { input: pdf, encoding: 'utf8', maxBuffer: 5_000_000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('Credit Notes render English labels for issued/cancelled VAT/non-VAT documents and retain supplied data', extractionOptions, () => {
  for (const vatRegistered of [true, false]) {
    const note = {
      reference: 'CN-TGB-21', issue_date: '2026-09-13', created_at: '2026-09-13T10:00:00Z',
      status: vatRegistered ? 'issued' : 'cancelled', reason: 'Produse deteriorate', backdate_reason: 'Corecție agreată',
      net_amount: 140, vat_amount: 0, total_amount: 140,
      issuerSnapshot: { issuerName: 'FIXTURE BAKERY LTD', issuerAddress: 'London', issuerCrn: '123', issuerVat: 'GB123', vatRegistered },
      customerSnapshot: { companyName: 'CLIENT ROMÂNESC LTD', companyAddress: 'London' },
      invoices: [{ id: 1, invoice_number: 'TGB-138', invoice_date: '2026-09-12' }],
      items: Array.from({ length: 70 }, () => ({ source_invoice_id: 1, store_name: 'Magazin Central', product_name: 'Bread', product_name_ro: 'Pâine', quantity: 1, unit: 'pcs', unit_amount: 2, vat_rate: 0, vat_amount: 0, total_amount: 2 })),
    };
    const before = structuredClone(note);
    const pdf = generateCreditNotePdf(note);
    const text = pdfText(pdf);
    for (const phrase of ['Issue date:', 'Created in system:', 'ISSUER', 'CUSTOMER', 'Original invoices:', 'Reason:', 'Backdating reason:', 'Invoice', 'Store', 'Product', 'Qty', 'Unit credit', 'Credited subtotal:', 'TOTAL CREDITED: £140.00', 'This document adjusts the original invoices', 'TGB-138', 'Produse deteriorate', 'Corecție agreată', 'Pâine']) assert.ok(text.includes(phrase), phrase);
    assert.match(text, vatRegistered ? /VAT credited \(0%\): £0.00/ : /Issuer not VAT registered/);
    if (!vatRegistered) assert.match(text, /CANCELLED INTERNALLY - NUMBER RETAINED IN REGISTER/);
    assert.doesNotMatch(text, /Data emiterii|Facturi originale|Subtotal creditat|TOTAL CREDITAT|Motiv antedatare/);
    assert.ok((text.match(/Page \d+ of/g) || []).length >= 2);
    assert.deepEqual(note, before);
  }
});

test('Daily Cash translates every system category, statuses and empty state without changing ledger labels', extractionOptions, () => {
  for (const isClosed of [false, true]) {
    const categories = Object.entries(DAILY_CASH_CATEGORY_LABELS);
    const report = {
      dayId: 1, date: '2026-09-13', status: isClosed ? 'FINAL' as const : 'PROVIZORIU' as const,
      isClosed, canReopen: false, generatedAt: '2026-09-13T10:00:00Z', openingBalance: 100,
      totalIn: 8, totalOut: 0, netCashFlow: 8, balance: 108, transactionCount: 8,
      categoryTotals: categories.map(([category, label]) => ({ category, label, type: 'IN' as const, amount: 1 })),
      transactions: categories.map(([category, categoryLabel], id) => ({ id, time: '10:00', category, categoryLabel, type: 'IN' as const, reference: 'Șofer Test', notes: 'Notă originală', amount: 1 })),
    };
    const before = structuredClone(report);
    const text = pdfText(generateDailyCashPdf(report));
    for (const phrase of ['Daily Cash Report', 'Opening balance', 'Total cash in', 'Total cash out', 'Net cash flow', 'Transaction details', 'Reference / Details', 'Driver collection', 'Other collection', 'Direct sale', 'Stock purchase', 'Other expenses', 'Cash collection', 'Employee collection', 'Balance adjustment', '£108.00', 'Șofer Test', 'Notă originală', 'Page']) assert.ok(text.includes(phrase), phrase);
    assert.ok(text.includes(isClosed ? 'FINAL' : 'PROVISIONAL'));
    assert.ok(text.includes(isClosed ? 'Closing balance' : 'Current balance'));
    assert.doesNotMatch(text, /PROVIZORIU|Sold deschidere|Încasare șofer|Pagina|Tranzacții/);
    assert.match(pdfText(generateDailyCashPdf({ ...report, categoryTotals: [], transactions: [] })), /No transactions/);
    assert.deepEqual(report, before);
  }
});

test('table PDF exports use English headings and preserve accented names and notes', extractionOptions, () => {
  const text = pdfText(generateTablePdf(['Date', 'Finished Product', 'Quantity Produced', 'Unit', 'Notes'], [['13/09/2026', 'Pâine', '10', 'pcs', 'Notă originală']], 'Production Report', new Date('2026-09-13T10:00:00Z')));
  for (const phrase of ['Production Report', 'Generated on:', 'Finished Product', 'Quantity Produced', 'Pâine', 'Notă originală']) assert.ok(text.includes(phrase), phrase);
  const dashboard = readFileSync(new URL('../../src/pages/Dashboard.tsx', import.meta.url), 'utf8');
  assert.match(dashboard, /'Raw Materials Inventory Report'/);
  assert.match(dashboard, /'Production Report'/);
  assert.match(dashboard, /'Current Stock', 'Minimum Stock', 'Unit', 'Status'/);
});

test('statements retain English document headings and unchanged debit, credit and balance', extractionOptions, () => {
  const report = {
    company: { id: 1, name: 'Fixture Client', address: 'London' }, issuer: { id: 1, legal_name: 'Fixture Bakery' },
    from: '2026-09-01', to: '2026-09-13', opening: 10, closing: 20, legacyCredit: 0,
    rows: [{ date: '2026-09-13', kind: 'Invoice', reference: 'TGB-138', debit: 10, credit: 0, balance: 20, id: 1, store_name: 'Fixture Store' }],
  };
  const text = pdfText(generateStatementPdf(report));
  for (const phrase of ['STATEMENT OF ACCOUNT', 'Opening balance: £10.00', 'Closing balance', '£20.00', 'Not a tax invoice.', 'TGB-138']) assert.ok(text.includes(phrase), phrase);
});
