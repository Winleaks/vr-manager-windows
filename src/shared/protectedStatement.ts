import type { ProtectedInvoice, ProtectedIssuerCode } from '../../electron/protectedRegistry/types.ts';

export interface ProtectedStatementInput {
  companyKey: string;
  issuerCode: ProtectedIssuerCode;
  storeInvoiceId: string | null;
  from: string;
  to: string;
  action: 'open' | 'print' | 'share';
}

// Use identity, never the display name: two stores can have the same name.
export function statementStoreKey(invoice: Pick<ProtectedInvoice, 'id' | 'storeExternalId' | 'storeId'>) {
  return invoice.storeExternalId ? `external:${invoice.storeExternalId}`
    : invoice.storeId != null ? `local:${invoice.storeId}` : `invoice:${invoice.id}`;
}
