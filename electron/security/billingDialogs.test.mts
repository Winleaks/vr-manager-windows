import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('billing actions use application modals instead of unsupported native prompts', () => {
  const pages = ['BillingClients.tsx', 'BillingCreditNotes.tsx', 'BillingInvoices.tsx', 'BillingOrders.tsx', 'BillingSettings.tsx'];
  for (const page of pages) {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'pages', page), 'utf8');
    assert.doesNotMatch(source, /(?:window\.)?prompt\s*\(/, `${page} still uses a native prompt`);
  }
});

test('billing test mode exposes permanent deletion for cancelled invoices', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src', 'pages', 'BillingInvoices.tsx'), 'utf8');
  assert.match(source, /\{\(testMode \|\| !isCancelled\) && <button/);
  assert.match(source, /\{isCancelled && !testMode && <button/);
});
