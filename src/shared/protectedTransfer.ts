export interface ProtectedTransferInput {
  invoiceId: string;
  expectedVersion: string;
  amount: number;
  paymentDate: string;
  cardReference: string;
  operationId: string;
}
export interface ProtectedTransferResult {
  success: true;
  invoiceId: number;
  invoiceNumber: string;
}
