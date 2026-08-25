import type Database from 'better-sqlite3';

export function ensureInvoiceItemLocalizationSchema(connection: Database.Database) {
  const columns = new Set((connection.prepare(
    'PRAGMA table_info(invoice_items)',
  ).all() as Array<{ name: string }>).map((column) => column.name));

  if (!columns.has('product_name_ro')) connection.exec('ALTER TABLE invoice_items ADD COLUMN product_name_ro TEXT;');
  if (!columns.has('variant_label')) connection.exec('ALTER TABLE invoice_items ADD COLUMN variant_label TEXT;');
  if (!columns.has('unit')) connection.exec('ALTER TABLE invoice_items ADD COLUMN unit TEXT;');
}
