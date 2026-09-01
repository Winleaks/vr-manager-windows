import assert from 'node:assert/strict';
import test from 'node:test';
import { generateInvoicePDF } from '../../src/utils/pdfGenerator.ts';

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
