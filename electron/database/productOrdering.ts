import type Database from 'better-sqlite3';

type SqliteDatabase = Database.Database;

function tableExists(connection: SqliteDatabase, table: string) {
  return Boolean(connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function ensureColumn(connection: SqliteDatabase, table: string, column: string) {
  if (!tableExists(connection, table)) return;
  const columns = new Set((connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
  if (!columns.has(column)) connection.exec(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER;`);
}

export function ensureProductOrderingSchema(connection: SqliteDatabase) {
  ensureColumn(connection, 'finished_products', 'display_order');
  ensureColumn(connection, 'cloud_products', 'display_order');
  ensureColumn(connection, 'invoice_items', 'product_order');
  ensureColumn(connection, 'credit_note_items', 'product_order');
  connection.exec(`
    CREATE INDEX IF NOT EXISTS idx_finished_products_display_order ON finished_products(display_order);
    CREATE INDEX IF NOT EXISTS idx_cloud_products_display_order ON cloud_products(display_order);
    CREATE INDEX IF NOT EXISTS idx_invoice_items_product_order ON invoice_items(invoice_id, product_order, id);
  `);
  if (tableExists(connection, 'credit_note_items')) {
    connection.exec('CREATE INDEX IF NOT EXISTS idx_credit_note_items_product_order ON credit_note_items(credit_note_id, source_invoice_id, product_order, id);');
  }
  connection.exec(`
    UPDATE invoice_items
    SET product_order = COALESCE(
      (SELECT cp.display_order FROM cloud_products cp WHERE cp.supabase_product_id = invoice_items.external_product_id LIMIT 1),
      (SELECT fp.display_order FROM finished_products fp WHERE fp.id = invoice_items.finished_product_id LIMIT 1)
    )
    WHERE product_order IS NULL;
  `);
  if (tableExists(connection, 'credit_note_items')) {
    connection.exec(`
      UPDATE credit_note_items
      SET product_order = (
        SELECT item.product_order FROM invoice_items item
        WHERE item.id = credit_note_items.source_invoice_item_id
      )
      WHERE product_order IS NULL;
    `);
  }
}
