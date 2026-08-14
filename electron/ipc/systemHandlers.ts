import { dialog, BrowserWindow, shell, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { createVerifiedSnapshot, restoreDb, lastBackupTime } from '../database/db';
import { getCloudStatus, connectGoogleDrive, saveToCloud, restoreFromCloud, disconnectCloud, deletePdfFromCloud, syncViewerFromCloud } from '../database/cloudSync';
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

  handleTrustedIpc('save-pdf-auto', async (event, options: { buffer: Uint8Array, filename: string }) => {
    try {
      const documentsPath = app.getPath('documents');
      const facturiDir = path.join(documentsPath, 'Facturi Vatra Romaneasca');
      if (!fs.existsSync(facturiDir)) {
        fs.mkdirSync(facturiDir, { recursive: true });
      }
      const filePath = resolvePdfPath(facturiDir, options.filename);
      fs.writeFileSync(filePath, toValidatedPdfBuffer(options.buffer));
      return { success: true, filePath };
    } catch (err: any) {
      console.error('Eroare salvare auto:', err);
      return { success: false, error: err.message };
    }
  });

  handleTrustedIpc('open-pdf-file', async (_event, filename: string) => {
    try {
      const documentsPath = app.getPath('documents');
      const facturiDir = path.join(documentsPath, 'Facturi Vatra Romaneasca');
      const filePath = resolvePdfPath(facturiDir, filename);

      if (fs.existsSync(filePath)) {
        await shell.openPath(filePath);
        return { success: true, filePath };
      }
      return { success: false, notFound: true, filePath };
    } catch (err: any) {
      console.error('Eroare la deschiderea PDF-ului:', err);
      return { success: false, error: err.message };
    }
  });

  handleTrustedIpc('delete-pdf-auto', async (_event, filename: string) => {
    try {
      const documentsPath = app.getPath('documents');
      const facturiDir = path.join(documentsPath, 'Facturi Vatra Romaneasca');
      const safeFilename = validatePdfFilename(filename);
      const filePath = resolvePdfPath(facturiDir, safeFilename);

      // 1. Ștergere de pe disk local
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // 2. Ștergere de pe Google Drive
      await deletePdfFromCloud(safeFilename);

      return { success: true };
    } catch (err: any) {
      console.error('Eroare la ștergerea fișierului PDF:', err);
      return { success: false, error: err.message };
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
    if (result.success && getDeviceRole() === 'viewer') {
      const syncResult = await syncViewerFromCloud();
      if (syncResult.updated) event.sender.send('database-replica-updated', syncResult);
    }
    return result;
  });

  handleTrustedIpc('save-to-cloud', async () => {
    const snapshotPath = path.join(app.getPath('temp'), `vr-hub-management-cloud-${randomUUID()}.db`);
    try {
      await createVerifiedSnapshot(snapshotPath);
      return await saveToCloud(false, snapshotPath);
    } catch (error) {
      console.error('Manual cloud snapshot failed:', error);
      return { success: false, error: 'Snapshotul pentru cloud nu a putut fi creat sau verificat.' };
    } finally {
      try { if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath); } catch {}
    }
  });

  handleTrustedIpc('restore-from-cloud', async (_event, fileId?: string) => {
    return await restoreFromCloud(validateCloudFileId(fileId));
  });

  handleTrustedIpc('disconnect-cloud', async () => {
    return await disconnectCloud();
  });

  handleTrustedIpc('upload-pdf-to-cloud', async (_event, filename: string, buffer: Uint8Array) => {
    const { uploadPdfToCloud } = require('../database/cloudSync');
    return await uploadPdfToCloud(validatePdfFilename(filename), toValidatedPdfBuffer(buffer));
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
      active: cloud.isConnected,
      role: state.role,
      lastSync: state.role === 'viewer' ? state.lastRemoteModifiedTime || null : cloud.lastCloudBackup,
      message: cloud.isConnected
        ? state.role === 'viewer' ? 'Viewer conectat la Google Drive' : 'Writer conectat la Google Drive'
        : 'Google Drive neconectat',
    };
  });
}
