import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { creditNoteProductDescription, generateCreditNotePdf } from '../reports/creditNotePdf.ts';
import { creditNoteFilename, saveCreditNotePdf } from '../reports/creditNoteDelivery.ts';

function note(vatRegistered: boolean) {
  return {
    reference: vatRegistered ? 'CN-TGB-1' : 'CN-VATRA-1', issue_date: '2026-09-03', created_at: '2026-09-03T10:00:00Z', status: 'issued',
    reason: 'Produse deteriorate – corecție agreată', backdate_reason: null, net_amount: 10, vat_amount: 0, total_amount: 10,
    issuerSnapshot: { issuerName: vatRegistered ? 'THE GOODNESS BAKER LTD' : 'VATRA ROMANEASCA LTD', issuerAddress: 'London', issuerCrn: '123', issuerVat: vatRegistered ? 'GB123' : '', vatRegistered, invoiceColor: '#4F46E5' },
    customerSnapshot: { companyName: 'CLIENT ROMÂNESC LTD', companyAddress: 'Londra', companyRegistrationNumber: '456', companyVatNumber: '' },
    invoices: [{ id: 1, invoice_number: 'TGB-10', invoice_date: '2026-09-01' }],
    items: Array.from({ length: 70 }, (_, index) => ({ source_invoice_id: 1, store_name: 'Magazin Central', product_name: `Bread ${index}`, product_name_ro: 'Pâine', variant_label: '', unit: 'buc', quantity: 1, unit_amount: 10 / 70, vat_rate: 0, vat_amount: 0, total_amount: 10 / 70 })),
  };
}

test('generates paginated VAT and non-VAT Credit Note PDFs from immutable snapshots', () => {
  for (const registered of [true, false]) {
    const pdf = generateCreditNotePdf(note(registered));
    assert.equal(Buffer.from(pdf).subarray(0, 4).toString(), '%PDF');
    assert.ok(pdf.byteLength > 10_000);
  }
});

test('Credit Note product description excludes the variant label', () => {
  const item = { product_name: 'Cheese Pie', product_name_ro: 'Plăcintă cu brânză', variant_label: 'Large' };
  assert.equal(creditNoteProductDescription(item), 'Cheese Pie\nPlăcintă cu brânză');
});

test('saves Credit Note PDF to its client directory and overwrites atomically', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-credit-note-'));
  try {
    const pdf = generateCreditNotePdf(note(true));
    const first = saveCreditNotePdf(root, 'CLIENT ROMÂNESC LTD', 'CN-TGB-1', pdf);
    const second = saveCreditNotePdf(root, 'CLIENT ROMÂNESC LTD', 'CN-TGB-1', pdf);
    assert.equal(first.filePath, second.filePath);
    assert.equal(path.basename(first.filePath), creditNoteFilename('CN-TGB-1'));
    assert.equal(Buffer.from(fs.readFileSync(first.filePath)).subarray(0, 4).toString(), '%PDF');
    assert.match(first.filePath, /Clienti[/\\]CLIENT ROMÂNESC LTD[/\\]Credit Notes/);
    assert.throws(() => saveCreditNotePdf(root, '///', 'CN-TGB-1', pdf), /clientului/);
    assert.throws(() => creditNoteFilename('../bad.pdf'), /Referința/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
