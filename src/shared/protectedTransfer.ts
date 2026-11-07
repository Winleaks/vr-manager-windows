export interface ProtectedTransferInput {
  invoiceId: string;
  expectedVersion: string;
  /** Zero transfers the invoice without recording a new payment. */
  amount: number;
  paymentDate: string;
  cardReference: string;
  /** Required for a new card payment; omitted for transfer-only and legacy persisted operations. */
  bankName?: 'Barclays' | 'Virgin' | 'HSBC';
  operationId: string;
}
export interface ProtectedTransferResult {
  success: true;
  invoiceId: number;
  invoiceNumber: string;
}
