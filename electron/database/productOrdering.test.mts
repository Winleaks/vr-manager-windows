import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { ensureProductOrderingSchema } from './productOrdering.ts';

test('product ordering migration is idempotent and backfills historical invoice lines', () => {
  const connection = new Database(':memory:');
  try {
    connection.exec(`
      CREATE TABLE finished_products (id INTEGER PRIMARY KEY, external_product_id TEXT);
      CREATE TABLE cloud_products (id INTEGER PRIMARY KEY, supabase_product_id TEXT);
      CREATE TABLE invoice_items (id INTEGER PRIMARY KEY, invoice_id INTEGER, external_product_id TEXT, finished_product_id INTEGER);
      INSERT INTO cloud_products (id, supabase_product_id) VALUES (1, 'product-a');
      INSERT INTO invoice_items (id, invoice_id, external_product_id) VALUES (1, 10, 'product-a');
    `);
    ensureProductOrderingSchema(connection);
    connection.prepare('UPDATE cloud_products SET display_order = 9 WHERE id = 1').run();
    ensureProductOrderingSchema(connection);
    ensureProductOrderingSchema(connection);
    assert.equal((connection.prepare('SELECT product_order AS value FROM invoice_items WHERE id = 1').get() as { value: number }).value, 9);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM invoice_items').get() as { value: number }).value, 1);
  } finally {
    connection.close();
  }
});
