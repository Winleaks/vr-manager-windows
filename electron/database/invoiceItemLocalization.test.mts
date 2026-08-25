import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { ensureInvoiceItemLocalizationSchema } from './invoiceItemLocalization.ts';

test('invoice item localization migration preserves existing invoice rows', () => {
  const connection = new Database(':memory:');
  connection.exec(`
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      total_price REAL NOT NULL
    );
    INSERT INTO invoice_items (invoice_id, product_name, quantity, unit_price, total_price)
    VALUES (1, 'Bread', 2, 1.5, 3);
  `);

  ensureInvoiceItemLocalizationSchema(connection);
  ensureInvoiceItemLocalizationSchema(connection);

  assert.deepEqual(connection.prepare(`
    SELECT product_name, product_name_ro, variant_label, unit, quantity, total_price
    FROM invoice_items
  `).get(), {
    product_name: 'Bread',
    product_name_ro: null,
    variant_label: null,
    unit: null,
    quantity: 2,
    total_price: 3,
  });
  connection.close();
});
