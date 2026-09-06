import assert from 'node:assert/strict';
import test from 'node:test';
import { assignEstimatedInvoiceReferences } from '../../src/utils/invoicePreviewNumbering.ts';

test('previews consecutive invoice references independently for every issuer', () => {
  const rows = assignEstimatedInvoiceReferences([
    { name: 'A', billingState: 'ready', issuerId: 1, issuerInvoiceSeries: 'TGB', issuerNextInvoiceNumber: 7 },
    { name: 'B', billingState: 'ready', issuerId: 1, issuerInvoiceSeries: 'TGB', issuerNextInvoiceNumber: 7 },
    { name: 'C', billingState: 'ready', issuerId: 2, issuerInvoiceSeries: 'VR', issuerNextInvoiceNumber: 12 },
    { name: 'D', billingState: 'ready', issuerId: 1, issuerInvoiceSeries: 'TGB', issuerNextInvoiceNumber: 7 },
  ]);
  assert.deepEqual(rows.map((row) => row.estimatedInvoiceReference), ['TGB-7', 'TGB-8', 'VR-12', 'TGB-9']);
});

test('issued rows do not consume preview numbers and a newer counter wins', () => {
  const rows = assignEstimatedInvoiceReferences([
    { billingState: 'invoiced', issuerId: 1, issuerInvoiceSeries: 'TGB', issuerNextInvoiceNumber: 8, estimatedInvoiceReference: 'TGB-7' },
    { billingState: 'ready', issuerId: 1, issuerInvoiceSeries: 'TGB', issuerNextInvoiceNumber: 7 },
    { billingState: 'ready', issuerId: 1, issuerInvoiceSeries: 'TGB', issuerNextInvoiceNumber: 7 },
  ]);
  assert.deepEqual(rows.map((row) => row.estimatedInvoiceReference), ['TGB-7', 'TGB-8', 'TGB-9']);
});
