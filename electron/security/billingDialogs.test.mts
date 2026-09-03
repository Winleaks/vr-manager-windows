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
