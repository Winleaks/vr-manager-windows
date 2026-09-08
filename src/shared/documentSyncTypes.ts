export type DocumentSyncStatus = {
  pending: number; blocked: number; running: boolean; workerError: string | null; canRetry: boolean; connected: boolean;
  items: Array<{ kind: 'invoice' | 'credit_note'; document_id: number; state: string; attempts: number; last_error: string | null; reference: string }>;
};
