import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import fs from 'fs'
import { initialSchema, seedData } from './schema'

const isDev = !app.isPackaged

const dbPath = isDev 
  ? path.join(process.cwd(), 'stoc-fabrica.db') 
  : path.join(app.getPath('userData'), 'stoc-fabrica.db')

export const db = new Database(dbPath, { verbose: isDev ? console.log : undefined })
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

export function initDb() {
  db.exec(initialSchema)
  
  // Seed only if categories is empty
  const count = db.prepare('SELECT COUNT(*) as count FROM categories').get() as { count: number }
  if (count.count === 0) {
    db.exec(seedData)
  }
}

export function backupDb() {
  const backupDir = isDev
    ? path.join(process.cwd(), 'backups')
    : path.join(app.getPath('documents'), 'Patiserie_Backups')

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true })
  }

  const dateStr = new Date().toISOString().slice(0, 10)
  const backupPath = path.join(backupDir, `backup_${dateStr}.db`)
  
  try {
    db.backup(backupPath)
      .then(() => console.log('Backup successful to', backupPath))
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

