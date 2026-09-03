import type Database from 'better-sqlite3';

type SqliteDatabase = Database.Database;

function columnExists(connection: SqliteDatabase, table: string, column: string) {
  return (connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);
}

export function ensureBillingPostcodeSchema(connection: SqliteDatabase) {
  if (!columnExists(connection, 'stores', 'postcode')) {
    connection.exec('ALTER TABLE stores ADD COLUMN postcode TEXT;');
  }
}
