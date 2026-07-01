import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import fs from 'fs'
import { initialSchema, seedData } from './schema'

const isDev = !app.isPackaged

const baseDir = isDev 
  ? process.cwd() 
  : path.dirname(app.getPath('exe'))

export const dbFolder = path.join(baseDir, 'baze de date')
if (!fs.existsSync(dbFolder)) {
  fs.mkdirSync(dbFolder, { recursive: true })
}

export const dbPath = path.join(dbFolder, 'bazadedate.db')

// Migrare din locațiile sau denumirile anterioare (pentru a păstra toate datele și stocurile la update)
if (!fs.existsSync(dbPath)) {
  const oldNames = [
    path.join(dbFolder, 'stoc-fabrica.db'),
    path.join(process.cwd(), 'stoc-fabrica.db'),
    path.join(app.getPath('userData'), 'stoc-fabrica.db')
  ]
  
  for (const oldPath of oldNames) {
    if (fs.existsSync(oldPath) && oldPath !== dbPath) {
      try {
        fs.copyFileSync(oldPath, dbPath)
        if (fs.existsSync(`${oldPath}-wal`)) fs.copyFileSync(`${oldPath}-wal`, `${dbPath}-wal`)
        if (fs.existsSync(`${oldPath}-shm`)) fs.copyFileSync(`${oldPath}-shm`, `${dbPath}-shm`)
        console.log(`Baza de date a fost mutată/redenumită cu succes în: bazadedate.db`)
        
        // Ștergem vechiul fișier cu nume vechi din folderul baze de date pentru a nu lăsa duplicate confuze
        if (oldPath === path.join(dbFolder, 'stoc-fabrica.db')) {
          try {
            fs.unlinkSync(oldPath)
            if (fs.existsSync(`${oldPath}-wal`)) fs.unlinkSync(`${oldPath}-wal`)
            if (fs.existsSync(`${oldPath}-shm`)) fs.unlinkSync(`${oldPath}-shm`)
          } catch (e) { /* ignore */ }
        }
        break
      } catch (e) {
        console.error('Eroare la migrarea bazei de date:', e)
      }
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

