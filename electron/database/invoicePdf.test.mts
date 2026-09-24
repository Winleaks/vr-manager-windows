import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateInvoicePDF,
  INVOICE_NON_VAT_COLUMN_WIDTHS,
  INVOICE_VAT_COLUMN_WIDTHS,
  invoiceProductDescription,
  outstandingInvoiceContext,
} from '../../src/utils/pdfGenerator.ts';
import { formatAddressWithPostcode, formatPdfDate, PDF_DEVELOPER_CREDIT } from '../../src/utils/pdfDocumentHelpers.ts';

const invoice = {
  invoiceNumber: 'SERIE-1', invoiceDate: '2026-09-01',
  client: { name: 'CLIENT TEST LTD', address: 'London' },
  store: { name: 'STORE TEST', address: 'London' },
  items: [{ productName: 'CHEESE PIE', name_ro: 'PLĂCINTĂ CU BRÂNZĂ', unit: 'pcs', quantity: 2, unitPrice: 3, totalPrice: 6 }],
  totalAmount: 6,
};

test('outstanding context labels the customer company and store on separate lines without an issuer', () => {
  assert.equal(outstandingInvoiceContext('CLIENT TEST LTD', 'STORE TEST'), 'Company: CLIENT TEST LTD\nStore: STORE TEST');
  assert.equal(outstandingInvoiceContext('CLIENT TEST LTD'), 'Company: CLIENT TEST LTD\nStore: ');
});

test('outstanding section shares free invoice space for both issuers including zero balance', () => {
  for (const vatRegistered of [true, false]) {
    for (const count of [0, 2]) {
      const rows = Array.from({ length: count }, (_, i) => ({ invoice_number: `INV-${i + 1}`, invoice_date: '2026-09-13', grossAmount: 6, cashPaid: 0, creditedAmount: 0, appliedCredit: 0, outstanding: 6 }));
      const pdf = generateInvoicePDF({ issuerName: 'SYNTHETIC BAKERY', invoiceColor: '#F5CC38', vatRegistered }, { ...invoice, accountOutstanding: { rows, total: count * 6 } });
      assert.equal((Buffer.from(pdf).toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1);
    }
  }
});

test('large outstanding lists paginate deterministically without changing source data', () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({ invoice_number: `INV-${i + 1}`, invoice_date: '2026-09-13', grossAmount: 6, cashPaid: 0, creditedAmount: 0, appliedCredit: 0, outstanding: 6 }));
  const data = { ...invoice, accountOutstanding: { rows, total: 480 } };
  const before = structuredClone(data);
  const metadata = { fileId: '12345678901234567890123456789012', creationDate: '2026-09-13' };
  const settings = { issuerName: 'SYNTHETIC BAKERY', invoiceColor: '#4F46E5' };
  const pdf = generateInvoicePDF(settings, data, metadata);
  assert.deepEqual(pdf, generateInvoicePDF(settings, data, metadata));
  assert.deepEqual(data, before);
  assert.ok((Buffer.from(pdf).toString('latin1').match(/\/Type \/Page\b/g) || []).length >= 4);
});

test('generates valid VAT and non-VAT invoice PDFs from issuer snapshots', () => {
  const base = {
    issuerName: 'THE GOODNESS BAKER LTD', issuerAddress: 'London', issuerCrn: '123', issuerVat: 'GB123',
    invoiceSeries: 'TGB', invoiceColor: '#4F46E5', invoiceAlternateRowColor: '#4F46E5', invoiceAlternateRowOpacity: 5,
  };
  const vat = generateInvoicePDF({ ...base, vatRegistered: true }, { ...invoice, invoiceNumber: 'TGB-1' });
  const nonVat = generateInvoicePDF({ ...base, issuerName: 'VATRA ROMANEASCA LTD', issuerVat: '', invoiceSeries: 'VATRA', vatRegistered: false }, { ...invoice, invoiceNumber: 'VATRA-1' });
  assert.equal(Buffer.from(vat.subarray(0, 5)).toString('ascii'), '%PDF-');
  assert.equal(Buffer.from(nonVat.subarray(0, 5)).toString('ascii'), '%PDF-');
  assert.ok(vat.byteLength > 10_000);
  assert.ok(nonVat.byteLength > 10_000);
  assert.notDeepEqual(vat, nonVat);
});

test('one-off VAT PDF requires saved net/VAT/gross consistency and differs from zero-VAT document', () => {
  const settings = { issuerName: 'THE GOODNESS BAKER LTD', issuerVat: 'GB123456789', invoiceSeries: 'TGB', vatRegistered: true };
  const taxable = { ...invoice, items: [{ productName: 'FACTORY MACHINE', quantity: 2, unitPrice: 11.03, totalPrice: 22.06 }],
    totalAmount: 22.06, vatRatePercent: 20, vatNetAmount: 18.38, vatAmount: 3.68 };
  const withVat = generateInvoicePDF(settings, taxable);
  assert.equal(Buffer.from(withVat.subarray(0, 5)).toString('ascii'), '%PDF-');
  assert.notDeepEqual(withVat, generateInvoicePDF(settings, { ...taxable, vatRatePercent: 0, vatNetAmount: 22.06, vatAmount: 0 }));
  assert.throws(() => generateInvoicePDF(settings, { ...taxable, vatAmount: 0 }), /Totalurile VAT/);
  assert.throws(() => generateInvoicePDF({ ...settings, vatRegistered: false }, taxable), /neînregistrat VAT/);
});

test('invoice product description contains only English and Romanian names', () => {
  const item = { productName: 'Cheese Pie', name_ro: 'Plăcintă cu brânză', variant_label: 'Large' };
  assert.equal(invoiceProductDescription(item), 'CHEESE PIE\nPLĂCINTĂ CU BRÂNZĂ');
});

test('uses compact columns that reserve the available table width for descriptions', () => {
  assert.equal(INVOICE_VAT_COLUMN_WIDTHS.reduce((total, width) => total + width, 0), 182);
  assert.equal(INVOICE_NON_VAT_COLUMN_WIDTHS.reduce((total, width) => total + width, 0), 182);
  assert.equal(INVOICE_VAT_COLUMN_WIDTHS[1], 95);
  assert.equal(INVOICE_NON_VAT_COLUMN_WIDTHS[1], 107);
});

test('formats PDF dates and distinct postcodes without duplication', () => {
  assert.equal(formatPdfDate('2026-09-03'), '03-09-2026');
  assert.equal(formatAddressWithPostcode('71 Southernhay, Basildon', 'SS14 1EU'), '71 Southernhay, Basildon, SS14 1EU');
  assert.equal(formatAddressWithPostcode('71 Southernhay, Basildon, SS14 1EU', 'ss14 1eu'), '71 Southernhay, Basildon, SS14 1EU');
  assert.equal(formatAddressWithPostcode('', 'ss14 1eu'), 'SS14 1EU');
  assert.match(PDF_DEVELOPER_CREDIT, /Razvan Cristofor.*www\.razvancristofor\.ro/);
});

test('fits the 22-product bilingual invoice and its total on one PDF page', () => {
  const base = {
    issuerName: 'THE GOODNESS BAKER LTD', issuerAddress: 'London', issuerCrn: '123', issuerVat: 'GB123',
    invoiceSeries: 'TGB', invoiceColor: '#F7B810', invoiceAlternateRowColor: '#F7B810', invoiceAlternateRowOpacity: 14,
    vatRegistered: true,
  };
  const items = Array.from({ length: 22 }, (_, index) => ({
    productName: index === 21 ? 'WHITE BLOOMER BREAD 500G PACKED SLICED' : `LONG ENGLISH PRODUCT NAME ${index + 1} PACKAGED`,
    name_ro: index === 21 ? 'FRANZELĂ FELIATĂ 500G' : `DENUMIRE PRODUS ÎN ROMÂNĂ ${index + 1}`,
    unit: 'piece', quantity: index + 1, unitPrice: 1.4, totalPrice: (index + 1) * 1.4,
  }));
  const pdf = generateInvoicePDF(base, {
    ...invoice,
    invoiceNumber: 'TGB-6',
    invoiceDate: '2026-09-03',
    client: { name: 'CLIENT TEST LTD', address: '1 Billing Road, London, E1 1AA' },
    store: { name: 'STORE TEST', address: '71 Southernhay, Basildon', postcode: 'SS14 1EU' },
    items,
    totalAmount: items.reduce((sum, item) => sum + item.totalPrice, 0),
  });
  const source = Buffer.from(pdf).toString('latin1');
  assert.equal((source.match(/\/Type \/Page\b/g) || []).length, 1);
});

test('compact product rows still paginate long descriptions without changing financial data', () => {
  const data = { ...invoice, items: Array.from({ length: 55 }, (_, i) => ({
    productName: `PRODUCT ${i + 1} ` + 'LONG PACKAGED DESCRIPTION '.repeat(5),
    name_ro: 'DENUMIRE PRODUS ÎN ROMÂNĂ '.repeat(4), unit: 'piece', quantity: 1, unitPrice: 2, totalPrice: 2,
  })), totalAmount: 110 };
  const original = structuredClone(data);
  for (const vatRegistered of [true, false]) {
    const pdf = generateInvoicePDF({ issuerName: 'SYNTHETIC BAKERY', vatRegistered }, data);
    assert.ok((Buffer.from(pdf).toString('latin1').match(/\/Type \/Page\b/g) || []).length >= 3);
    assert.deepEqual(data, original);
  }
});
