import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyProtectedVault } from '../protectedRegistry/types.ts';
import {
  assertCanGoLive,
  nextProtectedCreditNoteCounter,
  nextProtectedInvoiceCounter,
  registerFailedPinAttempt,
} from '../protectedRegistry/policy.ts';
import { registerProtectedRegistryAccessClick } from '../../src/utils/protectedRegistryAccess.ts';

test('hidden access requires five clicks inside one three-second window', () => {
  let history: number[] = [];
  for (const now of [0, 500, 1000, 1500]) {
    const result = registerProtectedRegistryAccessClick(history, now);
    history = result.history;
    assert.equal(result.triggered, false);
  }
  assert.equal(registerProtectedRegistryAccessClick(history, 2999).triggered, true);
  assert.equal(registerProtectedRegistryAccessClick([0, 500, 1000, 1500], 4001).triggered, false);
});

test('fifth failed PIN persists a fifteen minute lockout and resets attempt counter', () => {
  const now = Date.parse('2026-09-06T10:00:00.000Z');
  assert.deepEqual(registerFailedPinAttempt(3, now), { failedAttempts: 4, lockUntil: null });
  assert.deepEqual(registerFailedPinAttempt(4, now), { failedAttempts: 0, lockUntil: '2026-09-06T10:15:00.000Z' });
});

test('go-live gate requires empty test documents and exact initial counters', () => {
  const vault = createEmptyProtectedVault();
  assert.doesNotThrow(() => assertCanGoLive(vault));
  vault.counters.TGBL = 2931;
  assert.throws(() => assertCanGoLive(vault), /2930/);
  vault.counters.TGBL = 2930;
  vault.invoices.push({ testDocument: true } as any);
  assert.throws(() => assertCanGoLive(vault), /documentele de test/);
});

test('go-live gate rejects leftover test payments and credit entries', () => {
  const vault = createEmptyProtectedVault();
  vault.payments.push({ testEntry: true } as any);
  assert.throws(() => assertCanGoLive(vault), /încasările și creditele de test/);
  vault.payments = [];
  vault.creditEntries.push({ testEntry: true } as any);
  assert.throws(() => assertCanGoLive(vault), /încasările și creditele de test/);
});

test('test counter reset follows remaining documents and returns to protected baselines', () => {
  const vault = createEmptyProtectedVault();
  assert.equal(nextProtectedInvoiceCounter(vault, 'TGBL'), 2930);
  assert.equal(nextProtectedCreditNoteCounter(vault, 'CN-TGBL'), 1);
  vault.invoices.push({ series: 'TGBL', sequenceNumber: 2934 } as any);
  vault.creditNotes.push({ series: 'CN-TGBL', sequenceNumber: 7 } as any);
  assert.equal(nextProtectedInvoiceCounter(vault, 'TGBL'), 2935);
  assert.equal(nextProtectedCreditNoteCounter(vault, 'CN-TGBL'), 8);
});
