import { createHash } from 'node:crypto';
import { requireIsoDate, requireMoneyNonNegative, requireText } from '../database/businessValidation.ts';
import type { ProtectedTransferInput } from '../../src/shared/protectedTransfer.ts';
import type { ProtectedInvoice, ProtectedRegistryVault } from './types.ts';

export interface ProtectedTransfer {
  operationId: string;
  request: ProtectedTransferInput;
  invoiceDate: string;
  state: 'pending' | 'committed';
  target?: { invoiceId: number; invoiceNumber: string };
  paymentIds: string[];
  credits?: Array<{ id: string; amount: number; createdAt: string }>;
  completedAt?: string;
}
export function transferFingerprint(vault: ProtectedRegistryVault, invoice: ProtectedInvoice) {
  return createHash('sha256').update(JSON.stringify([invoice,
    vault.payments.filter(row => row.invoiceId === invoice.id),
    vault.creditNotes.filter(row => row.sourceInvoiceIds.includes(invoice.id)),
    vault.creditApplications.filter(row => row.invoiceId === invoice.id),
  ])).digest('hex');
}
export function transferableCredits(vault: ProtectedRegistryVault, invoice: ProtectedInvoice) {
  return vault.creditApplications.filter(row => row.invoiceId === invoice.id && !row.reversedAt).map(row => {
    if (row.companyKey !== invoice.companyKey || row.issuerCode !== invoice.issuerCode || row.testEntry ||
        !Number.isFinite(row.amount) || row.amount <= 0 || !Array.isArray(row.allocations) ||
        row.allocations.reduce((sum, a) => sum + Math.round(a.amount * 100), 0) !== Math.round(row.amount * 100) ||
        row.allocations.some(a => !Number.isFinite(a.amount) || a.amount <= 0 || !vault.creditEntries.some(e =>
          e.id === a.creditEntryId && e.companyKey === invoice.companyKey && e.issuerCode === invoice.issuerCode && !e.testEntry))) {
      throw Error('Creditul aplicat necesită verificare înainte de transfer.');
    }
    return { id: row.id, amount: row.amount, createdAt: row.createdAt };
  });
}
export function transferCreditAmount(vault: ProtectedRegistryVault, invoice: ProtectedInvoice) {
  return transferableCredits(vault, invoice).reduce((sum, row) => sum + Math.round(row.amount * 100), 0) / 100;
}
export function transferBlock(vault: ProtectedRegistryVault, invoice: ProtectedInvoice) {
  if (invoice.transfer) return invoice.transfer.state === 'pending' ? 'Transferul este în curs. Reia aceeași operațiune.' : 'Factura a fost transferată definitiv.';
  if (vault.mode !== 'live' || invoice.testDocument) return 'Facturile TEST nu pot fi transferate.';
  if (invoice.status === 'cancelled') return 'Factura este anulată.';
  if (invoice.creditedAmount > 0 || vault.creditNotes.some(row => row.status === 'issued' && row.sourceInvoiceIds.includes(invoice.id))) return 'Factura are Credit Notes. Rezolvă creditările înainte de transfer.';
  try { transferableCredits(vault, invoice); } catch { return 'Creditul aplicat necesită verificare înainte de transfer.'; }
  if (!invoice.storeId) return 'Magazinul nu mai este asociat local.';
  if (Math.round(invoice.totalAmount * 100) < Math.round((invoice.paidAmount + transferCreditAmount(vault, invoice)) * 100)) return 'Soldul facturii necesită verificare.';
  const payments = vault.payments.filter(row => row.invoiceId === invoice.id && !row.reversedAt);
  if (payments.some(row => row.companyKey !== invoice.companyKey || row.issuerCode !== invoice.issuerCode || row.testEntry)) return 'Încasările facturii necesită verificare.';
  if (payments.reduce((sum, row) => sum + Math.round(row.amount * 100), 0) !== Math.round(invoice.paidAmount * 100)) return 'Soldul încasărilor nu corespunde facturii. Reîncarcă și verifică încasările.';
  return null;
}
export function validateTransfer(input: ProtectedTransferInput, today: string) {
  const invoiceId = requireText(input?.invoiceId, 'Factura', 100);
  const expectedVersion = requireText(input?.expectedVersion, 'Versiunea facturii', 64);
  const operationId = requireText(input?.operationId, 'Operațiunea', 100);
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(operationId)) throw Error('Identificator de transfer invalid.');
  const amount = requireMoneyNonNegative(input?.amount, 'Suma card');
  const paymentDate = requireIsoDate(input?.paymentDate, 'Data încasării');
  if (paymentDate > today) throw Error('Data încasării nu poate fi în viitor.');
  const bankName = input?.bankName;
  if (bankName !== undefined && !['Barclays', 'Virgin', 'HSBC'].includes(bankName)) throw Error('Banca trebuie să fie Barclays, Virgin sau HSBC.');
  return { invoiceId, expectedVersion, operationId, amount, paymentDate, cardReference: amount > 0 ? requireText(input?.cardReference, 'Referința tranzacției card', 200) : '', ...(bankName === undefined ? {} : { bankName }) };
}
export function beginTransfer(vault: ProtectedRegistryVault, request: ProtectedTransferInput, today: string) {
  if (vault.invoices.some(row => row.id !== request.invoiceId && row.transfer?.operationId === request.operationId)) throw Error('Identificatorul transferului aparține altei facturi.');
  const invoice = vault.invoices.find(row => row.id === request.invoiceId);
  if (!invoice) throw Error('Factura nu există.');
  if (invoice.transfer) {
    if (JSON.stringify(invoice.transfer.request) !== JSON.stringify(request)) throw Error('Factura are deja o altă operațiune de transfer. Reîncarcă și reia operațiunea existentă.');
    return invoice;
  }
  if (request.amount > 0 && (!request.bankName || !['Barclays', 'Virgin', 'HSBC'].includes(request.bankName))) throw Error('Selectează banca încasării cu cardul.');
  const blocked = transferBlock(vault, invoice);
  if (blocked) throw Error(blocked);
  if (transferFingerprint(vault, invoice) !== request.expectedVersion) throw Error('Factura sau încasările s-au modificat. Reîncarcă rezumatul.');
  if (request.paymentDate < invoice.invoiceDate) throw Error('Încasarea nu poate preceda factura originală.');
  if (Math.round(request.amount * 100) > Math.round(invoice.totalAmount * 100) - Math.round(invoice.paidAmount * 100) - Math.round(transferCreditAmount(vault, invoice) * 100)) throw Error('Suma card depășește restul de plată.');
  const credits = transferableCredits(vault, invoice);
  invoice.transfer = { ...(credits.length ? { credits } : {}), operationId: request.operationId, request, invoiceDate: today, state: 'pending', paymentIds: vault.payments.filter(row => row.invoiceId === invoice.id && !row.reversedAt).map(row => row.id) };
  return invoice;
}
export function completeTransfer(vault: ProtectedRegistryVault, invoiceId: string, operationId: string, target: { invoiceId: number; invoiceNumber: string }) {
  const invoice = vault.invoices.find(row => row.id === invoiceId);
  if (!invoice?.transfer || invoice.transfer.operationId !== operationId) throw Error('Transferul nu a fost pregătit.');
  if (invoice.transfer.state === 'committed') {
    if (JSON.stringify(invoice.transfer.target) !== JSON.stringify(target)) throw Error('Destinația transferului diferă.');
    return;
  }
  const now = new Date().toISOString();
  invoice.transfer = { ...invoice.transfer, target, state: 'committed', completedAt: now };
  // Close the old allocation, not a refund. Legacy clients also exclude it.
  for (const id of invoice.transfer.paymentIds) {
    const payment = vault.payments.find(row => row.id === id)!;
    payment.transferredAt = now;
    payment.reversedAt = now;
    payment.reversalReason = 'Alocare închisă la transferul facturii în registrul normal';
  }
  for (const credit of invoice.transfer.credits || []) {
    const application = vault.creditApplications.find(row => row.id === credit.id)!;
    application.transferredAt = now;
    application.reversedAt = now;
    application.reversalReason = 'Credit păstrat pe factura din registrul normal';
    // Its source stays consumed: closing this allocation is not a refund.
  }
  invoice.status = 'cancelled';
  invoice.cancelledAt = now;
  invoice.cancellationReason = 'Transfer definitiv în registrul normal';
}
/** Every mutation passes this guard, including deferred writes and driver cash. */
export function assertTransfersUnchanged(before: ProtectedRegistryVault, after: ProtectedRegistryVault) {
  for (const invoice of before.invoices.filter(row => row.transfer)) {
    if (invoice.transfer?.state === 'pending' && (before.mode !== after.mode || JSON.stringify(before.assignments.filter(row => row.companyKey === invoice.companyKey)) !== JSON.stringify(after.assignments.filter(row => row.companyKey === invoice.companyKey)))) throw Error('Finalizează transferul înainte de schimbarea atribuirii sau a modului registrului.');
    const next = after.invoices.find(row => row.id === invoice.id);
    if (!next || transferFingerprint(before, invoice) !== transferFingerprint(after, next)) throw Error('Factura este blocată de transferul definitiv. Reia transferul sau folosește factura din registrul normal.');
  }
}
