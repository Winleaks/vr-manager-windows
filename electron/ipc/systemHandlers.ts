import { dialog, BrowserWindow, shell, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { createVerifiedSnapshot, restoreDb, lastBackupTime } from '../database/db';
import { getCloudStatus, connectGoogleDrive, saveToCloud, restoreFromCloud, disconnectCloud, syncViewerFromCloud } from '../database/cloudSync';
import { handleTrustedIpc } from './trustedHandler';
import { getDeviceRole, getDeviceState, setDeviceRole, type DeviceRole } from '../device/deviceRole';
import {
  resolvePdfPath,
  toBoundedBuffer,
  toValidatedPdfBuffer,
  validateCloudFileId,
  validatePdfFilename,
} from '../security/fileValidation';
import { checkForUpdates, downloadUpdate, getUpdateState, installUpdate } from '../updater/updateCoordinator';
import * as billingRepo from '../database/repositories/billingRepo';
import { localClientDocumentDirectory } from '../reports/clientDocumentStorage';
import { openWindowsShareSheet } from '../reports/windowsShare';
import { pathToFileURL } from 'node:url';

async function createAndSaveCloudSnapshot(isAutomatic = false) {
  const snapshotPath = path.join(app.getPath('temp'), `vr-hub-management-cloud-${randomUUID()}.db`);
  try {
    await createVerifiedSnapshot(snapshotPath);
    return await saveToCloud(isAutomatic, snapshotPath);
  } catch {
    return { success: false, error: 'Snapshotul pentru cloud nu a putut fi creat sau verificat.' };
  } finally {
    try { if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath); } catch {}
  }
}

export function registerSystemHandlers() {
  handleTrustedIpc('system:getAppVersion', () => {
    return app.getVersion();
  });

  handleTrustedIpc('save-file', async (event, options: { buffer: Uint8Array, defaultPath: string, filters: any[] }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        defaultPath: options.defaultPath,
        filters: options.filters
      });

      if (!canceled && filePath) {
        fs.writeFileSync(filePath, toBoundedBuffer(options.buffer));
        return { success: true, filePath };
      }
      return { success: false, canceled: true };
    } catch (err: any) {
      console.error('Eroare la salvare fisier:', err);
      return { success: false, error: err.message };
    }
  });

  const invoiceDocumentIdentity = (invoiceId: number) => {
    const invoice = billingRepo.getInvoiceById(invoiceId) as any;
    return {
      filename: validatePdfFilename(`Factura_${invoice.invoice_number}.pdf`),
      companyName: invoice.company_name,
      status: invoice.status,
      issuerCode: typeof invoice.issuer_code === 'string' && /^[a-z0-9-]{1,40}$/i.test(invoice.issuer_code)
        ? invoice.issuer_code.toLowerCase()
        : 'goodness',
    };
  };

  const resolveInvoicePdfFile = (invoiceId: number) => {
    const documentsPath = app.getPath('documents');
    const identity = invoiceDocumentIdentity(invoiceId);
    if (identity.status === 'cancelled') throw new Error('O factură anulată nu poate fi trimisă sau printată.');
    const facturiDir = localClientDocumentDirectory(documentsPath, identity.companyName, 'Facturi');
    const primaryPath = resolvePdfPath(facturiDir, identity.filename);
    const candidates = [
      primaryPath,
      resolvePdfPath(path.join(documentsPath, 'VR - Hub Management', 'Invoices', identity.issuerCode), identity.filename),
      resolvePdfPath(path.join(documentsPath, 'Facturi Vatra Romaneasca'), identity.filename),
    ];
    const filePath = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    return { identity, filePath, primaryPath };
  };

  const printInvoicePdf = async (filePath: string, parent: BrowserWindow | null) => {
    if (process.platform !== 'win32') {
      return { success: false, unsupported: true, error: 'Printarea directă este disponibilă doar în aplicația Windows.' };
    }
    const printWindow = new BrowserWindow({
      show: false,
      parent: parent || undefined,
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    printWindow.setMenu(null);
    try {
      await printWindow.loadURL(pathToFileURL(filePath).toString());
      return await new Promise<{ success: boolean; canceled?: boolean; error?: string }>((resolve) => {
        let settled = false;
        const finish = (result: { success: boolean; canceled?: boolean; error?: string }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (!printWindow.isDestroyed()) printWindow.destroy();
          resolve(result);
        };
        const timeout = setTimeout(
          () => finish({ success: false, error: 'Dialogul de printare nu a răspuns la timp.' }),
          60_000,
        );
        printWindow.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
          if (success) finish({ success: true });
          else if (/cancel/i.test(failureReason || '')) finish({ success: false, canceled: true });
          else finish({ success: false, error: failureReason || 'Factura nu a putut fi printată.' });
        });
      });
    } catch (error) {
      if (!printWindow.isDestroyed()) printWindow.destroy();
      return { success: false, error: error instanceof Error ? error.message : 'Factura nu a putut fi încărcată pentru printare.' };
    }
  };

  handleTrustedIpc('save-pdf-auto', async (_event, options: { buffer: Uint8Array, invoiceId: number }) => {
    try {
      const identity = invoiceDocumentIdentity(options.invoiceId);
      const facturiDir = localClientDocumentDirectory(app.getPath('documents'), identity.companyName, 'Facturi');
      if (!fs.existsSync(facturiDir)) {
        fs.mkdirSync(facturiDir, { recursive: true });
      }
      const filePath = resolvePdfPath(facturiDir, identity.filename);
      const temporaryPath = path.join(facturiDir, `.invoice-${randomUUID()}.tmp`);
      const previousPath = path.join(facturiDir, `.invoice-${randomUUID()}.previous`);
      let previousMoved = false;
      try {
        fs.writeFileSync(temporaryPath, toValidatedPdfBuffer(options.buffer));
        if (fs.existsSync(filePath)) {
          fs.renameSync(filePath, previousPath);
          previousMoved = true;
        }
        fs.renameSync(temporaryPath, filePath);
        if (previousMoved) fs.unlinkSync(previousPath);
        previousMoved = false;
      } catch (error) {
        if (!fs.existsSync(filePath) && previousMoved && fs.existsSync(previousPath)) fs.renameSync(previousPath, filePath);
        throw error;
      } finally {
        try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch {}
        try { if (fs.existsSync(previousPath)) fs.unlinkSync(previousPath); } catch {}
      }
      const legacyPath = resolvePdfPath(
        path.join(app.getPath('documents'), 'VR - Hub Management', 'Invoices', identity.issuerCode),
        identity.filename,
      );
      if (legacyPath !== filePath && fs.existsSync(legacyPath)) {
        try { fs.unlinkSync(legacyPath); } catch (error) { console.error('Legacy invoice PDF cleanup failed:', error); }
      }
      return { success: true, filePath };
    } catch (err: any) {
      console.error('Eroare salvare auto:', err);
      return { success: false, error: err.message };
    }
  });

  handleTrustedIpc('open-pdf-file', async (_event, invoiceId: number) => {
    try {
      const documentsPath = app.getPath('documents');
      const identity = invoiceDocumentIdentity(invoiceId);
      const facturiDir = localClientDocumentDirectory(documentsPath, identity.companyName, 'Facturi');
      const filePath = resolvePdfPath(facturiDir, identity.filename);

      if (fs.existsSync(filePath)) {
        await shell.openPath(filePath);
        return { success: true, filePath };
      }
      const legacyDirectories = [
        path.join(documentsPath, 'VR - Hub Management', 'Invoices', identity.issuerCode),
        path.join(documentsPath, 'Facturi Vatra Romaneasca'),
      ];
      for (const directory of legacyDirectories) {
        const legacyPath = resolvePdfPath(directory, identity.filename);
        if (fs.existsSync(legacyPath)) {
          await shell.openPath(legacyPath);
          return { success: true, filePath: legacyPath, legacy: true };
        }
      }
      return { success: false, notFound: true, filePath };
    } catch (err: any) {
      console.error('Eroare la deschiderea PDF-ului:', err);
      return { success: false, error: err.message };
    }
  });

  handleTrustedIpc('share-invoice-pdf', async (_event, invoiceId: number) => {
    try {
      const document = resolveInvoicePdfFile(invoiceId);
      if (!document.filePath) return { success: false, notFound: true, error: 'PDF-ul facturii nu a fost găsit.' };
      if (process.platform !== 'win32') return { success: false, unsupported: true, error: 'Trimiterea este disponibilă doar în aplicația Windows.' };
      const opened = await openWindowsShareSheet(document.filePath);
      return opened
        ? { success: true, filePath: document.filePath }
        : { success: false, error: 'Windows Share nu a putut fi deschis.' };
    } catch (error) {
      console.error('Invoice share failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Factura nu a putut fi trimisă.' };
    }
  });

  handleTrustedIpc('print-invoice-pdf', async (event, invoiceId: number) => {
    try {
      const document = resolveInvoicePdfFile(invoiceId);
      if (!document.filePath) return { success: false, notFound: true, error: 'PDF-ul facturii nu a fost găsit.' };
      return await printInvoicePdf(document.filePath, BrowserWindow.fromWebContents(event.sender));
    } catch (error) {
      console.error('Invoice print failed:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Factura nu a putut fi printată.' };
    }
  });

  handleTrustedIpc('manual-backup', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { success: false };

    const result = await dialog.showSaveDialog(win, {
      title: 'Salvează Backup Bază de Date',
      defaultPath: `backup_stoc_${new Date().toISOString().slice(0,10)}.db`,
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite'] }]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    try {
      await createVerifiedSnapshot(result.filePath);
      return { success: true, path: result.filePath };
    } catch (e: any) {
      console.error('Manual backup failed:', e);
      return { success: false, error: 'Backupul nu a putut fi creat sau verificat.' };
    }
  });

  handleTrustedIpc('restore-backup', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { success: false };

    const result = await dialog.showOpenDialog(win, {
      title: 'Alege Fișierul Backup',
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite'] }],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const filePath = result.filePaths[0];
    const ok = await restoreDb(filePath);
    return { success: ok };
  });

  handleTrustedIpc('get-last-backup-time', () => {
    return lastBackupTime;
  });

  handleTrustedIpc('check-for-updates', async () => {
    const state = await checkForUpdates();
    return { success: state.status !== 'error', state, error: state.error };
  });

  handleTrustedIpc('get-update-state', () => getUpdateState());

  handleTrustedIpc('start-update-download', async () => {
    await downloadUpdate();
    return { success: true };
  });

  handleTrustedIpc('install-update', () => {
    installUpdate();
    return { success: true };
  });

  handleTrustedIpc('get-cloud-status', async () => {
    return await getCloudStatus();
  });

  handleTrustedIpc('connect-google-drive', async (event) => {
    const result = await connectGoogleDrive();
    if (!result.success) return result;
    if (getDeviceRole() === 'writer') {
      const initialSync = await createAndSaveCloudSnapshot(false);
      return { ...result, initialSync };
    }
    if (getDeviceRole() === 'viewer') {
      const syncResult = await syncViewerFromCloud();
      if (syncResult.updated) event.sender.send('database-replica-updated', syncResult);
      return { ...result, viewerSync: syncResult };
    }
    return result;
  });

  handleTrustedIpc('save-to-cloud', async () => {
    return await createAndSaveCloudSnapshot(false);
  });

  handleTrustedIpc('restore-from-cloud', async (_event, fileId?: string) => {
    return await restoreFromCloud(validateCloudFileId(fileId));
  });

  handleTrustedIpc('disconnect-cloud', async () => {
    return await disconnectCloud();
  });

  handleTrustedIpc('upload-pdf-to-cloud', async (_event, invoiceId: number, buffer: Uint8Array) => {
    const { uploadPdfToCloud } = require('../database/cloudSync');
    const identity = invoiceDocumentIdentity(invoiceId);
    return await uploadPdfToCloud(identity.filename, identity.companyName, toValidatedPdfBuffer(buffer));
  });

  handleTrustedIpc('get-device-role', () => {
    return getDeviceState();
  });

  handleTrustedIpc('set-device-role', (_event, role: DeviceRole) => {
    return setDeviceRole(role);
  });

  handleTrustedIpc('sync-viewer-now', async (event) => {
    const result = await syncViewerFromCloud();
    if (result.updated) event.sender.send('database-replica-updated', result);
    return result;
  });

  handleTrustedIpc('get-sync-status', async () => {
    const state = getDeviceState();
    const cloud = await getCloudStatus();
    return {
      active: cloud.syncHealth === 'healthy',
      connected: cloud.isConnected,
      connectionHealthy: cloud.connectionHealthy,
      syncHealth: cloud.syncHealth,
      lastError: cloud.lastError,
      rootFolderName: cloud.rootFolderName,
      role: state.role,
      lastSync: state.role === 'viewer' ? state.lastRemoteModifiedTime || null : cloud.lastCloudBackup,
      message: cloud.syncHealth === 'healthy'
        ? state.role === 'viewer' ? 'Viewer actualizat din Google Drive' : 'Writer sincronizat cu Google Drive'
        : cloud.lastError || (cloud.isConnected ? 'Copia Google Drive nu este la zi' : 'Google Drive neconectat'),
    };
  });
}
