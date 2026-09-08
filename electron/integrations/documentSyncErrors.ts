import { InvoiceDriveDocumentError } from './invoiceDriveDocument.ts';

export function documentSyncFailure(error: unknown) {
  const e = error as { response?: { status?: number; data?: { error?: { errors?: Array<{reason?: string}> } | string } }; code?: unknown; errors?: Array<{reason?: string}>; message?: string };
  const status = Number(e?.response?.status || e?.code || 0);
  const apiError = e?.response?.data?.error;
  const reason = e?.errors?.[0]?.reason || (typeof apiError === 'object' ? apiError?.errors?.[0]?.reason : '');
  const message = e?.message || '';
  if (error instanceof InvoiceDriveDocumentError) return { success: false as const, retryable: /s-a modificat|s-a schimbat/.test(message), error: message.slice(0,400) };
  if (status === 401 || /invalid_grant|invalid_token|no refresh token/i.test(message)) return { success: false as const, retryable: false, error: 'Autorizarea Drive a expirat. Reconectează contul din Setări, apoi reîncearcă documentele.' };
  if (status === 429 || ['rateLimitExceeded','userRateLimitExceeded'].includes(reason || '')) return { success: false as const, retryable: true, error: 'Drive limitează temporar încărcările. Reîncercare automată.' };
  if (status === 403) return { success: false as const, retryable: false, error: 'Drive refuză accesul la documente. Verifică permisiunile folderului și contul conectat.' };
  if (status === 404) return { success: false as const, retryable: false, error: 'Folderul sau documentul configurat nu este accesibil în Drive. Verifică folderul înainte să reîncerci.' };
  // Only application-owned messages; never persist provider payloads/paths/tokens.
  if (/^(Folderul de facturi|Folderele clientului|Selectează explicit|Există mai multe PDF-uri|Identitatea folderului|Destinația nu este|Structura folderelor|PDF-ul a fost mutat|Factura s-a modificat|Calculatorul Writer|PDF-ul facturii nu este|Fișierul existent al facturii)/.test(message)) {
    return { success: false as const, retryable: /s-a modificat|s-a schimbat/.test(message), error: message.slice(0,400) };
  }
  return { success: false as const, retryable: !(status >= 400 && status < 500), error: 'PDF-ul nu a fost confirmat în Drive. Încărcarea rămâne în așteptare; verifică conexiunea.' };
}
