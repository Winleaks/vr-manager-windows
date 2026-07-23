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
    try {
      const { getCloudTargetDirectory } = require('./cloudSync');
      const cloudDir = getCloudTargetDirectory();
      if (cloudDir) addTree(cloudDir);
    } catch (e) {}
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

// Migrare automată la prima pornire (doar dacă baza de date nu există deloc pe disc)
if (!fs.existsSync(dbPath)) {
  const found = scanAllDatabases();
  const best = found.find(f => path.resolve(f.filePath) !== path.resolve(dbPath) && f.totalItems > 5);
  if (best) {
    try {
      console.log(`[MIGRARE AUTOMATĂ] Am găsit o bază de date anterioară pe disc: ${best.filePath}. O restaurăm în: ${dbPath}`);
      fs.copyFileSync(best.filePath, dbPath);
    } catch (e) {
      console.error('Eroare la restaurarea automată:', e);
    }
  }
}

export let db = new Database(dbPath, { verbose: isDev ? console.log : undefined })
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('synchronous = NORMAL')
db.pragma('temp_store = MEMORY')
db.pragma('busy_timeout = 5000')

export let lastBackupTime: string | null = null;

export function initDb() {
  // 1. Execuția schemei și a indecșilor B-Tree
  db.exec(initialSchema)
  
  // 2. Rularea migrărilor de schemă
  runMigrations()
  
  // 3. Optimizarea planificatorului de interogări SQLite
  try {
    db.pragma('optimize')
  } catch (e) {}

  // 4. Populate doar dacă nu există categorii (bază de date complet nouă)
  const count = db.prepare('SELECT COUNT(*) as count FROM categories').get() as { count: number }
  if (count.count === 0) {
    db.exec(seedData)
  }
}

function runMigrations() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const currentRow = db.prepare('SELECT MAX(version) as version FROM schema_migrations').get() as { version: number | null };
    const currentVersion = currentRow.version || 0;

    // Aici se adaugă în ordine secvențială modificările viitoare (ex. ALTER TABLE pentru a adăuga coloane noi)
    const migrations: { version: number, description: string, up: () => void }[] = [
      {
        version: 1,
        description: "Adăugare coloană current_stock la finished_products",
        up: () => { 
          // SQLite nu suportă mereu ADD COLUMN cu DEFAULT într-un mod curat dacă tabelul nu e gol, dar vom încerca.
          try {
            db.exec("ALTER TABLE finished_products ADD COLUMN current_stock REAL NOT NULL DEFAULT 0;");
          } catch (e: any) {
            // Dacă coloana există deja, ignorăm
            if (!e.message.includes("duplicate column name")) {
              throw e;
            }
          }
        }
      },
      {
        version: 2,
        description: "Adăugare coloană supabase_company_id la companies",
        up: () => {
          try {
            db.exec("ALTER TABLE companies ADD COLUMN supabase_company_id TEXT;");
          } catch (e: any) {
            if (!e.message.includes("duplicate column name")) {
              throw e;
            }
          }
        }
      },
      {
        version: 3,
        description: "Adăugare coloane complete produse (name_ro, variant_label, price_standard, available)",
        up: () => {
          try { db.exec("ALTER TABLE cloud_products ADD COLUMN name_ro TEXT;"); } catch (e) {}
          try { db.exec("ALTER TABLE cloud_products ADD COLUMN variant_label TEXT;"); } catch (e) {}
          try { db.exec("ALTER TABLE cloud_products ADD COLUMN price_standard REAL DEFAULT 0;"); } catch (e) {}
          try { db.exec("ALTER TABLE cloud_products ADD COLUMN available BOOLEAN DEFAULT 1;"); } catch (e) {}
        }
      },
      {
        version: 4,
        description: "Adăugare credit_balance la companies și company_id, bank_name la payments",
        up: () => {
          try { db.exec("ALTER TABLE companies ADD COLUMN credit_balance REAL DEFAULT 0;"); } catch (e) {}
          try { db.exec("ALTER TABLE payments ADD COLUMN company_id INTEGER;"); } catch (e) {}
          try { db.exec("ALTER TABLE payments ADD COLUMN bank_name TEXT;"); } catch (e) {}
        }
      },
      {
        version: 5,
        description: "Adăugare coloane phone la companies și stores",
        up: () => {
          try { db.exec("ALTER TABLE companies ADD COLUMN phone TEXT;"); } catch (e) {}
          try { db.exec("ALTER TABLE stores ADD COLUMN phone TEXT;"); } catch (e) {}
        }
      }
    ];

    for (const migration of migrations) {
      if (migration.version > currentVersion) {
        console.log(`[MIGRATION] Aplicare migrare v${migration.version}: ${migration.description}...`);
        const tx = db.transaction(() => {
          migration.up();
          db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(migration.version);
        });
        tx();
        console.log(`[MIGRATION] Migrarea v${migration.version} aplicată cu succes!`);
      }
    }
  } catch (e) {
    console.error('[MIGRATION ERROR] Eroare la rularea migrărilor:', e);
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
        try {
          const { saveToCloud } = require('./cloudSync');
          saveToCloud(true);
        } catch (errCloud) {
          console.warn('Silent cloud sync failed:', errCloud);
        }
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
    
    // Curățăm jurnalele WAL și SHM vechi pentru a nu anula datele proaspăt restaurate
    if (fs.existsSync(`${dbPath}-wal`)) {
      try { fs.unlinkSync(`${dbPath}-wal`); } catch (e) {}
    }
    if (fs.existsSync(`${dbPath}-shm`)) {
      try { fs.unlinkSync(`${dbPath}-shm`); } catch (e) {}
    }

    fs.copyFileSync(filePath, dbPath);
    console.log('Database file replaced from backup successfully.');
    
    // Re-deschidere conexiune Singleton DB cu toate setările optime
    db = new Database(dbPath, { verbose: isDev ? console.log : undefined });
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');
    db.pragma('busy_timeout = 5000');
    return true;
  } catch (err) {
    console.error('Failed to restore database:', err);
    try {
      db = new Database(dbPath, { verbose: isDev ? console.log : undefined });
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
    } catch (e) {}
    return false;
  }
}

