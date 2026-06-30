import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import { db } from '../database/db';

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
    const dateStr = new Date().toISOString().slice(0, 10);
    
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(win!, {
        defaultPath: `backup_stoc_${dateStr}.db`,
        title: 'Salvează Backup Bază de Date',
        filters: [{ name: 'Bază de Date SQLite', extensions: ['db', 'sqlite'] }]
      });

      if (!canceled && filePath) {
        await db.backup(filePath);
        return { success: true, filePath };
      }
      return { success: false, canceled: true };
    } catch (err: any) {
      console.error('Eroare la creare backup:', err);
      return { success: false, error: err.message };
    }
  });
}
