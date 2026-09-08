import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { db, waitForDatabaseReady } from '../database/db';
import { getDeviceRole } from '../device/deviceRole';
import { documentSyncStatus, dueDocuments, retryDocumentSync, trackDocumentUpload } from '../database/documentSyncQueue';
import { isDocumentDriveConnected, uploadInvoicePdf, uploadCreditNotePdfToCloud, cleanupPublishedInvoiceCopies } from '../database/cloudSync';
import { readCreditNote, setCreditNotePdfState } from '../database/repositories/billingRepo';
import { generateCreditNotePdf } from '../reports/creditNotePdf';
import { saveCreditNotePdf } from '../reports/creditNoteDelivery';
import { withInvoiceDriveLock } from './invoiceDriveDocument';
import { invoiceCopyCleanupError, retryInvoiceCopyCleanup } from '../database/invoiceDriveIdentity';

let running = false;
let workerError: string | null = null;

export function getDocumentSyncStatus() {
  return { ...documentSyncStatus(db), running, workerError:workerError||invoiceCopyCleanupError(db),
    canRetry: getDeviceRole() === 'writer', connected: Boolean(isDocumentDriveConnected()) };
}

export async function syncCreditNoteDocument(id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Credit Note invalid.');
  const connection = db;
  // Negative keys keep credits separate from positive invoice IDs and serialize
  // manual/background calls through the same lock.
  return withInvoiceDriveLock(-id, async () => {
    let saved: ReturnType<typeof saveCreditNotePdf> | undefined;
    const result = await trackDocumentUpload(connection,'credit_note',id,
      () => getDeviceRole() === 'writer' && connection === db && connection.open, async () => {
        const note = readCreditNote(id);
        const assertCurrent = () => {
          if (getDeviceRole() !== 'writer' || connection !== db || readCreditNote(id).status !== note.status) throw new Error('Documentul sau calculatorul Writer s-a schimbat.');
        };
        const pdf = generateCreditNotePdf(note);
        saved = saveCreditNotePdf(app.getPath('documents'),note.company_name,note.reference,pdf);
        const legacyPath=path.join(app.getPath('documents'),'VR - Hub Management','Credit Notes',String(note.issuer_code).toLowerCase(),saved.filename);
        if (legacyPath !== saved.filePath && fs.existsSync(legacyPath)) {
          try { fs.unlinkSync(legacyPath); } catch { /* Keep a locked legacy local copy. */ }
        }
        setCreditNotePdfState(id,saved.filePath,'ready','pending');
        const cloud = await uploadCreditNotePdfToCloud(saved.filename,note.company_name,note.issuer_code,pdf,assertCurrent);
        assertCurrent();
        setCreditNotePdfState(id,saved.filePath,'ready',cloud.success ? 'ready' : 'error');
        return cloud;
      });
    // The existing IPC distinguishes a valid local file from its cloud status.
    return { success: Boolean(saved), ...saved, message: saved ? undefined : result.error, cloud: result };
  });
}

export async function syncPendingDocuments() {
  if (running || getDeviceRole() !== 'writer') return;
  running = true;
  try {
    await waitForDatabaseReady();
    if (getDeviceRole() !== 'writer' || !isDocumentDriveConnected()) return;
    const connection = db;
    workerError = null;
    for (const item of dueDocuments(connection)) {
      if (getDeviceRole() !== 'writer' || connection !== db || !connection.open || !isDocumentDriveConnected()) return;
      // A manual upload may have completed since selection. Do not regenerate it.
      const pending = connection.prepare("SELECT 1 FROM document_sync_queue WHERE kind=? AND document_id=? AND generation=? AND state='pending'").get(item.kind,item.document_id,item.generation);
      if (!pending) continue;
      if (item.kind === 'invoice') await uploadInvoicePdf(item.document_id);
      else await syncCreditNoteDocument(item.document_id);
    }
    if(getDeviceRole()==='writer' && connection===db && connection.open) await cleanupPublishedInvoiceCopies();
  } catch {
    workerError = 'Sincronizarea documentelor nu s-a finalizat. Documentele rămân în așteptare; reîncearcă din acest panou.';
  } finally { running = false; }
}

export function retryPendingDocuments() {
  if (getDeviceRole() !== 'writer') throw new Error('Doar Writer poate relua încărcările.');
  retryDocumentSync(db);
  retryInvoiceCopyCleanup(db);
  workerError = null;
  void syncPendingDocuments();
  return getDocumentSyncStatus();
}

export function startDocumentSync() {
  void syncPendingDocuments();
  const timer = setInterval(() => void syncPendingDocuments(), 30_000);
  timer.unref();
  app.once('before-quit', () => clearInterval(timer));
}
