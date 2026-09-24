export interface DeletePaymentInput {
  id: number;
  reason: string;
  operationId: string;
  expectedRevision: number;
  expectedAmount: number;
}
