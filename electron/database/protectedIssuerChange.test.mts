import test from 'node:test';
import { protectedOutboxHarness } from '../security/fixtures/protectedOutboxHarness.mts';
import assert from 'node:assert/strict';
import { createEmptyProtectedVault, type ProtectedInvoice } from '../protectedRegistry/types.ts';
import { applyProtectedIssuerChange, protectedIssuerChangeBlock, protectedIssuerChangeReplay, validateProtectedIssuerChange } from '../protectedRegistry/issuerChange.ts';
import { issuerSnapshot, type BillingIssuerRow } from './billingIssuers.ts';

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

// Real service + encrypted outbox; external adapters remain synthetic.
function serviceHarness(t: any) {
  const { vault, request } = fixture();
  const h = protectedOutboxHarness(t, undefined, vault, {
    readStoreSnapshot: () => ({ company_id: 7 }), companyKey: () => 'local:7', readIssuer: () => issuer('vatra'),
  });
  return { ...h, request, invoke: (input = request) => h.api.changeProtectedInvoiceIssuer(1, input) };
}

test('issuer change serializes pending retries, preserves credit, and recovers the same replacement after unlock', async t => {
  const h = serviceHarness(t); const cloud = h.current(); const source = cloud.invoices[0];
  cloud.creditEntries.push({ id: 'available-credit', companyKey: source.companyKey, issuerCode: 'vatra', sourceType: 'payment_overpayment', sourceId: 'payment-test', originalAmount: 3, availableAmount: 3, createdAt: '2026-09-01', testEntry: source.testDocument });
  h.replaceCloud(cloud); await h.api.unlockProtectedRegistry(1, 'synthetic-pin');
  const [first, second] = await Promise.all([h.invoke(), h.invoke()]);
  assert.equal(first.invoice.id, second.invoice.id); await h.worker.start();
  assert.equal(h.current().invoices.length, 2); assert.equal(h.current().counters.VRL, 2931);
  assert.equal(h.state.writes.filter(name => name === 'registru-separat.vault').length, 1);
  assert.equal(h.current().creditApplications.length, 1); assert.equal(h.current().creditApplications[0].amount, 3);
  assert.equal(h.current().creditEntries[0].availableAmount, 0);
  h.sessions.clear(); await h.api.unlockProtectedRegistry(1, 'synthetic-pin');
  assert.equal((await h.invoke()).invoice.id, first.invoice.id);
  assert.equal(h.sessions.get(1).vault.invoices.length, 2);
  await assert.rejects(h.invoke({ ...h.request, operationId: 'another-operation-001' }), /înlocuitoare/);
});

test('accepted issuer change can finish after lock without restoring the protected session', async t => {
  const h = serviceHarness(t); const accepted = await h.invoke();
  assert.equal(accepted.pdf.pending, true); h.sessions.clear(); await h.worker.start();
  assert.equal(h.sessions.has(1), false);
  assert.equal(h.current().invoices.length, 2); assert.equal(h.current().counters.VRL, 2931);
});

test('interrupted issuer change/PDF upload retries a saved replacement, not issuance', async t => {
  const h = serviceHarness(t); h.state.failAt = 'registru-separat.vault';
  const accepted = await h.invoke(); await h.worker.start();
  assert.equal(h.current().invoices.length, 1); assert.equal(h.store.count(), 1);
  assert.equal(h.sessions.get(1).vault.invoices.length, 2);
  h.state.failAt = 'pdf'; await h.worker.start();
  assert.equal(h.current().invoices.length, 2); assert.equal(h.store.count(), 1);
  h.state.failAt = ''; await h.worker.start();
  assert.equal(h.current().counters.VRL, 2931); assert.equal(h.store.count(), 0);
  assert.equal((await h.invoke()).invoice.id, accepted.invoice.id);
});

test('real protected issuer change rejects locked sessions and Viewer without writing', async t => {
  const locked = serviceHarness(t); locked.sessions.clear();
  await assert.rejects(locked.invoke(), /Sesiunea/); assert.equal(locked.state.writes.length, 0);
  const viewer = serviceHarness(t); viewer.state.role = 'viewer';
  await assert.rejects(viewer.invoke(), /Writer/); assert.equal(viewer.state.writes.length, 0);
});
