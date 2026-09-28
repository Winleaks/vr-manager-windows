import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('normal invoice list exposes an icon-only payment action only for collectible invoices on Writer', () => {
  const page = read('../../src/pages/BillingInvoices.tsx');
  assert.match(page, /isWriter && !isCancelled && Number\(inv\.outstanding \|\| 0\) > 0\.005/);
  assert.match(page, /title="Înregistrează plata"/);
  assert.match(page, /aria-label=\{`Înregistrează plata pentru factura \$\{inv\.invoice_number\}`\}/);
  assert.match(page, /<Banknote size=\{16\} aria-hidden="true"/);
  assert.doesNotMatch(page, />\s*Înregistrează plata\s*</);
  assert.match(page, /<InvoicePaymentModal/);
});

test('invoice payment modal fixes company, issuer and invoice identity and records the selected method', () => {
  const modal = read('../../src/components/InvoicePaymentModal.tsx');
  assert.match(modal, /companyId: invoice\.company_id/);
  assert.match(modal, /issuerId: invoice\.issuer_id/);
  assert.match(modal, /invoiceId: invoice\.id/);
  assert.match(modal, /amount: numericAmount/);
  assert.match(modal, /bankName: method === 'transfer' \? bankName : undefined/);
  assert.match(modal, /const \[amount, setAmount\] = useState\(outstanding\.toFixed\(2\)\)/);
  assert.match(modal, /role="dialog" aria-modal="true"/);
});
