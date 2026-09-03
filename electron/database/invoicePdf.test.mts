import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateInvoicePDF,
  INVOICE_NON_VAT_COLUMN_WIDTHS,
  INVOICE_VAT_COLUMN_WIDTHS,
  invoiceProductDescription,
} from '../../src/utils/pdfGenerator.ts';
import { formatAddressWithPostcode, formatPdfDate, PDF_DEVELOPER_CREDIT } from '../../src/utils/pdfDocumentHelpers.ts';

const invoice = {
  invoiceNumber: 'SERIE-1', invoiceDate: '2026-09-01',
  client: { name: 'CLIENT TEST LTD', address: 'London' },
  store: { name: 'STORE TEST', address: 'London' },
  items: [{ productName: 'CHEESE PIE', name_ro: 'PLĂCINTĂ CU BRÂNZĂ', unit: 'pcs', quantity: 2, unitPrice: 3, totalPrice: 6 }],
  totalAmount: 6,
};

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

test('keeps a 22-product bilingual invoice to two complete PDF pages', () => {
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
  assert.equal((source.match(/\/Type \/Page\b/g) || []).length, 2);
});
