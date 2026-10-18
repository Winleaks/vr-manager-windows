export interface UpdatePaymentInput {
  id: number;
  amount: number;
  method: 'cash' | 'transfer' | 'card';
  bankName?: string;
  paymentDate?: string;
  reason: string;
  operationId: string;
  expectedRevision: number;
}
