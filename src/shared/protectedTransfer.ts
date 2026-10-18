export interface ProtectedTransferInput {
  invoiceId: string;
  expectedVersion: string;
  amount: number;
  paymentDate: string;
  cardReference: string;
  /** Optional only for operations persisted before bank selection was added. */
  bankName?: 'Barclays' | 'Virgin' | 'HSBC';
  operationId: string;
}
export interface ProtectedTransferResult {
  success: true;
  invoiceId: number;
  invoiceNumber: string;
}
