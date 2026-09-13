export interface InvoiceIssuerChangeInput<Id = number> {
  invoiceId: Id;
  expectedReference: string;
  targetIssuerId: number;
  invoiceDate: string;
  reason: string;
  operationId: string;
}

export interface InvoiceIssuerChangeOptions {
  reference: string;
  issuerName: string;
  blockedReason: string | null;
  issuers: Array<{ id: number; name: string; series: string; nextNumber: number }>;
}
