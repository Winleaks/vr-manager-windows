import type Database from 'better-sqlite3';

export function ensureOneOffInvoiceVatSchema(connection: Database.Database) {
  const columns = new Set((connection.prepare('PRAGMA table_info(invoices)').all() as Array<{ name: string }>).map(row => row.name));
  if (!columns.has('vat_rate_percent')) connection.exec('ALTER TABLE invoices ADD COLUMN vat_rate_percent INTEGER CHECK(vat_rate_percent IN (0,20));');
  if (!columns.has('vat_net_amount')) connection.exec('ALTER TABLE invoices ADD COLUMN vat_net_amount REAL CHECK(vat_net_amount >= 0);');
  if (!columns.has('vat_amount')) connection.exec('ALTER TABLE invoices ADD COLUMN vat_amount REAL CHECK(vat_amount >= 0);');
}
