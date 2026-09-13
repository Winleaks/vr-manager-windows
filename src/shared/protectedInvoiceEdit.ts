export interface ProtectedInvoiceEditInput {
  invoiceId: string;
  expectedVersion: string;
  operationId: string;
  invoiceDate: string;
  items: Array<{ id?: string; productId?: number; quantity: number; unitPrice: number; productName?: string; remove?: boolean }>;
}
