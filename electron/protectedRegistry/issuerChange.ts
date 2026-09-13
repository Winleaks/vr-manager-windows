import { randomUUID } from 'node:crypto';
import type { InvoiceIssuerChangeInput } from '../../src/shared/invoiceIssuerChange.ts';
import { requireIsoDate, requirePositiveInteger, requireText } from '../database/businessValidation.ts';
import { isIssuerReady, issuerSnapshot, type BillingIssuerRow } from '../database/billingIssuers.ts';
import type { ProtectedRegistryVault, ProtectedInvoice } from './types.ts';

export function validateProtectedIssuerChange(input: InvoiceIssuerChangeInput<string>) {
  const request = {
    invoiceId: requireText(input.invoiceId, 'Factura', 100),
    expectedReference: requireText(input.expectedReference, 'Referința facturii', 100),
    targetIssuerId: requirePositiveInteger(input.targetIssuerId, 'Emitentul'),
    invoiceDate: requireIsoDate(input.invoiceDate, 'Data facturii'),
    reason: requireText(input.reason, 'Motivul', 500),
    operationId: requireText(input.operationId, 'Identificatorul operației', 100),
  };
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(request.operationId)) throw new Error('Identificatorul operației este invalid.');
  return request;
}

export function protectedIssuerChangeReplay(vault: ProtectedRegistryVault, request: InvoiceIssuerChangeInput<string>) {
  const invoice = vault.invoices.find((row) => row.operationId === request.operationId);
  if (!invoice) return undefined;
  if (JSON.stringify(invoice.issuerChangeRequest) !== JSON.stringify(request)) throw new Error('Identificatorul operației a fost utilizat cu alte date.');
  return invoice;
}

export function protectedIssuerChangeBlock(vault: ProtectedRegistryVault, source: ProtectedInvoice): string | null {
  if (source.replacedByInvoiceId) return 'Factura are deja o înlocuitoare.';
  if (source.status === 'cancelled') return 'Factura este anulată.';
  if (source.paidAmount > 0 || vault.payments.some((p) => p.invoiceId === source.id && !p.reversedAt)) return 'Factura are plăți înregistrate. Nu transferăm încasări între societăți.';
  if (source.creditedAmount > 0 || vault.creditNotes.some((n) => n.status === 'issued' && n.sourceInvoiceIds.includes(source.id))) return 'Factura are Credit Notes emise.';
  if (vault.creditApplications.some((a) => a.invoiceId === source.id && !a.reversedAt)) return 'Factura are credit aplicat.';
  return null;
}

/** Called only on a cloned vault inside the service's serialized encrypted mutation. */
export function applyProtectedIssuerChange(vault: ProtectedRegistryVault, request: InvoiceIssuerChangeInput<string>, issuer: BillingIssuerRow) {
  const replay = protectedIssuerChangeReplay(vault, request);
  if (replay) return replay;
  const source = vault.invoices.find((row) => row.id === request.invoiceId);
  if (!source) throw new Error('Factura nu există.');
  const block = protectedIssuerChangeBlock(vault, source);
  if (block) throw new Error(block);
  if (source.reference !== request.expectedReference) throw new Error('Identitatea facturii s-a schimbat. Redeschide factura.');
  if (issuer.id !== request.targetIssuerId || issuer.id === source.issuerId || !isIssuerReady(issuer) || (issuer.code !== 'goodness' && issuer.code !== 'vatra')) throw new Error('Alege un emitent diferit, activ și configurat complet.');
  if (!vault.assignments.some((a) => a.companyKey === source.companyKey)) throw new Error('Clientul nu mai este atribuit registrului separat.');
  const series = issuer.code === 'goodness' ? 'TGBL' : 'VRL';
  const sequence = vault.counters[series];
  if (!Number.isSafeInteger(sequence) || !Number.isSafeInteger(sequence + 1) || sequence < 1 || vault.invoices.some((i) => i.series === series && i.sequenceNumber === sequence)) throw new Error('Contorul emitentului nu este valid.');
  const now = new Date().toISOString();
  const replacement: ProtectedInvoice = {
    ...structuredClone(source), id: randomUUID(), operationId: request.operationId,
    issuerChangeRequest: request, reference: `${series}-${sequence}`, series, sequenceNumber: sequence,
    issuerId: issuer.id, issuerCode: issuer.code, issuerSnapshot: { ...issuerSnapshot(issuer) },
    invoiceDate: request.invoiceDate, status: 'unpaid', paidAmount: 0, creditedAmount: 0,
    items: source.items.map((item) => ({ ...item, id: randomUUID() })),
    createdAt: now, cancelledAt: null, cancellationReason: null,
    replacesInvoiceId: source.id, replacedByInvoiceId: null,
  };
  source.status = 'cancelled'; source.cancelledAt = now; source.cancellationReason = request.reason;
  source.replacedByInvoiceId = replacement.id;
  vault.counters[series] += 1;
  vault.invoices.push(replacement);
  vault.audit.push({ id: randomUUID(), eventType: 'protected_invoice_issuer_change_details', operationId: request.operationId,
    resourceType: 'invoice', resourceId: replacement.id, createdAt: now,
    details: { request, previousIssuerId: source.issuerId, sourceInvoiceId: source.id, replacementInvoiceId: replacement.id } });
  return replacement;
}
