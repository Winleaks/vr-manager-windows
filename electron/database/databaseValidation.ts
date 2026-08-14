import Database from 'better-sqlite3';
import fs from 'fs';

const requiredTables = ['raw_materials', 'finished_products', 'stock_movements', 'categories'] as const;

export function verifyDatabaseFile(filePath: string) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    throw new Error('Fișierul bazei de date lipsește sau este gol.');
  }

  let candidate: Database.Database | null = null;
  try {
    candidate = new Database(filePath, { readonly: true, fileMustExist: true });
    const integrityRows = candidate.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (integrityRows.length !== 1 || integrityRows[0].integrity_check !== 'ok') {
      throw new Error('Verificarea de integritate SQLite a eșuat.');
    }

    const placeholders = requiredTables.map(() => '?').join(', ');
    const rows = candidate.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
    ).all(...requiredTables) as Array<{ name: string }>;
    const present = new Set(rows.map((row) => row.name));
    const missing = requiredTables.filter((table) => !present.has(table));
    if (missing.length > 0) throw new Error('Backupul nu are schema compatibilă cu aplicația.');
    return true;
  } finally {
    candidate?.close();
  }
}
