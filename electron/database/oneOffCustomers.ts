import type Database from 'better-sqlite3';

function hasColumn(connection: Database.Database, table: string, column: string) {
  return (connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(row => row.name === column);
}

export function ensureOneOffCustomerSchema(connection: Database.Database) {
  if (!hasColumn(connection, 'clients', 'is_one_off')) connection.exec('ALTER TABLE clients ADD COLUMN is_one_off INTEGER NOT NULL DEFAULT 0 CHECK(is_one_off IN (0,1));');
  if (!hasColumn(connection, 'companies', 'is_one_off')) connection.exec('ALTER TABLE companies ADD COLUMN is_one_off INTEGER NOT NULL DEFAULT 0 CHECK(is_one_off IN (0,1));');
  if (!hasColumn(connection, 'stores', 'is_one_off')) connection.exec('ALTER TABLE stores ADD COLUMN is_one_off INTEGER NOT NULL DEFAULT 0 CHECK(is_one_off IN (0,1));');
  if (connection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='billing_publication_queue'").get()) {
    connection.exec(`
      DROP TRIGGER IF EXISTS billing_company_insert;
      CREATE TRIGGER billing_company_insert AFTER INSERT ON companies WHEN NEW.is_one_off = 0 BEGIN
        INSERT OR IGNORE INTO billing_publication_queue(company_id) VALUES(NEW.id);
      END;
      DROP TRIGGER IF EXISTS billing_company_update;
      CREATE TRIGGER billing_company_update AFTER UPDATE OF credit_balance, supabase_company_id ON companies WHEN NEW.is_one_off = 0 BEGIN
        INSERT INTO billing_publication_queue(company_id) VALUES(NEW.id)
        ON CONFLICT(company_id) DO UPDATE SET revision=revision+1, retry_at=0;
      END;
      DELETE FROM billing_publication_queue WHERE company_id IN (SELECT id FROM companies WHERE is_one_off = 1);
      DELETE FROM billing_publication_delivery WHERE company_id IN (SELECT id FROM companies WHERE is_one_off = 1);
    `);
  }
}
