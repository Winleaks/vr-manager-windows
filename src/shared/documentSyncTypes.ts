export type DocumentSyncStatus = {
  pending: number | null; blocked: number | null; running: boolean; workerError: string | null; canRetry: boolean; connected: boolean;
  verificationPending: boolean; statusMessage: string | null;
  items: Array<{ kind: 'invoice' | 'credit_note'; document_id: number; state: string; attempts: number; last_error: string | null; reference: string }>;
};
