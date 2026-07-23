import { ipcMain, dialog, BrowserWindow, shell, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { autoUpdater } from 'electron-updater';
import { db, backupDb, restoreDb, lastBackupTime } from '../database/db';
import { getCloudStatus, connectGoogleDrive, saveToCloud, restoreFromCloud, disconnectCloud, deletePdfFromCloud } from '../database/cloudSync';

export function registerSystemHandlers() {
  ipcMain.handle('system:getAppVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('save-file', async (event, options: { buffer: Uint8Array, defaultPath: string, filters: any[] }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        defaultPath: options.defaultPath,
        filters: options.filters
      });

      if (!canceled && filePath) {
        fs.writeFileSync(filePath, Buffer.from(options.buffer));
        return { success: true, filePath };
      }
      return { success: false, canceled: true };
    } catch (err: any) {
      console.error('Eroare la salvare fisier:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('save-pdf-auto', async (event, options: { buffer: Uint8Array, filename: string }) => {
    try {
      const documentsPath = app.getPath('documents');
      const facturiDir = path.join(documentsPath, 'Facturi Vatra Romaneasca');
      if (!fs.existsSync(facturiDir)) {
        fs.mkdirSync(facturiDir, { recursive: true });
      }
      const filePath = path.join(facturiDir, options.filename);
      fs.writeFileSync(filePath, Buffer.from(options.buffer));
      return { success: true, filePath };
    } catch (err: any) {
      console.error('Eroare salvare auto:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('open-pdf-file', async (_event, filename: string) => {
    try {
      const documentsPath = app.getPath('documents');
      const facturiDir = path.join(documentsPath, 'Facturi Vatra Romaneasca');
      const filePath = path.join(facturiDir, filename);

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

  ipcMain.handle('delete-pdf-auto', async (_event, filename: string) => {
    try {
      const documentsPath = app.getPath('documents');
      const facturiDir = path.join(documentsPath, 'Facturi Vatra Romaneasca');
      const filePath = path.join(facturiDir, filename);

      // 1. Ștergere de pe disk local
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // 2. Ștergere de pe Google Drive
      await deletePdfFromCloud(filename);

      return { success: true };
    } catch (err: any) {
      console.error('Eroare la ștergerea fișierului PDF:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('manual-backup', async (event) => {
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
      await db.backup(result.filePath);
      return { success: true, path: result.filePath };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('restore-backup', async (event) => {
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
    const ok = restoreDb(filePath);
    return { success: ok };
  });

  ipcMain.handle('get-last-backup-time', () => {
    return lastBackupTime;
  });

  ipcMain.handle('check-for-updates', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return { success: true, result };
    } catch (err: any) {
      return { success: false, error: err.message || err.toString() };
    }
  });

  ipcMain.handle('start-update-download', () => {
    autoUpdater.downloadUpdate();
    return { success: true };
  });

  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
  });

  ipcMain.handle('get-cloud-status', async () => {
    return await getCloudStatus();
  });

  ipcMain.handle('connect-google-drive', async () => {
    return await connectGoogleDrive();
  });

  ipcMain.handle('save-to-cloud', async () => {
    return await saveToCloud(false);
  });

  ipcMain.handle('restore-from-cloud', async (_event, fileId?: string) => {
    return await restoreFromCloud(fileId);
  });

  ipcMain.handle('disconnect-cloud', async () => {
    return await disconnectCloud();
  });

  ipcMain.handle('upload-pdf-to-cloud', async (_event, filename: string, buffer: Uint8Array) => {
    const { uploadPdfToCloud } = require('../database/cloudSync');
    return await uploadPdfToCloud(filename, buffer);
  });

  ipcMain.handle('get-sync-status', () => {
    const { getSyncStatus } = require('../database/realtimeSync');
    return getSyncStatus();
  });

  ipcMain.handle('init-realtime-sync', async () => {
    const { initRealtimeSync } = require('../database/realtimeSync');
    await initRealtimeSync();
    return true;
  });
}

