import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import { autoUpdater } from 'electron-updater';
import { db, backupDb, restoreDb, lastBackupTime } from '../database/db';
import { getCloudStatus, setCloudFolderPath, saveToCloud, restoreFromCloud } from '../database/cloudSync';

export function registerSystemHandlers() {
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

  ipcMain.handle('get-cloud-status', () => {
    return getCloudStatus();
  });

  ipcMain.handle('select-cloud-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { success: false };

    const result = await dialog.showOpenDialog(win, {
      title: 'Alege folderul sincronizat din Cloud (Google Drive, OneDrive sau Dropbox)',
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const folderPath = result.filePaths[0];
    const ok = setCloudFolderPath(folderPath);
    if (ok) {
      try {
        await saveToCloud(true);
      } catch (e) {}
    }
    return { success: ok, folderPath };
  });

  ipcMain.handle('save-to-cloud', async () => {
    return await saveToCloud(false);
  });

  ipcMain.handle('restore-from-cloud', async (_event, filePath?: string) => {
    return restoreFromCloud(filePath);
  });

  ipcMain.handle('disconnect-cloud', () => {
    const ok = setCloudFolderPath(null);
    return { success: ok };
  });
}

