import {installBillingPublication} from './billingPublication';
import {installEntitySyncState} from './entitySync';
import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { initialSchema, seedData } from './schema'
import { createBackupFilename, selectBackupFilesToDelete } from './backupPolicy'
import { verifyDatabaseFile } from './databaseValidation'
import { migrateLegacyIdentity } from '../migration/identityMigration'
import { repairInvalidFinishedProductStocks } from './stockDataRepair'
import { ensureFinishedProductCatalogSchema } from './finishedProductCatalog'
import { ensureRawMaterialLocalizationSchema } from './rawMaterialLocalization'
import { ensureInvoiceItemLocalizationSchema } from './invoiceItemLocalization'
import { ensureBillingIssuerSchema } from './billingIssuers'
import { ensureCreditNoteSchema } from './creditNotes'
import { ensureBillingPostcodeSchema } from './billingPostcodes'
import { ensureProductOrderingSchema } from './productOrdering'

export { verifyDatabaseFile } from './databaseValidation'

const isDev = !app.isPackaged

const baseDir = isDev 
  ? process.cwd() 
  : app.getPath('userData')

if (!isDev) {
  const appData = app.getPath('appData')
  const migration = migrateLegacyIdentity({
    targetUserData: baseDir,
    legacyUserDataDirs: [
      path.join(appData, 'VR - Management Hub'),
      path.join(appData, 'vr-management-hub'),
    ],
    validateDatabase: verifyDatabaseFile,
  })
  if (migration.migrated) {
    console.log('[IDENTITY MIGRATION] Datele aplicației anterioare au fost migrate și verificate.')
  }
}

export const dbFolder = path.join(baseDir, 'baze de date')
if (!fs.existsSync(dbFolder)) {
  fs.mkdirSync(dbFolder, { recursive: true })
}

export const dbPath = path.join(dbFolder, 'bazadedate.db')
let databaseExistedAtStartup = fs.existsSync(dbPath)

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
    addTree(path.join(app.getPath('appData'), 'VR - Management Hub'));
    addTree(path.join(app.getPath('appData'), 'vr-management-hub'));
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
databaseExistedAtStartup = fs.existsSync(dbPath)

function openDatabase() {
  const connection = new Database(dbPath, { verbose: isDev ? console.log : undefined })
  connection.pragma('journal_mode = WAL')
  connection.pragma('foreign_keys = ON')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('temp_store = MEMORY')
  connection.pragma('busy_timeout = 5000')
  return connection
}

export let db = openDatabase()

export let lastBackupAttemptTime: string | null = null;
export let lastBackupTime: string | null = null;
export let lastVerifiedBackupTime: string | null = null;

export function initDb() {
  // 1. Execuția schemei și a indecșilor B-Tree
  db.exec(initialSchema)

  // Preserve a verified copy before adding the persistent billing publication queue.
  // This also covers older Credit Notes migrations during a direct upgrade.
  createPreMigrationSnapshotIfNeeded(18)
  
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

function createPreMigrationSnapshotIfNeeded(targetVersion: number) {
  if (!databaseExistedAtStartup) return
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
  const version = table
    ? Number((db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as { version: number }).version)
    : 0
  if (version >= targetVersion) return
  const backupDir = path.join(dbFolder, 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const snapshotPath = path.join(backupDir, `pre-migration-v${targetVersion}-${stamp}.db`)
  db.prepare('VACUUM INTO ?').run(snapshotPath)
  verifyDatabaseFile(snapshotPath)
  console.log(`[MIGRATION] Snapshot verificat creat înainte de v${targetVersion}: ${snapshotPath}`)
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
      },
      {
        version: 6,
        description: "Adăugare trasabilitate și protecție anti-duplicare pentru importurile VR Baker",
        up: () => {
          db.exec(`
            CREATE TABLE IF NOT EXISTS invoice_import_batches (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              invoice_id INTEGER NOT NULL UNIQUE,
              source TEXT NOT NULL DEFAULT 'vrbaker',
              store_external_id TEXT NOT NULL,
              period_start DATE NOT NULL,
              period_end DATE NOT NULL,
              source_fingerprint TEXT NOT NULL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
              UNIQUE(source, store_external_id, period_start, period_end),
              CHECK(period_start <= period_end)
            );
            CREATE TABLE IF NOT EXISTS invoice_source_orders (
              batch_id INTEGER NOT NULL,
              external_order_id TEXT NOT NULL UNIQUE,
              external_updated_at TEXT NOT NULL,
              PRIMARY KEY(batch_id, external_order_id),
              FOREIGN KEY(batch_id) REFERENCES invoice_import_batches(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_invoice_import_period ON invoice_import_batches(period_start, period_end);
            CREATE INDEX IF NOT EXISTS idx_invoice_source_batch ON invoice_source_orders(batch_id);
          `);
        }
      },
      {
        version: 7,
        description: "Adăugare jurnal pentru închideri și rapoarte Daily Cash",
        up: () => {
          db.exec(`
            CREATE TABLE IF NOT EXISTS cash_day_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              cash_day_id INTEGER NOT NULL,
              event_type TEXT NOT NULL CHECK(event_type IN ('manual_close', 'automatic_close', 'reopen', 'report_prepared')),
              balance REAL,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY(cash_day_id) REFERENCES cash_days(id)
            );
            CREATE INDEX IF NOT EXISTS idx_cash_day_events_day ON cash_day_events(cash_day_id, created_at);
          `);
        }
      },
      {
        version: 8,
        description: "Reparare stocuri invalide pentru produse finite din bazele vechi",
        up: () => {
          const repairs = repairInvalidFinishedProductStocks(db);
          if (repairs.length > 0) {
            console.log(`[MIGRATION] Au fost normalizate ${repairs.length} stocuri de produse finite.`);
          }
        }
      },
      {
        version: 9,
        description: "Conectare produse finite la catalogul VR Baker Platform",
        up: () => {
          ensureFinishedProductCatalogSchema(db);
        }
      },
      {
        version: 10,
        description: "Adăugare denumiri bilingve pentru materiile prime locale",
        up: () => {
          ensureRawMaterialLocalizationSchema(db);
        }
      },
      {
        version: 11,
        description: "Păstrare denumiri bilingve în pozițiile facturilor",
        up: () => {
          ensureFinishedProductCatalogSchema(db);
          ensureInvoiceItemLocalizationSchema(db);
        }
      },
      {
        version: 12,
        description: "Facturare cu societăți emitente, serii și credite separate",
        up: () => {
          ensureBillingIssuerSchema(db);
        }
      },
      {
        version: 13,
        description: "Credit Notes, registru de credit și legături sigure cu stocul",
        up: () => {
          ensureBillingIssuerSchema(db);
          ensureCreditNoteSchema(db);
        }
      },
      {
        version: 14,
        description: "Păstrare postcode separat pentru magazinele VR Baker",
        up: () => {
          ensureBillingPostcodeSchema(db);
        }
      },
      {
        version: 15,
        description: "Ordinea produselor sincronizată din VR Baker Platform",
        up: () => {
          ensureProductOrderingSchema(db);
        }
      },
      {
        version: 16,
        description: "Alegere implicită sau explicită a emitentului per client",
        up: () => {
          ensureBillingIssuerSchema(db);
        }
      }
      ,{version:17,description:'Publicare financiară VR Baker',up:()=>installBillingPublication(db)}
      ,{version:18,description:'Prezența entităților VR Baker separată de accesul clientului',up:()=>installEntitySyncState(db)}
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
    throw e;
  }
}

let maintenanceQueue: Promise<void> = Promise.resolve()
let automaticBackupInFlight: Promise<BackupResult> | null = null

export interface BackupResult {
  success: boolean;
  path?: string;
  error?: string;
  cloud?: {
    success: boolean;
    uploaded?: boolean;
    skipped?: boolean;
    error?: string;
    modifiedTime?: string | null;
  };
}

function withDatabaseMaintenance<T>(operation: () => Promise<T>): Promise<T> {
  const result = maintenanceQueue.then(operation, operation)
  maintenanceQueue = result.then(() => undefined, () => undefined)
  return result
}

export function waitForDatabaseReady() {
  return maintenanceQueue
}

function safeUnlink(filePath: string) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch {}
}

function removeDatabaseSidecars(filePath: string) {
  safeUnlink(`${filePath}-wal`)
  safeUnlink(`${filePath}-shm`)
}

async function replaceFileAtomically(stagedPath: string, destinationPath: string) {
  const previousPath = `${destinationPath}.previous-${randomUUID()}`
  let previousMoved = false
  try {
    if (fs.existsSync(destinationPath)) {
      fs.renameSync(destinationPath, previousPath)
      previousMoved = true
    }
    fs.renameSync(stagedPath, destinationPath)
    if (previousMoved) safeUnlink(previousPath)
  } catch (error) {
    safeUnlink(destinationPath)
    if (previousMoved && fs.existsSync(previousPath)) fs.renameSync(previousPath, destinationPath)
    throw error
  }
}

async function createVerifiedSnapshotUnlocked(destinationPath: string) {
  const destinationDir = path.dirname(destinationPath)
  fs.mkdirSync(destinationDir, { recursive: true })
  const stagedPath = path.join(destinationDir, `.${path.basename(destinationPath)}.${randomUUID()}.tmp`)

  try {
    await db.backup(stagedPath)
    verifyDatabaseFile(stagedPath)
    await replaceFileAtomically(stagedPath, destinationPath)
    return destinationPath
  } finally {
    safeUnlink(stagedPath)
  }
}

async function copyDatabaseSnapshot(sourcePath: string, destinationPath: string) {
  let source: Database.Database | null = null
  try {
    source = new Database(sourcePath, { readonly: true, fileMustExist: true })
    await source.backup(destinationPath)
  } finally {
    source?.close()
  }
}

export function createVerifiedSnapshot(destinationPath: string) {
  return withDatabaseMaintenance(() => createVerifiedSnapshotUnlocked(destinationPath))
}

function pruneAutomaticBackups(backupDir: string) {
  const filenames = fs.readdirSync(backupDir)
  for (const filename of selectBackupFilesToDelete(filenames)) {
    safeUnlink(path.join(backupDir, filename))
  }
}

export function backupDb(): Promise<BackupResult> {
  if (automaticBackupInFlight) return automaticBackupInFlight

  automaticBackupInFlight = withDatabaseMaintenance(async () => {
    const now = new Date()
    lastBackupAttemptTime = now.toISOString()
    const backupDir = path.join(dbFolder, 'backups')
    const backupPath = path.join(backupDir, createBackupFilename(now))
    await createVerifiedSnapshotUnlocked(backupPath)
    try {
      pruneAutomaticBackups(backupDir)
    } catch (error) {
      console.warn('Backup retention cleanup failed:', error)
    }

    lastVerifiedBackupTime = now.toISOString()
    lastBackupTime = now.toLocaleString('ro-RO', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    console.log('Verified backup successful to', backupPath)
    return { success: true, path: backupPath }
  }).then(async (result) => {
    try {
      const { saveToCloud } = require('./cloudSync')
      const cloudResult = await saveToCloud(true, result.path)
      if (!cloudResult.success) console.warn('[CLOUD SYNC] Backupul local a reușit, dar publicarea în Drive nu a fost confirmată.')
      return { ...result, cloud: cloudResult }
    } catch {
      console.warn('[CLOUD SYNC] Backupul local a reușit, dar sincronizarea Drive a eșuat neașteptat.')
      return { ...result, cloud: { success: false, error: 'Sincronizarea Google Drive a eșuat.' } }
    }
  }).catch((error: unknown) => {
    console.error('Backup failed:', error)
    return { success: false, error: 'Backupul local nu a putut fi creat sau verificat.' }
  }).finally(() => {
    automaticBackupInFlight = null
  })

  return automaticBackupInFlight
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

export function restoreDb(filePath: string): Promise<boolean> {
  return withDatabaseMaintenance(async () => {
    const operationId = randomUUID()
    const stagedPath = `${dbPath}.restore-${operationId}.tmp`
    const rollbackPath = `${dbPath}.rollback-${operationId}`
    const backupDir = path.join(dbFolder, 'backups')
    const restoreTimestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const preRestorePath = path.join(backupDir, `pre_restore_${restoreTimestamp}_${operationId}.db`)
    let originalMoved = false
    let replacementInstalled = false
    let transitionStarted = false

    try {
      verifyDatabaseFile(filePath)
      await createVerifiedSnapshotUnlocked(preRestorePath)
      await copyDatabaseSnapshot(filePath, stagedPath)
      verifyDatabaseFile(stagedPath)

      transitionStarted = true
      closeDb()
      removeDatabaseSidecars(dbPath)
      if (fs.existsSync(dbPath)) {
        fs.renameSync(dbPath, rollbackPath)
        originalMoved = true
      }
      fs.renameSync(stagedPath, dbPath)
      replacementInstalled = true

      db = openDatabase()
      initDb()
      verifyDatabaseFile(dbPath)
      safeUnlink(rollbackPath)
      console.log('Database restored from a verified backup. Recovery snapshot:', preRestorePath)
      return true
    } catch (error) {
      console.error('Failed to restore database:', error)
      if (transitionStarted) {
        closeDb()
        removeDatabaseSidecars(dbPath)
        if (replacementInstalled) safeUnlink(dbPath)
        try {
          if (originalMoved && fs.existsSync(rollbackPath)) fs.renameSync(rollbackPath, dbPath)
        } catch (rollbackError) {
          console.error('Failed to put the original database back in place. Recovery file retained:', rollbackPath, rollbackError)
        }
        try {
          if (fs.existsSync(dbPath)) db = openDatabase()
        } catch (reopenError) {
          console.error('Failed to reopen the database after restore rollback:', reopenError)
        }
      }
      return false
    } finally {
      safeUnlink(stagedPath)
    }
  })
}
