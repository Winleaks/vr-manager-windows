import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateInvoicePDF } from '../../src/utils/pdfGenerator.ts';

const popplerAvailable = spawnSync('pdftotext', ['-v'], { timeout: 5000 }).status === 0;

test('rendered payment due remains above account balance for VAT/non-VAT and zero/nonzero balances', {
  skip: !popplerAvailable && 'Poppler is required for rendered PDF geometry checks',
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'invoice-header-'));
  try {
    for (const vatRegistered of [true, false]) for (const total of [0, 63]) {
      const data = {
        invoiceNumber: 'TGB-391', invoiceDate: '2026-10-04', dueDate: '2026-10-08',
        client: { name: 'Fixture Client' }, store: { name: 'Fixture Store' },
        items: [{ productName: 'Bread', quantity: 15, unitPrice: 1.4, totalPrice: 21 }],
        totalAmount: 21, accountOutstanding: { total, rows: [] },
      };
      const before = structuredClone(data);
      const input = join(directory, 'invoice.pdf');
      const output = join(directory, 'invoice.xhtml');
      writeFileSync(input, generateInvoicePDF({ invoiceSeries: 'TGB', issuerName: 'Fixture Bakery', vatRegistered }, data));
      const extracted = spawnSync('pdftotext', ['-bbox', input, output], { timeout: 10000 });
      assert.equal(extracted.status, 0, extracted.stderr?.toString());
      const words = [...readFileSync(output, 'utf8').matchAll(/<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">([^<]+)<\/word>/g)];
      const payment = words.find(word => word[5] === 'Payment');
      const due = words.find(word => word[5] === 'due:');
      const balance = words.find(word => word[5] === 'ACCOUNT');
      assert.ok(payment && due && balance, 'Both header fields must survive rendering');
      // The entire payment line must finish above the balance card background,
      // not merely above its text (the original card painted over this line).
      assert.ok(Math.max(Number(payment[4]), Number(due[4])) < 28 * 72 / 25.4);
      assert.ok(Number(balance[2]) > Number(payment[4]));
      assert.deepEqual(data, before);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
