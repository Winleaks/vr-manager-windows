import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import { db, backupDb, restoreDb, lastBackupTime } from '../database/db';

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
}
