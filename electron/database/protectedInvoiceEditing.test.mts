import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { requireText } from './businessValidation.ts';
import { withPrivateCloudOperation } from '../integrations/privateCloudOperation.ts';
import { isChannelAllowedForRole } from '../device/viewerPolicy.ts';
import { createEmptyProtectedVault, type ProtectedInvoice } from '../protectedRegistry/types.ts';
import { applyProtectedInvoiceEdit, protectedInvoiceEditBlock, protectedInvoiceEditReplay, protectedInvoiceVersion, validateProtectedInvoiceEdit } from '../protectedRegistry/invoiceEditing.ts';

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

function harness() {
  const f = fixture();
  const state = { cloud: structuredClone(f.vault), pending: null as any, role: 'writer', writes: 0, failCommit: false, failPdf: false, lockOnPdf: false };
  const sessions = new Map<number, any>([[1, { role: 'writer', webContentsId: 1, lastActivity: Date.now(), vault: structuredClone(f.vault), envelope: {}, driveVersion: '1' }]]);
  const source = readFileSync(new URL('../protectedRegistry/service.ts', import.meta.url), 'utf8');
  const section = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const script = ['let routingOperationQueue = Promise.resolve();', section('export async function withRegistryRoutingLock', 'function assertWriter'),
    section('async function freshSession', 'export function isProtectedRegistryEnabled'),
    section('export async function getProtectedInvoiceForEdit', 'export async function getProtectedInvoiceProducts'),
    section('export async function updateProtectedInvoice', 'export async function getProtectedIssuerChangeOptions')].join('\n').replaceAll('export ', '');
  const bindings = {
    withPrivateCloudOperation, sessions, SESSION_MS: 60000, lockProtectedRegistry: (id: number) => sessions.delete(id),
    setSession: (session: any) => { session.role ??= state.role; session.lastActivity = Date.now(); sessions.set(session.webContentsId, session); }, requireText,
    keyBuffer: () => Buffer.alloc(32), getDeviceRole: () => state.role, assertWriter: () => { if (state.role !== 'writer') throw Error('Writer required'); },
    reconcilePending: async () => { if (state.pending) { state.cloud = structuredClone(state.pending.payload); state.pending = null; } },
    loadVaultFromCloud: async () => ({ vault: structuredClone(state.cloud), envelope: { recovery: {} }, driveVersion: '1' }),
    addAudit: () => {}, encode: (value: any) => Buffer.from(JSON.stringify(value)),
    encryptVaultWithExistingRecovery: (buffer: Buffer) => ({ payload: JSON.parse(buffer.toString()), recovery: {} }),
    readVerifiedPrivateCloudFile: async () => null,
    writeVerifiedPrivateCloudFile: async ({ filename, buffer }: any) => { state.writes++; const envelope = JSON.parse(buffer.toString()); if (filename === 'pending') state.pending = envelope;
      if (filename === 'vault') { if (state.failCommit) throw Error('cloud interrupted'); state.cloud = envelope.payload; } },
    uploadManifest: async () => {}, deletePrivateCloudFile: async () => { state.pending = null; },
    FOLDER: [], PENDING_FILE: 'pending', VAULT_FILE: 'vault', MANIFEST_FILE: 'manifest',
    validateProtectedInvoiceEdit, applyProtectedInvoiceEdit, protectedInvoiceEditReplay, protectedInvoiceVersion, protectedInvoiceEditBlock, activeCreditApplied: () => 0,
    db: { prepare: () => ({ get: () => ({ id: 2, name: 'Potato Bread', name_ro: 'Pâine cu cartofi', unit: 'pcs', supabase_product_id: 'product-b' }) }) },
    refreshProtectedInvoiceDocument: async () => { if (state.lockOnPdf) sessions.delete(1); if (state.failPdf) throw Error('upload failed'); return {}; },
  };
  const javascript = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const handlers = new Function(...Object.keys(bindings), javascript + '\nreturn {updateProtectedInvoice, getProtectedInvoiceForEdit};')(...Object.values(bindings));
  return { ...f, state, sessions, invoke: (request = f.request) => handlers.updateProtectedInvoice(1, request), get: (id = f.invoice.id) => handlers.getProtectedInvoiceForEdit(1, id) };
}

test('reopening the editor reads authoritative cloud state after a stale edit conflict', async () => {
  const h = harness(); h.state.cloud.invoices[0].totalAmount = 11;
  assert.equal(h.sessions.get(1).vault.invoices[0].totalAmount, 8);
  const current = await h.get();
  assert.equal(current.totalAmount, 11); assert.equal(current.expectedVersion, protectedInvoiceVersion(h.state.cloud.invoices[0]));
  assert.equal(h.sessions.get(1).vault.invoices[0].totalAmount, 11); assert.equal(h.state.writes, 0);
  await assert.rejects(h.get('../file.pdf'), /există/);
  h.state.role = 'viewer'; await assert.rejects(h.get(), /Writer/);
});

test('real edit service confirms cloud, rejects stale concurrent edits and makes retry idempotent', async () => {
  const h = harness();
  const first = await h.invoke(); const writes = h.state.writes;
  const second = await h.invoke();
  assert.equal(second.invoice.id, first.invoice.id); assert.equal(h.state.writes, writes);
  assert.equal(h.state.cloud.invoices[0].totalAmount, 23);
  await assert.rejects(h.invoke({ ...h.request, operationId: 'edit-operation-0002' }), /între timp/);
  const concurrent = harness();
  const results = await Promise.allSettled([concurrent.invoke(), concurrent.invoke({ ...concurrent.request, operationId: 'edit-operation-0002' })]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
});

test('interrupted vault persistence recovers same edit; failed PDF never triggers reissuance or returns after lock', async () => {
  const h = harness(); h.state.failCommit = true;
  await assert.rejects(h.invoke(), /cloud interrupted/); assert.equal(h.sessions.get(1).vault.invoices[0].totalAmount, 8);
  h.state.failCommit = false; h.state.failPdf = true;
  const result = await h.invoke(); assert.equal(result.pdf.success, false); assert.equal(result.invoice.totalAmount, 23); assert.equal(h.state.cloud.invoices.length, 1);
  h.state.lockOnPdf = true;
  await assert.rejects(h.invoke(), /expir|blocat/); assert.equal(h.sessions.has(1), false);
});

test('Viewer and locked registry deny editing and new IPC capabilities', async () => {
  for (const channel of ['getInvoiceForEdit', 'getInvoiceProducts', 'updateInvoice']) assert.equal(isChannelAllowedForRole('viewer', `protectedRegistry:${channel}`), false);
  assert.equal(isChannelAllowedForRole('viewer', 'protectedRegistry:printDocument'), true);
  const h = harness(); h.state.role = 'viewer'; await assert.rejects(h.invoke(), /Writer/); assert.equal(h.state.writes, 0);
  h.state.role = 'writer'; h.sessions.clear(); await assert.rejects(h.invoke(), /expir/); assert.equal(h.state.writes, 0);
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
