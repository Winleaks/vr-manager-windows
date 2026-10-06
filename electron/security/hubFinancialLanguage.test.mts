import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('Hub financial synchronization states and retry controls are Romanian', () => {
  const banner = source('src/components/FinancialSyncBanner.tsx');
  for (const text of [
    'Starea sincronizării financiare nu este disponibilă',
    'Se verifică sincronizarea financiară…',
    'Sincronizarea financiară este gestionată de calculatorul principal (Writer).',
    'Modificările financiare așteaptă sincronizarea',
    'Modificările financiare sunt sincronizate cu platforma clienților.',
    'Se reîncearcă…', 'Reîncearcă sincronizarea',
  ]) assert.ok(banner.includes(text), `Missing Romanian state: ${text}`);
  assert.doesNotMatch(banner, /Financial synchronization|Financial changes|Checking financial|Retry publication|Retrying/);
});

test('native financial close warning is Romanian and keeps the safe default', () => {
  const main = source('electron/main.ts');
  assert.ok(main.includes("title:'Modificările financiare nu sunt sincronizate'"));
  assert.ok(main.includes("message:'Unele modificări financiare nu au fost confirmate de platforma clienților.'"));
  assert.ok(main.includes("buttons:['Păstrează Hub deschis','Închide oricum'],defaultId:0,cancelId:0"));
  assert.ok(main.includes('platforma va folosi ultimul sold confirmat'));
  assert.doesNotMatch(main, /title:'Financial changes|Keep Hub open'|Close anyway'/);
});

test('both invoice lists use Romanian labels while invoice PDFs remain English', () => {
  for (const path of ['src/pages/BillingInvoices.tsx', 'src/components/ProtectedInvoiceList.tsx']) {
    const view = source(path);
    assert.ok(view.includes('Scadență:'), path);
    assert.ok(view.includes('Necesită verificare'), path);
    assert.doesNotMatch(view, /Payment due:|Needs review/);
  }
  assert.ok(source('src/utils/pdfGenerator.ts').includes('Payment due:'));
});
