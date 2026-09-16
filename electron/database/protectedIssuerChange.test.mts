import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { requireText } from './businessValidation.ts';
import { createEmptyProtectedVault, type ProtectedInvoice } from '../protectedRegistry/types.ts';
import { applyProtectedIssuerChange, protectedIssuerChangeBlock, protectedIssuerChangeReplay, validateProtectedIssuerChange } from '../protectedRegistry/issuerChange.ts';
import { applyAutomaticProtectedCredit } from '../protectedRegistry/automaticCredit.ts';
import { issuerSnapshot, type BillingIssuerRow } from './billingIssuers.ts';
import { withPrivateCloudOperation } from '../integrations/privateCloudOperation.ts';

const issuer = (code: 'goodness' | 'vatra'): BillingIssuerRow => ({
  id: code === 'goodness' ? 1 : 2, code, legal_name: code === 'goodness' ? 'GOODNESS' : 'VATRA', address: 'Test address', company_number: '123',
  vat_registered: 0, vat_number: null, bank_name_1: `${code} Bank`, account_number_1: code === 'goodness' ? '11111111' : '22222222', sort_code_1: '12-34-56',
  bank_name_2: null, account_number_2: null, sort_code_2: null, footer: null, invoice_series: code.toUpperCase(), next_invoice_number: 50,
  color: '#4F46E5', alternate_row_color: '#4F46E5', alternate_row_opacity: 5, is_active: 1, is_default: 0, created_at: '', updated_at: '',
});
function fixture(imported = true) {
  const vault = createEmptyProtectedVault();
  vault.assignments.push({ companyKey: 'local:7', localCompanyId: 7, companyName: 'Client', assignedAt: '' });
  const source: ProtectedInvoice = {
    id: 'source-invoice', operationId: 'source-operation-0001', reference: 'TGBL-2929', series: 'TGBL', sequenceNumber: 2929,
    invoiceDate: '2026-09-01', companyKey: 'local:7', companyId: 7, companyName: 'Client', companySnapshot: { name: 'Client' },
    storeExternalId: 'store-7', storeId: 7, storeName: 'Shop', storeSnapshot: { name: 'Shop' }, issuerId: 1, issuerCode: 'goodness', issuerSnapshot: { ...issuerSnapshot(issuer('goodness')) },
    items: [{ id: 'item-1', externalProductId: 'bread-1', finishedProductId: 3, productName: 'Bread', productNameRo: 'Pâine', unit: 'buc', quantity: 2.5, unitPrice: 4, totalPrice: 10, productOrder: 1 }],
    sourceOrderIds: imported ? ['order-1'] : [], sourceFingerprint: imported ? 'fingerprint' : null, periodStart: imported ? '2026-08-31' : null, periodEnd: imported ? '2026-09-06' : null,
    totalAmount: 10, paidAmount: 0, creditedAmount: 0, status: 'unpaid', testDocument: false, createdAt: '', cancelledAt: null, cancellationReason: null, replacesInvoiceId: null, replacedByInvoiceId: null,
  };
  vault.invoices.push(source);
  const request = validateProtectedIssuerChange({ invoiceId: source.id, expectedReference: source.reference, targetIssuerId: 2, invoiceDate: '2026-09-13', reason: 'Corecție emitent', operationId: 'change-operation-001' });
  return { vault, source, request };
}

for (const imported of [true, false]) test(`protected ${imported ? 'imported' : 'manual'} issuer change preserves snapshots, prices and provenance in both directions`, () => {
  const { vault, source, request } = fixture(imported);
  const oldSnapshot = structuredClone(source.issuerSnapshot);
  const result = applyProtectedIssuerChange(vault, request, issuer('vatra'));
  assert.equal(source.status, 'cancelled'); assert.deepEqual(source.issuerSnapshot, oldSnapshot);
  assert.equal(result.reference, 'VRL-2930'); assert.equal(result.issuerSnapshot.issuerName, 'VATRA');
  assert.deepEqual(result.issuerSnapshot, issuerSnapshot(issuer('vatra')));
  assert.equal(source.replacedByInvoiceId, result.id); assert.equal(result.replacesInvoiceId, source.id);
  assert.deepEqual(result.sourceOrderIds, source.sourceOrderIds); assert.equal(result.sourceFingerprint, source.sourceFingerprint);
  assert.deepEqual(result.companySnapshot, source.companySnapshot); assert.deepEqual(result.storeSnapshot, source.storeSnapshot);
  assert.equal(result.totalAmount, 10); assert.equal(result.items[0].unitPrice, 4); assert.equal(result.items[0].quantity, 2.5);
  assert.equal(result.testDocument, false, 'do not change live/test identity from vault mode');
  const beforeRetry = structuredClone(vault);
  assert.equal(applyProtectedIssuerChange(vault, request, issuer('vatra')).id, result.id);
  assert.deepEqual(vault, beforeRetry);
  assert.throws(() => protectedIssuerChangeReplay(vault, { ...request, reason: 'Different' }), /alte date/);
  assert.throws(() => applyProtectedIssuerChange(vault, { ...request, operationId: 'different-operation-002' }, issuer('vatra')), /înlocuitoare/);
  const back = applyProtectedIssuerChange(vault, { ...request, invoiceId: result.id, expectedReference: result.reference, targetIssuerId: 1, operationId: 'change-operation-003' }, issuer('goodness'));
  assert.equal(back.reference, 'TGBL-2930'); assert.equal(vault.counters.VRL, 2931); assert.equal(vault.counters.TGBL, 2931);
  assert.deepEqual(vault.assignments, beforeRetry.assignments);
});

test('protected change blocks payments, issued credit notes, applied credits, stale identity, invalid target and routing', () => {
  for (const modify of [
    ({ vault, source }: ReturnType<typeof fixture>) => { vault.payments.push({ invoiceId: source.id, reversedAt: null } as any); },
    ({ vault, source }: ReturnType<typeof fixture>) => { vault.creditNotes.push({ status: 'issued', sourceInvoiceIds: [source.id] } as any); },
    ({ vault, source }: ReturnType<typeof fixture>) => { vault.creditApplications.push({ invoiceId: source.id, reversedAt: null } as any); },
    ({ source }: ReturnType<typeof fixture>) => { source.status = 'cancelled'; },
  ]) {
    const f = fixture(); modify(f); const before = structuredClone(f.vault);
    assert.ok(protectedIssuerChangeBlock(f.vault, f.source));
    assert.throws(() => applyProtectedIssuerChange(f.vault, f.request, issuer('vatra')));
    assert.deepEqual(f.vault, before);
  }
  for (const change of [ { expectedReference: 'wrong' }, { targetIssuerId: 1 }, { invoiceId: 'missing' } ]) {
    const f = fixture(); const before = structuredClone(f.vault);
    assert.throws(() => applyProtectedIssuerChange(f.vault, { ...f.request, ...change }, issuer('vatra'))); assert.deepEqual(f.vault, before);
  }
  const f = fixture(); f.vault.assignments = [];
  assert.throws(() => applyProtectedIssuerChange(f.vault, f.request, issuer('vatra')), /atribuit/);
  assert.throws(() => validateProtectedIssuerChange({ ...f.request, reason: '' }));
  assert.throws(() => validateProtectedIssuerChange({ ...f.request, invoiceDate: 'invalid' }));
});

test('failed protected persistence discards candidate, retry can commit the same operation once', () => {
  const { vault, request } = fixture(); const before = structuredClone(vault);
  assert.throws(() => { const candidate = structuredClone(vault); applyProtectedIssuerChange(candidate, request, issuer('vatra')); throw new Error('storage unavailable'); });
  assert.deepEqual(vault, before);
  applyProtectedIssuerChange(vault, request, issuer('vatra'));
  assert.equal(vault.invoices.length, 2); assert.equal(vault.counters.VRL, 2931);
});

// Exercise the real service orchestration without Electron, credentials or Drive.
// Storage adapters below deliberately model pending-write recovery, not encryption
// (the encryption implementation has its own independent tests).
function serviceHarness() {
  const { vault, request } = fixture();
  const state = { cloud: structuredClone(vault), pending: null as any, role: 'writer', failVaultWrite: false, failPdf: false, writes: 0, lockOnCommit: false };
  const sessions = new Map<number, any>([[1, { role: 'writer', webContentsId: 1, lastActivity: Date.now(), vault: structuredClone(vault), envelope: {}, driveVersion: '1' }]]);
  const code = readFileSync(new URL('../protectedRegistry/service.ts', import.meta.url), 'utf8');
  const section = (start: string, end: string) => code.slice(code.indexOf(start), code.indexOf(end, code.indexOf(start)));
  const script = [
    'let routingOperationQueue = Promise.resolve();',
    section('export async function withRegistryRoutingLock', 'function assertWriter'),
    section('async function freshSession', 'export function isProtectedRegistryEnabled'),
    section('export async function changeProtectedInvoiceIssuer', 'export async function cancelProtectedInvoice'),
  ].join('\n').replaceAll('export ', '');
  const bindings = {
    assertWriter: () => { if (state.role !== 'writer') throw Error('Writer required'); },
    withPrivateCloudOperation,
    sessions, SESSION_MS: 60000, lockProtectedRegistry: (id: number) => sessions.delete(id),
    setSession: (session: any) => { session.role ??= state.role; session.lastActivity = Date.now(); sessions.set(session.webContentsId, session); },
    requireText, keyBuffer: () => Buffer.alloc(32),
    reconcilePending: async () => { if (state.pending) { state.cloud = structuredClone(state.pending.payload); state.pending = null; } },
    loadVaultFromCloud: async () => ({ vault: structuredClone(state.cloud), envelope: { recovery: {} }, driveVersion: '1' }),
    getDeviceRole: () => state.role,
    addAudit: (next: any, eventType: string, operationId: string, details: any) => next.audit.push({ eventType, operationId, details }),
    encryptVaultWithExistingRecovery: (buffer: Buffer) => ({ payload: JSON.parse(buffer.toString()), recovery: {} }),
    encode: (value: unknown) => Buffer.from(JSON.stringify(value)),
    readVerifiedPrivateCloudFile: async () => null,
    writeVerifiedPrivateCloudFile: async ({ filename, buffer }: any) => {
      state.writes++;
      const envelope = JSON.parse(buffer.toString());
      if (filename === 'pending') state.pending = envelope;
      if (filename === 'vault') { if (state.failVaultWrite) throw Error('vault write unavailable'); state.cloud = envelope.payload; }
    },
    uploadManifest: async () => { if (state.lockOnCommit) sessions.delete(1); }, deletePrivateCloudFile: async () => { state.pending = null; },
    FOLDER: [], PENDING_FILE: 'pending', VAULT_FILE: 'vault', MANIFEST_FILE: 'manifest',
    validateProtectedIssuerChange, protectedIssuerChangeReplay, applyProtectedIssuerChange, applyAutomaticProtectedCredit,
    readStoreSnapshot: () => ({ company_id: 7 }), companyKey: () => 'local:7', readIssuer: () => issuer('vatra'),
    uploadProtectedInvoicePdf: async () => { if (state.failPdf) throw Error('PDF upload unavailable'); return { filename: 'VRL-2930.pdf' }; },
  };
  const javascript = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const invoke = new Function(...Object.keys(bindings), javascript + '\nreturn changeProtectedInvoiceIssuer;')(...Object.values(bindings));
  return { state, sessions, request, invoke: (input = request) => invoke(1, input) };
}

test('real protected service serializes concurrent retries and refreshes the session after replay', async () => {
  const h = serviceHarness();
  const source = h.state.cloud.invoices[0];
  h.state.cloud.creditEntries.push({ id: 'available-credit', companyKey: source.companyKey, issuerCode: 'vatra', sourceType: 'payment_overpayment', sourceId: 'payment-test', originalAmount: 3, availableAmount: 3, createdAt: '2026-09-01', testEntry: source.testDocument });
  const [first, second] = await Promise.all([h.invoke(), h.invoke()]);
  assert.equal(first.invoice.id, second.invoice.id); assert.equal(h.state.cloud.invoices.length, 2);
  assert.equal(h.state.cloud.counters.VRL, 2931); assert.equal(h.state.writes, 2);
  assert.equal(h.state.cloud.creditApplications.length, 1);
  assert.equal(h.state.cloud.creditApplications[0].amount, 3);
  assert.equal(h.state.cloud.creditEntries[0].availableAmount, 0);
  h.sessions.get(1).vault = createEmptyProtectedVault();
  assert.equal((await h.invoke()).invoice.id, first.invoice.id);
  assert.equal(h.sessions.get(1).vault.invoices.length, 2);
  await assert.rejects(h.invoke({ ...h.request, operationId: 'another-operation-001' }), /înlocuitoare/);
});

test('a cloud commit finishing after lock never restores the protected session', async () => {
  const h = serviceHarness(); h.state.lockOnCommit = true;
  await assert.rejects(h.invoke(), /Sesiunea/);
  assert.equal(h.sessions.has(1), false);
  assert.equal(h.state.cloud.invoices.length, 2, 'the confirmed cloud operation is retained');
  assert.equal(h.state.cloud.counters.VRL, 2931);
});

test('real protected service recovers an interrupted write and treats PDF failure as committed issuance', async () => {
  const h = serviceHarness(); h.state.failVaultWrite = true;
  await assert.rejects(h.invoke(), /vault write unavailable/);
  assert.equal(h.state.cloud.invoices.length, 1); assert.equal(h.state.cloud.invoices[0].status, 'unpaid');
  assert.equal(h.sessions.get(1).vault.invoices.length, 1);
  h.state.failVaultWrite = false; h.state.failPdf = true;
  const recovered = await h.invoke();
  assert.equal(recovered.success, true); assert.equal(recovered.pdf.success, false);
  assert.equal(h.state.cloud.invoices.length, 2); assert.equal(h.state.cloud.counters.VRL, 2931);
  assert.equal(h.sessions.get(1).vault.invoices.length, 2);
  assert.equal((await h.invoke()).invoice.id, recovered.invoice.id);
});

test('real protected service rejects locked sessions and Viewer without writing', async () => {
  const locked = serviceHarness(); locked.sessions.clear();
  await assert.rejects(locked.invoke(), /Sesiunea/); assert.equal(locked.state.writes, 0);
  const viewer = serviceHarness(); viewer.state.role = 'viewer';
  await assert.rejects(viewer.invoke(), /Writer/); assert.equal(viewer.state.writes, 0);
});
