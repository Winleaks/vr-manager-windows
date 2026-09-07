import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('invoice actions are icon-only, accessible and reused on every billing invoice surface', () => {
  const component = read('../../src/components/InvoiceDocumentActions.tsx');
  assert.match(component, /title="Deschide factura" aria-label="Deschide factura"/);
  assert.doesNotMatch(component, />\s*Deschide factura\s*</);
  assert.ok(component.indexOf("runAction('open')") < component.indexOf("runAction('share')"));
  assert.match(component, /title="Trimite pe WhatsApp" aria-label="Trimite pe WhatsApp"/);
  assert.match(component, /title="Printează factura" aria-label="Printează factura"/);
  assert.doesNotMatch(component, />\s*Trimite pe WhatsApp\s*</);
  assert.doesNotMatch(component, />\s*Printează factura\s*</);

  for (const page of ['BillingInvoices.tsx', 'BillingClients.tsx', 'BillingOrders.tsx']) {
    assert.match(read(`../../src/pages/${page}`), /<InvoiceDocumentActions/);
  }
});

test('opening uses the prepared authoritative PDF and reports native opener failures', () => {
  const component = read('../../src/components/InvoiceDocumentActions.tsx');
  assert.ok(component.indexOf('await preparePdf()') < component.indexOf('await api.system.openPdfFile(invoiceId)'));
  assert.match(component, /if \(!result.success\) throw new Error/);
  const handlers = read('../ipc/systemHandlers.ts');
  const openHandler = handlers.slice(handlers.indexOf("handleTrustedIpc('open-pdf-file'"), handlers.indexOf("handleTrustedIpc('share-invoice-pdf'"));
  assert.match(openHandler, /invoiceDocumentIdentity\(invoiceId\)/);
  assert.match(openHandler, /const error = await shell.openPath\(filePath\)/);
  assert.match(openHandler, /const error = await shell.openPath\(legacyPath\)/);
  assert.equal((openHandler.match(/if \(error\) return \{ success: false/g) || []).length, 2);
});

test('invoice share and print resolve an invoice id in the trusted main process', () => {
  const handlers = read('../ipc/systemHandlers.ts');
  assert.match(handlers, /handleTrustedIpc\('share-invoice-pdf'/);
  assert.match(handlers, /handleTrustedIpc\('print-invoice-pdf'/);
  assert.match(handlers, /invoiceDocumentIdentity\(invoiceId\)/);
  assert.match(handlers, /O factură anulată nu poate fi trimisă sau printată/);
});
