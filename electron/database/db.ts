import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import fs from 'fs'
import { initialSchema, seedData } from './schema'

const isDev = !app.isPackaged

const baseDir = isDev 
  ? process.cwd() 
  : app.getPath('userData')

export const dbFolder = path.join(baseDir, 'baze de date')
if (!fs.existsSync(dbFolder)) {
  fs.mkdirSync(dbFolder, { recursive: true })
}

export const dbPath = path.join(dbFolder, 'bazadedate.db')

export function evaluateDb(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (stat.size < 1000) return null;
    const testDb = new Database(filePath, { readonly: true });
    const tbl = testDb.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='raw_materials'").get() as { c: number };
    if (tbl.c === 0) {
      testDb.close();
      return null;
    }
    const rm = testDb.prepare('SELECT COUNT(*) as c FROM raw_materials').get() as { c: number };
    const fp = testDb.prepare('SELECT COUNT(*) as c FROM finished_products').get() as { c: number };
    const sm = testDb.prepare('SELECT COUNT(*) as c FROM stock_movements').get() as { c: number };
    const cat = testDb.prepare('SELECT COUNT(*) as c FROM categories').get() as { c: number };
    testDb.close();
    const totalItems = rm.c * 10 + fp.c * 10 + sm.c * 5 + cat.c;
    return { filePath, totalItems, rm: rm.c, fp: fp.c, sm: sm.c, cat: cat.c, mtime: stat.mtimeMs };
  } catch (e) {
    return null;
  }
}

export function scanAllDatabases() {
  const candidates: string[] = [];
  const addDir = (dir: string) => {
    if (!dir || !fs.existsSync(dir)) return;
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (f.endsWith('.db') || f.endsWith('.sqlite')) {
          candidates.push(path.join(dir, f));
        }
      }
    } catch (e) {}
  };
  const addTree = (folder: string) => {
    addDir(folder);
    addDir(path.join(folder, 'baze de date'));
    addDir(path.join(folder, 'backups'));
    addDir(path.join(folder, 'baze de date', 'backups'));
  };

  try { addTree(path.dirname(app.getPath('exe'))); } catch (e) {}
  try { addTree(process.cwd()); } catch (e) {}
  try { addTree(app.getPath('userData')); } catch (e) {}
  try {
    const home = app.getPath('home');
    addTree(path.join(home, 'AppData', 'Local', 'Programs', 'vr-management-hub'));
    addTree(path.join(home, 'AppData', 'Local', 'Programs', 'VR - Management Hub'));
    addTree(path.join(home, 'AppData', 'Local', 'VirtualStore', 'Program Files', 'VR - Management Hub'));
    addTree(path.join(home, 'AppData', 'Local', 'VirtualStore', 'Program Files (x86)', 'VR - Management Hub'));
    addTree(path.join(home, 'AppData', 'Local', 'VirtualStore', 'Program Files', 'vr-management-hub'));
    addTree(path.join(home, 'AppData', 'Local', 'VirtualStore', 'Program Files (x86)', 'vr-management-hub'));
    addTree('C:\\Program Files\\VR - Management Hub');
    addTree('C:\\Program Files (x86)\\VR - Management Hub');
    addTree(path.join(home, 'Desktop'));
    addTree(path.join(home, 'Desktop', 'VR - Management Hub'));
    addTree(path.join(home, 'Downloads'));
  } catch (e) {}

  const uniquePaths = Array.from(new Set(candidates));
  const results = [];
  for (const p of uniquePaths) {
    const info = evaluateDb(p);
    if (info && info.totalItems > 6) {
      results.push(info);
    }
  }
  results.sort((a, b) => b.totalItems - a.totalItems || b.mtime - a.mtime);
  return results;
}

// Migrare/restaurare automată la pornire: dacă baza curentă are <= 5 articole
const currentInfo = evaluateDb(dbPath);
const currentScore = currentInfo ? currentInfo.totalItems : 0;

if (currentScore <= 50) {
  const found = scanAllDatabases();
  const best = found.find(f => path.resolve(f.filePath) !== path.resolve(dbPath) && f.totalItems > currentScore);
  if (best) {
    try {
      console.log(`[MIGRARE AUTOMATĂ] Am găsit baza de date anterioară: ${best.filePath} (Scor: ${best.totalItems}). O restaurăm în: ${dbPath}`);
      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, path.join(dbFolder, `backup_pre_migration_${Date.now()}.db`));
      }
      fs.copyFileSync(best.filePath, dbPath);
      if (fs.existsSync(`${best.filePath}-wal`)) fs.copyFileSync(`${best.filePath}-wal`, `${dbPath}-wal`);
      if (fs.existsSync(`${best.filePath}-shm`)) fs.copyFileSync(`${best.filePath}-shm`, `${dbPath}-shm`);
      if (fs.existsSync(`${dbPath}-wal`) && !fs.existsSync(`${best.filePath}-wal`)) {
        try { fs.unlinkSync(`${dbPath}-wal`); } catch (e) {}
      }
      if (fs.existsSync(`${dbPath}-shm`) && !fs.existsSync(`${best.filePath}-shm`)) {
        try { fs.unlinkSync(`${dbPath}-shm`); } catch (e) {}
      }
      console.log('Restaurare automată finalizată cu succes!');
    } catch (e) {
      console.error('Eroare la restaurarea automată:', e);
    }
  }
}

export let db = new Database(dbPath, { verbose: isDev ? console.log : undefined })
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

export let lastBackupTime: string | null = null;

export function initDb() {
  db.exec(initialSchema)
  
  // Seed only if categories is empty
  const count = db.prepare('SELECT COUNT(*) as count FROM categories').get() as { count: number }
  if (count.count === 0) {
    db.exec(seedData)
  }
}

export function backupDb() {
  const backupDir = path.join(dbFolder, 'backups')

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true })
  }

  const dateStr = new Date().toISOString().slice(0, 10)
  const backupPath = path.join(backupDir, `backup_${dateStr}.db`)
  
  try {
    db.backup(backupPath)
      .then(() => {
        console.log('Backup successful to', backupPath);
        const now = new Date();
        const dateFormatted = now.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeFormatted = now.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
        lastBackupTime = `${dateFormatted} - ${timeFormatted}`;
      })
      .catch((err: any) => console.error('Backup failed:', err))
  } catch(e) {
    console.error('Backup sync error', e)
  }
}

export function closeDb() {
  try {
    if (db.open) {
      db.close();
      console.log('Database connection closed.');
    }
  } catch (e) {
    console.error('Error closing database:', e);
  }
}

export function restoreDb(filePath: string) {
  try {
    closeDb();
    fs.copyFileSync(filePath, dbPath);
    console.log('Database file replaced from backup.');
    // Re-open DB
    db = new Database(dbPath, { verbose: isDev ? console.log : undefined });
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return true;
  } catch (err) {
    console.error('Failed to restore database:', err);
    // Try to recover
    db = new Database(dbPath, { verbose: isDev ? console.log : undefined });
    return false;
  }
}

