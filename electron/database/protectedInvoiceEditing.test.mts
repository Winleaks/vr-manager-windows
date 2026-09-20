import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { protectedOutboxHarness } from '../security/fixtures/protectedOutboxHarness.mts';
import { requireText } from './businessValidation.ts';
import { isChannelAllowedForRole } from '../device/viewerPolicy.ts';
import { createEmptyProtectedVault, type ProtectedInvoice } from '../protectedRegistry/types.ts';
import { applyProtectedInvoiceEdit, protectedInvoiceEditBlock, protectedInvoiceVersion, validateProtectedInvoiceEdit } from '../protectedRegistry/invoiceEditing.ts';

function fixture(imported = true, issuerCode: 'goodness' | 'vatra' = 'goodness') {
  const vault = createEmptyProtectedVault();
  const invoice: ProtectedInvoice = {
    id: 'invoice-a', reference: 'TGBL-2930', operationId: 'issue-operation-0001', series: 'TGBL', sequenceNumber: 2930,
    invoiceDate: '2026-09-13', companyId: 1, companyKey: 'local:1', companyName: 'Synthetic client', companySnapshot: { name: 'Synthetic client' },
    storeId: 2, storeExternalId: 'store-2', storeName: 'Shop', storeSnapshot: { name: 'Shop' }, issuerId: 1, issuerCode, issuerSnapshot: { issuerName: issuerCode },
    sourceOrderIds: imported ? ['order-a'] : [], sourceFingerprint: 'original-import', periodStart: '2026-09-07', periodEnd: '2026-09-13',
    items: [{ id: 'line-a', externalProductId: 'product-a', finishedProductId: 1, productName: 'Bread', productNameRo: 'Pâine', unit: 'pcs', quantity: 4, unitPrice: 2, totalPrice: 8, productOrder: 1 }],
    totalAmount: 8, paidAmount: 2, creditedAmount: 0, status: 'partial', createdAt: '', testDocument: true, cancelledAt: null, cancellationReason: null, replacedByInvoiceId: null, replacesInvoiceId: null,
  };
  vault.invoices.push(invoice);
  const request = validateProtectedInvoiceEdit({ invoiceId: invoice.id, expectedVersion: protectedInvoiceVersion(invoice), operationId: 'edit-operation-0001', invoiceDate: '2026-09-12',
    items: [{ id: 'line-a', quantity: 5, unitPrice: 3 }, { productId: 2, quantity: 2, unitPrice: 4 }] });
  const product = () => ({ externalProductId: 'product-b', finishedProductId: 2, productName: 'Potato Bread', productNameRo: 'Pâine cu cartofi', unit: 'pcs', productOrder: 2 });
  return { vault, invoice, request, product };
}

for (const imported of [true, false]) for (const issuer of ['goodness', 'vatra'] as const) test(`protected edit ${issuer} ${imported ? 'imported' : 'manual'} preserves identity and cash, adds catalog product, replays once`, () => {
  const f = fixture(imported, issuer), before = structuredClone(f.invoice), counters = { ...f.vault.counters };
  applyProtectedInvoiceEdit(f.vault, f.request, f.product);
  assert.equal(f.invoice.totalAmount, 23); assert.equal(f.invoice.paidAmount, 2); assert.equal(f.invoice.status, 'partial');
  assert.equal(f.invoice.items[0].id, 'line-a'); assert.equal(f.invoice.items[1].productName, 'Potato Bread');
  for (const key of ['id','reference','issuerSnapshot','companySnapshot','storeSnapshot','sourceOrderIds','sourceFingerprint','operationId'] as const) assert.deepEqual(f.invoice[key], before[key]);
  assert.deepEqual(f.vault.counters, counters); assert.equal(f.vault.invoices.length, 1);
  const saved = structuredClone(f.vault);
  applyProtectedInvoiceEdit(f.vault, f.request, f.product); assert.deepEqual(f.vault, saved);
  assert.throws(() => applyProtectedInvoiceEdit(f.vault, { ...f.request, invoiceDate: '2026-09-11' }, f.product), /alte date/);
  assert.equal(f.vault.audit[0].details.before.totalAmount, 8);
});

test('protected editing refuses cancelled, credit, stale and foreign rows without partial changes', () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.invoice.status = 'cancelled'; },
    (f: ReturnType<typeof fixture>) => { f.invoice.creditedAmount = 1; },
    (f: ReturnType<typeof fixture>) => { f.vault.creditNotes.push({ status: 'issued', sourceInvoiceIds: [f.invoice.id] } as any); },
    (f: ReturnType<typeof fixture>) => { f.vault.creditApplications.push({ invoiceId: f.invoice.id, reversedAt: null } as any); },
    (f: ReturnType<typeof fixture>) => { f.invoice.totalAmount = 9; },
    (f: ReturnType<typeof fixture>) => { f.request.items.push({ id: 'foreign-line', quantity: 1, unitPrice: 1 }); },
    (f: ReturnType<typeof fixture>) => { f.request.items = [{ productId: 2, quantity: 1, unitPrice: 1 }]; },
    (f: ReturnType<typeof fixture>) => { f.request.items = [{ id: 'line-a', quantity: 1, unitPrice: 1 }]; },
  ]) {
    const f = fixture(); change(f); const before = structuredClone(f.vault);
    assert.throws(() => applyProtectedInvoiceEdit(f.vault, f.request, f.product)); assert.deepEqual(f.vault, before);
  }
});

test('explicit removal keeps source orders, invalid dates/numbers and arbitrary identifiers fail closed', () => {
  const f = fixture();
  f.request.items[0] = { id: 'line-a', quantity: 0, unitPrice: 2, remove: true };
  applyProtectedInvoiceEdit(f.vault, f.request, f.product);
  assert.equal(f.invoice.items.length, 1); assert.deepEqual(f.invoice.sourceOrderIds, ['order-a']);
  for (const input of [
    { ...f.request, invoiceDate: '2026-02-30' }, { ...f.request, expectedVersion: '../anything.pdf' },
    ...[NaN, Infinity, -1, null, ''].map(quantity => ({ ...f.request, items: [{ id: 'line-a', quantity, unitPrice: 1 }] })),
    { ...f.request, items: [{ productId: '../file', quantity: 1, unitPrice: 1 }] },
  ]) assert.throws(() => validateProtectedInvoiceEdit(input as any));
});

function harness(t: any) {
  const f = fixture();
  const h = protectedOutboxHarness(t, undefined, f.vault, {
    db: { prepare: () => ({ get: () => ({ id: 2, name: 'Potato Bread', name_ro: 'Pâine cu cartofi', unit: 'pcs', supabase_product_id: 'product-b' }) }) },
  });
  return { ...f, ...h, invoke: (request = f.request) => h.api.updateProtectedInvoice(1, request), get: (id = f.invoice.id) => h.api.getProtectedInvoiceForEdit(1, id) };
}

test('reopening reads cloud when settled, but retains newer pending local edits', async t => {
  const h = harness(t); const cloud = h.current(); cloud.invoices[0].totalAmount = 11; h.replaceCloud(cloud);
  assert.equal(h.sessions.get(1).vault.invoices[0].totalAmount, 8);
  const current = await h.get();
  assert.equal(current.totalAmount, 11); assert.equal(current.expectedVersion, protectedInvoiceVersion(cloud.invoices[0]));
  assert.equal(h.state.writes.length, 0);
  await assert.rejects(h.get('../file.pdf'), /există/);
  h.state.role = 'viewer'; await assert.rejects(h.get(), /Writer/);
});

test('real edit service accepts pending save, rejects stale concurrent edits and replays without another revision', async t => {
  const h = harness(t);
  const first = await h.invoke(); assert.equal(first.pdf.pending, true);
  await h.worker.start(); const writes = h.state.writes.length;
  const second = await h.invoke();
  assert.equal(second.invoice.id, first.invoice.id); assert.equal(h.state.writes.length, writes);
  assert.equal(h.current().invoices[0].totalAmount, 23);
  await assert.rejects(h.invoke({ ...h.request, operationId: 'edit-operation-0002' }), /între timp/);
  const concurrent = harness(t);
  const results = await Promise.allSettled([concurrent.invoke(), concurrent.invoke({ ...concurrent.request, operationId: 'edit-operation-0002' })]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  await concurrent.worker.start();
});

test('vault/PDF interruptions preserve accepted edits, retry never reissues, lock never restores the session', async t => {
  const h = harness(t); h.state.failAt = 'registru-separat.vault';
  const accepted = await h.invoke(); assert.equal(accepted.invoice.totalAmount, 23);
  await h.worker.start(); assert.equal(h.store.count(), 1);
  assert.equal((await h.get()).totalAmount, 23, 'opening editor must not replace pending edits with cloud');
  h.state.failAt = 'pdf'; await h.worker.start(); assert.equal(h.store.count(), 1);
  assert.equal(h.current().invoices.length, 1);
  h.sessions.clear(); h.state.failAt = ''; await h.worker.start();
  assert.equal(h.store.count(), 0); assert.equal(h.sessions.size, 0);
  assert.equal(h.current().invoices[0].totalAmount, 23);
});

test('Viewer and locked registry deny editing and new IPC capabilities', async t => {
  for (const channel of ['getInvoiceForEdit', 'getInvoiceProducts', 'updateInvoice']) assert.equal(isChannelAllowedForRole('viewer', `protectedRegistry:${channel}`), false);
  assert.equal(isChannelAllowedForRole('viewer', 'protectedRegistry:printDocument'), true);
  const h = harness(t); h.state.role = 'viewer'; await assert.rejects(h.invoke(), /Writer/); assert.equal(h.state.writes.length, 0);
  h.state.role = 'writer'; h.sessions.clear(); await assert.rejects(h.invoke(), /expir/); assert.equal(h.state.writes.length, 0);
  assert.equal(protectedInvoiceEditBlock(h.vault, h.invoice), null);
});

test('document preparation regenerates invoice before reading cached PDF and never falls back after refresh failure', async () => {
  const source = readFileSync(new URL('../protectedRegistry/service.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function protectedPdfToTemporaryFile');
  const end = source.indexOf('export async function exportProtectedRegistryMonth', start);
  const script = source.slice(start, end).replaceAll('export ', '');
  const invoice = fixture().invoice;
  const session = { role: 'writer', lastActivity: Date.now(), vault: { invoices: [invoice], creditNotes: [] } };
  const sessions = new Map([[1, session]]), calls: string[] = [];
  let fail = false, lock = false;
  const bindings = {
    withRegistryRoutingLock: (operation: () => Promise<unknown>) => operation(),
    assertProtectedCloudSettled: () => undefined,
    freshSession: async () => { if (!sessions.has(1)) throw Error('locked'); return session; }, sessions,
    refreshProtectedInvoiceDocument: async () => { calls.push('refresh'); if (fail) throw Error('PDF upload unavailable'); },
    readProtectedDocumentPdf: async () => { calls.push('read'); if (lock) sessions.delete(1); return { buffer: Buffer.from('%PDF-fresh') }; },
    getDeviceRole: () => 'writer', SESSION_MS: 60000,
    assertWriter: () => {}, path: { join: (...args: string[]) => args.join('/') }, app: { getPath: () => '/synthetic' }, randomUUID: () => 'uuid',
    fs: { writeFileSync: () => calls.push('temporary-file') }, toValidatedPdfBuffer: (buffer: Buffer) => buffer,
    temporaryFiles: new Map(), requireText, shell: { openPath: async () => { calls.push('open'); return ''; } },
    openWindowsDocument: async (action: string) => { calls.push(action); return { success: false, canceled: true }; },
  };
  const javascript = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const handlers = new Function(...Object.keys(bindings), javascript + '\nreturn {openProtectedDocument, printProtectedDocument};')(...Object.values(bindings));
  const result = await handlers.printProtectedDocument(1, 'invoice', invoice.id);
  assert.equal(result.canceled, true); assert.deepEqual(calls, ['refresh', 'read', 'temporary-file', 'print']);
  calls.length = 0; fail = true;
  await assert.rejects(handlers.openProtectedDocument(1, 'invoice', invoice.id), /upload unavailable/); assert.deepEqual(calls, ['refresh']);
  calls.length = 0; fail = false; lock = true;
  await assert.rejects(handlers.openProtectedDocument(1, 'invoice', invoice.id), /blocat/); assert.deepEqual(calls, ['refresh', 'read']);
  sessions.set(1, session); calls.length = 0; invoice.status = 'cancelled';
  await assert.rejects(handlers.openProtectedDocument(1, 'invoice', invoice.id), /anulat/); assert.deepEqual(calls, []);
  await assert.rejects(handlers.printProtectedDocument(1, 'invoice', '../arbitrary.pdf'), /există/);
});
