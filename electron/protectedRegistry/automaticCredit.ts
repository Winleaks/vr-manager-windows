import { randomUUID } from 'node:crypto';
import type { ProtectedInvoice, ProtectedRegistryVault, ProtectedCreditApplication } from './types.ts';

const reason = 'Automatic credit applied on invoice issuance';

/** Operates only on the candidate vault, inside the atomic issuance mutation. */
export function applyAutomaticProtectedCredit(vault: ProtectedRegistryVault, invoice: ProtectedInvoice) {
  if (invoice.status === 'cancelled') throw new Error('Factura anulată nu este eligibilă.');
  if (vault.creditApplications.some((row) => row.invoiceId === invoice.id && row.reason === reason)) return null;
  const applied = vault.creditApplications.filter((row) => row.invoiceId === invoice.id && !row.reversedAt)
    .reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
  const outstanding = Math.max(0, Math.round(invoice.totalAmount * 100) - Math.round(invoice.paidAmount * 100) - Math.round(invoice.creditedAmount * 100) - applied);
  const sources = vault.creditEntries.filter((row) => row.companyKey === invoice.companyKey && row.issuerCode === invoice.issuerCode && row.testEntry === invoice.testDocument && row.availableAmount > 0.005)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const amount = Math.min(outstanding, sources.reduce((sum, row) => sum + Math.round(row.availableAmount * 100), 0));
  if (amount <= 0) return null;
  let remaining = amount;
  const allocations: ProtectedCreditApplication['allocations'] = [];
  for (const source of sources) {
    if (!remaining) break;
    const balance = Math.round(source.availableAmount * 100);
    const used = Math.min(balance, remaining);
    source.availableAmount = (balance - used) / 100;
    allocations.push({ creditEntryId: source.id, amount: used / 100 });
    remaining -= used;
  }
  const application: ProtectedCreditApplication = {
    id: randomUUID(), operationId: invoice.operationId, invoiceId: invoice.id,
    companyKey: invoice.companyKey, issuerCode: invoice.issuerCode,
    amount: amount / 100, allocations, reason, createdAt: new Date().toISOString(),
    reversedAt: null, reversalReason: null, testEntry: invoice.testDocument,
  };
  vault.creditApplications.push(application);
  invoice.status = amount >= outstanding ? 'paid' : 'partial';
  vault.audit.push({ id: randomUUID(), operationId: invoice.operationId, eventType: 'protected_credit_automatically_applied', createdAt: application.createdAt, resourceType: 'invoice', resourceId: invoice.id, details: { applicationId: application.id, amount: application.amount, allocations } });
  return application;
}
