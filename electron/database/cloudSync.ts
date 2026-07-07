import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { db, dbPath, evaluateDb, restoreDb } from './db';

const isDev = !app.isPackaged;
const baseDir = isDev ? process.cwd() : app.getPath('userData');
const configFilePath = path.join(baseDir, 'cloud_sync_config.json');

export interface CloudSyncStatus {
  isConnected: boolean;
  folderPath: string | null;
  lastCloudBackup: string | null;
  availableBackups: Array<{
    filePath: string;
    fileName: string;
    mtime: number;
    formattedTime: string;
    totalItems: number;
  }>;
}

export function getCloudFolderPath(): string | null {
  try {
    if (fs.existsSync(configFilePath)) {
      const data = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
      if (data.folderPath && fs.existsSync(data.folderPath)) {
        return data.folderPath;
      }
    }
  } catch (e) {
    console.error('Error reading cloud sync config:', e);
  }
  return null;
}

export function setCloudFolderPath(folderPath: string | null): boolean {
  try {
    if (folderPath && !fs.existsSync(folderPath)) {
      return false;
    }
    const currentData = fs.existsSync(configFilePath)
      ? JSON.parse(fs.readFileSync(configFilePath, 'utf-8'))
      : {};
    
    const newData = {
      ...currentData,
      folderPath: folderPath || null
    };
    
    fs.writeFileSync(configFilePath, JSON.stringify(newData, null, 2), 'utf-8');
    
    // Also store path inside app_settings if db is open
    try {
      if (db.open) {
        if (folderPath) {
          db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('cloud_sync_folder', folderPath);
        } else {
          db.prepare('DELETE FROM app_settings WHERE key = ?').run('cloud_sync_folder');
        }
      }
    } catch (dbErr) {
      console.warn('Could not save cloud folder to app_settings:', dbErr);
    }

    return true;
  } catch (e) {
    console.error('Error saving cloud sync config:', e);
    return false;
  }
}

export function getCloudTargetDirectory(): string | null {
  const root = getCloudFolderPath();
  if (!root) return null;
  const targetDir = path.join(root, 'VR_Hub_Cloud_Database');
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (e) {
      console.error('Error creating cloud target directory:', e);
      return root;
    }
  }
  return targetDir;
}

export async function saveToCloud(silent = false): Promise<{ success: boolean; path?: string; time?: string; error?: string }> {
  const targetDir = getCloudTargetDirectory();
  if (!targetDir) {
    return { success: false, error: 'Nu este configurat niciun folder Cloud.' };
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeFormatted = now.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }) + 
                        ' - ' + 
                        now.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });

  // Main cloud sync file (always overwritten with latest)
  const latestCloudPath = path.join(targetDir, 'bazadedate_cloud_latest.db');
  // Daily timestamped file
  const dailyCloudPath = path.join(targetDir, `backup_cloud_${dateStr}.db`);

  try {
    if (!db.open) {
      return { success: false, error: 'Baza de date nu este deschisă.' };
    }

    await db.backup(latestCloudPath);
    // Also make a copy for today's backup
    try {
      fs.copyFileSync(latestCloudPath, dailyCloudPath);
    } catch (e) {
      console.warn('Could not create daily cloud backup copy:', e);
    }

    // Save last cloud backup time
    try {
      const currentData = fs.existsSync(configFilePath)
        ? JSON.parse(fs.readFileSync(configFilePath, 'utf-8'))
        : {};
      currentData.lastCloudBackup = timeFormatted;
      fs.writeFileSync(configFilePath, JSON.stringify(currentData, null, 2), 'utf-8');
    } catch (e) {}

    if (!silent) {
      console.log(`[CLOUD SYNC] Backup salvat cu succes în cloud: ${latestCloudPath}`);
    }
    return { success: true, path: latestCloudPath, time: timeFormatted };
  } catch (err: any) {
    if (!silent) {
      console.error('[CLOUD SYNC ERROR] Eroare la salvarea în cloud:', err);
    }
    return { success: false, error: err.message || 'Eroare neașteptată la backup pe cloud.' };
  }
}

export function getAvailableCloudBackups() {
  const targetDir = getCloudTargetDirectory();
  if (!targetDir || !fs.existsSync(targetDir)) return [];

  const results: Array<{
    filePath: string;
    fileName: string;
    mtime: number;
    formattedTime: string;
    totalItems: number;
  }> = [];

  try {
    const files = fs.readdirSync(targetDir);
    for (const f of files) {
      if (f.endsWith('.db') || f.endsWith('.sqlite')) {
        const fullPath = path.join(targetDir, f);
        const info = evaluateDb(fullPath);
        if (info && info.totalItems > 0) {
          const date = new Date(info.mtime);
          const formatted = date.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
                            ' - ' +
                            date.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
          results.push({
            filePath: fullPath,
            fileName: f,
            mtime: info.mtime,
            formattedTime: formatted,
            totalItems: info.totalItems
          });
        }
      }
    }
  } catch (e) {
    console.error('Error reading cloud backups:', e);
  }

  results.sort((a, b) => b.mtime - a.mtime);
  return results;
}

export function restoreFromCloud(specificFilePath?: string): { success: boolean; error?: string; restoredFrom?: string; totalItems?: number } {
  try {
    let targetPath = specificFilePath;
    if (!targetPath) {
      const available = getAvailableCloudBackups();
      if (available.length === 0) {
        return { success: false, error: 'Nu s-a găsit niciun backup valid în folderul Cloud.' };
      }
      // Sort by totalItems and mtime to pick best
      available.sort((a, b) => b.totalItems - a.totalItems || b.mtime - a.mtime);
      targetPath = available[0].filePath;
    }

    if (!fs.existsSync(targetPath)) {
      return { success: false, error: 'Fișierul de backup specificat nu există.' };
    }

    const info = evaluateDb(targetPath);
    if (!info || info.totalItems === 0) {
      return { success: false, error: 'Fișierul din cloud este gol sau corupt.' };
    }

    const ok = restoreDb(targetPath);
    if (ok) {
      console.log(`[CLOUD RESTORE] Baza de date a fost restaurată din: ${targetPath}`);
      return { success: true, restoredFrom: targetPath, totalItems: info.totalItems };
    } else {
      return { success: false, error: 'A apărut o eroare la înlocuirea fișierului bazei de date.' };
    }
  } catch (err: any) {
    console.error('[CLOUD RESTORE ERROR]:', err);
    return { success: false, error: err.message || 'Eroare neașteptată la restaurarea din cloud.' };
  }
}

export function getCloudStatus(): CloudSyncStatus {
  const folderPath = getCloudFolderPath();
  let lastCloudBackup: string | null = null;
  try {
    if (fs.existsSync(configFilePath)) {
      const data = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
      lastCloudBackup = data.lastCloudBackup || null;
    }
  } catch (e) {}

  const availableBackups = folderPath ? getAvailableCloudBackups() : [];
  if (availableBackups.length > 0 && !lastCloudBackup) {
    lastCloudBackup = availableBackups[0].formattedTime;
  }

  return {
    isConnected: !!folderPath,
    folderPath,
    lastCloudBackup,
    availableBackups
  };
}
