import type { ProtectedInvoiceSeries, ProtectedCreditNoteSeries, ProtectedRegistryVault } from './types.ts';

export function assertCanGoLive(vault: ProtectedRegistryVault) {
  if (vault.liveStartedAt) throw new Error('Registrul a intrat deja live.');
  if (vault.invoices.some((invoice) => invoice.testDocument) || vault.creditNotes.some((note) => note.testDocument)) {
    throw new Error('Șterge toate documentele de test înainte de activarea live.');
  }
  if (vault.payments.some((payment) => payment.testEntry) || vault.creditApplications.some((application) => application.testEntry) || vault.creditEntries.some((entry) => entry.testEntry)) {
    throw new Error('Curăță încasările și creditele de test înainte de activarea live.');
  }
  if (vault.counters.TGBL !== 2930 || vault.counters.VRL !== 2930 || vault.counters['CN-TGBL'] !== 1 || vault.counters['CN-VRL'] !== 1) {
    throw new Error('Contoarele trebuie readuse la 2930 / 2930 / 1 / 1 înainte de activarea live.');
  }
}

export function nextProtectedInvoiceCounter(vault: ProtectedRegistryVault, series: ProtectedInvoiceSeries) {
  const matching = vault.invoices.filter((invoice) => invoice.series === series);
  return matching.length ? Math.max(...matching.map((invoice) => invoice.sequenceNumber)) + 1 : 2930;
}

export function nextProtectedCreditNoteCounter(vault: ProtectedRegistryVault, series: ProtectedCreditNoteSeries) {
  const matching = vault.creditNotes.filter((note) => note.series === series);
  return matching.length ? Math.max(...matching.map((note) => note.sequenceNumber)) + 1 : 1;
}

export function registerFailedPinAttempt(failedAttempts: number, now: number, maximum = 5, lockoutMs = 15 * 60 * 1000) {
  const next = failedAttempts + 1;
  return next >= maximum
    ? { failedAttempts: 0, lockUntil: new Date(now + lockoutMs).toISOString() }
    : { failedAttempts: next, lockUntil: null };
}
