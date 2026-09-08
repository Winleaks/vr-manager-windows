// Optional browser regression suite: npm install --no-save playwright, then
// node scripts/testRendererInputs.mjs. VR_HUB_PLAYWRIGHT_MODULE may point to an
// already provisioned Playwright installation instead. All data is synthetic.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const serveOnly = process.argv.includes('--serve');
const externalUrl = process.argv.find((arg) => arg.startsWith('--url='))?.slice(6);
const server = externalUrl ? null : await createServer({
  configFile: false,
  plugins: [react(), {
    name: 'input-fixture',
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__input-test')) return next();
        const html = await vite.transformIndexHtml('/__input-test', '<!doctype html><html lang="ro"><head><title>Input regression fixture</title></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/inputEditing.tsx"></script></body></html>');
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
      });
    },
  }],
  // Match the app's Vite setting for checkouts whose directory contains ':'.
  server: { host: '127.0.0.1', port: 5178, strictPort: true, fs: { strict: false } },
});
if (server) await server.listen();
const url = externalUrl || 'http://127.0.0.1:5178/__input-test';
if (serveOnly) {
  console.log(`Synthetic renderer fixture ready: ${url}`);
} else {
  let browser;
  try {
    const require = createRequire(import.meta.url);
    const { chromium } = require(process.env.VR_HUB_PLAYWRIGHT_MODULE || 'playwright');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', async (dialog) => { errors.push(`Unexpected native ${dialog.type()}`); await dialog.dismiss(); });
    // Do not contact fonts/CDNs or any production system during renderer checks.
    await page.route('**/*', (route) => route.request().url().startsWith('http://127.0.0.1:5178/') ? route.continue() : route.abort());
    let run = 0;
    const open = async (testCase, suffix = '') => {
      await page.goto(`${url}?case=${testCase}&run=${++run}${suffix}`);
      await page.waitForFunction(() => Boolean(window.__inputTest));
    };
    const edit = async (field, value, expected = value) => {
      await field.click();
      await field.press('ControlOrMeta+a');
      await field.press('Backspace');
      assert.equal(await field.inputValue(), '', 'the entire draft must remain empty after deletion');
      await field.pressSequentially(value);
      assert.equal(await field.inputValue(), expected);
      assert.equal(await field.evaluate((element) => document.activeElement === element), true);
    };

    await open('sync');
    await page.getByText(/Salvat local — PDF-uri neconfirmate/).waitFor();
    await page.getByText(/Detalii sincronizare documente/).click();
    await page.getByText(/Factura TEST-1: Drive refuză/).waitFor();
    const retryDocuments=page.getByRole('button',{name:'Reîncearcă documentele în Drive'});
    assert.equal(await retryDocuments.innerText(),'','retry action must be icon-only');
    await retryDocuments.focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.__inputTest.calls.includes('retry-documents'));
    await edit(page.getByLabel('Cantitate test'),'4.25');
    await page.evaluate(()=>window.__inputTest.setDocumentStatus({pending:0,blocked:0,items:[]}));
    await page.getByText(/Salvat local — PDF-uri neconfirmate/).waitFor({state:'hidden',timeout:10000});
    assert.equal(await page.getByLabel('Cantitate test').evaluate(element=>document.activeElement===element),true,'sync updates must not steal input focus');
    await open('sync','&role=viewer');
    await page.getByText(/Salvat local — PDF-uri neconfirmate/).waitFor();
    assert.equal(await page.getByRole('button',{name:'Reîncearcă documentele în Drive'}).count(),0);
    console.log('PASS persistent document warning, details, icon keyboard retry, Viewer denial and input focus preservation');

    await open('numeric');
    await edit(page.getByLabel('Cantitate test'), '3,125', '3.125');
    await edit(page.getByLabel('Preț test'), '1,75', '1.75');
    await page.evaluate(() => window.__inputTest.notify('Nonblocking notice'));
    assert.equal(await page.getByLabel('Preț test').evaluate((element) => document.activeElement === element), true);
    await page.getByRole('button', { name: 'Confirmare test', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Renunță', exact: true }).evaluate((element) => document.activeElement === element), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.getByRole('button', { name: 'Confirmă', exact: true }).evaluate((element) => document.activeElement === element), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button', { name: 'Renunță', exact: true }).evaluate((element) => document.activeElement === element), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('[data-testid="confirmation-result"]').textContent === 'false');
    await edit(page.getByLabel('Preț test'), '0');
    await page.getByRole('button', { name: 'Confirmare test', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmă', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-testid="confirmation-result"]').textContent === 'true');
    await edit(page.getByLabel('Cantitate test'), '12');
    await page.getByRole('button', { name: 'Confirmare test', exact: true }).click();
    await page.evaluate(() => { location.hash = '/another-screen'; });
    await page.waitForFunction(() => document.querySelector('[data-testid="confirmation-result"]').textContent === 'false');
    assert.equal(await page.locator('dialog[open]').count(), 0);
    console.log('PASS numeric deletion/replacement/comma/zero; notice focus; Escape/default-cancel/explicit confirmation');

    await open('clients');
    const search = page.getByPlaceholder('Caută companie după nume, VAT / CUI, CRN...');
    await edit(search, 'Fixture');
    await page.getByRole('button', { name: 'Notificare test' }).click();
    await edit(search, 'Company');
    await page.getByRole('button', { name: 'Confirmare test', exact: true }).click();
    await page.getByRole('button', { name: 'Renunță', exact: true }).click();
    await edit(search, 'Fixture Company');
    assert.equal(await page.getByRole('heading', { name: 'Fixture Company', exact: true }).count(), 1);
    console.log('PASS actual company search before and after feedback');

    for (const suffix of ['', '#/facturare/credit-notes?invoice=1']) {
      await open('credit', suffix);
      if (!suffix) await page.getByRole('button', { name: 'Creează Credit Note', exact: true }).click();
      const quantity = page.getByLabel('Cantitate creditată · TEST-1 · Fixture Product');
      const price = page.getByLabel('Preț creditat · TEST-1 · Fixture Product');
      assert.equal(await quantity.isDisabled(), true);
      await page.locator('input[type="checkbox"]').first().check();
      await edit(quantity, '3,125', '3.125');
      await edit(price, '1,75', '1.75');
      await price.fill('');
      await page.getByPlaceholder('Motiv real și suficient pentru audit').fill('Synthetic correction');
      await page.getByRole('button', { name: 'Emite Credit Note', exact: true }).click();
      assert.equal(await page.evaluate(() => window.__inputTest.calls.length), 0);
      await edit(price, '1.75');
      await page.getByRole('button', { name: 'Emite Credit Note', exact: true }).click();
      await page.waitForFunction(() => window.__inputTest.calls.length === 1);
      const payload = await page.evaluate(() => window.__inputTest.calls[0]);
      assert.equal(payload.items[0].quantity, 3.125);
      assert.equal(payload.items[0].unitAmount, 1.75);
    }
    console.log('PASS normal Credit Notes from both entry paths; blank validation; exact edited submit payload');

    await open('credit', '&role=viewer');
    assert.equal(await page.getByRole('button', { name: 'Creează Credit Note', exact: true }).isDisabled(), true);
    await open('editor');
    await edit(page.getByLabel('Cantitate 1', { exact: true }), '3.25');
    await edit(page.getByLabel('Preț unitar 1', { exact: true }), '1,75', '1.75');
    await open('editor', '&role=viewer');
    assert.equal(await page.getByLabel('Cantitate 1', { exact: true }).isDisabled(), true);
    console.log('PASS existing invoice editor; Viewer restrictions retained');

    await open('protected');
    await page.getByRole('button', { name: 'Credit Notes', exact: true }).click();
    const protectedQuantity = page.getByLabel('Cantitate creditată · TEST-P1 · Fixture Product');
    const protectedPrice = page.getByLabel('Preț creditat · TEST-P1 · Fixture Product');
    assert.equal(await protectedQuantity.isDisabled(), true);
    await page.locator('input[type="checkbox"]').first().check();
    await edit(protectedQuantity, '3,125', '3.125');
    await edit(protectedPrice, '1.75');
    await protectedQuantity.fill('');
    await page.getByPlaceholder('Motiv obligatoriu').fill('Synthetic correction');
    await page.getByRole('button', { name: 'Emite Credit Note', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__inputTest.calls.length), 0);
    await edit(protectedQuantity, '3.125');
    await page.getByRole('button', { name: 'Emite Credit Note', exact: true }).click();
    await page.waitForFunction(() => window.__inputTest.calls.length === 1);
    assert.equal(await page.evaluate(() => window.__inputTest.calls[0].items[0].quantity), 3.125);
    await page.getByRole('button', { name: 'Blochează și ieși' }).click();
    await page.waitForFunction(() => !document.querySelector('[role="status"]'));
    console.log('PASS protected Credit Notes deletion/replacement/payload/blank validation; feedback cleared on lock');

    await open('settings');
    await edit(page.getByPlaceholder('Nume Șofer...'), 'Fixture Driver');
    await page.getByRole('button', { name: 'Notificare test' }).click();
    await edit(page.getByPlaceholder('Telefon...'), '0700000000');
    assert.deepEqual(errors, [], 'no renderer errors or native dialogs');
    console.log('PASS personnel fields; no renderer errors or native dialogs');
  } finally {
    await browser?.close();
    await server?.close();
  }
}
