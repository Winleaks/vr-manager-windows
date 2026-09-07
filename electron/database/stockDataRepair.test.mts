import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { repairInvalidFinishedProductStocks, storedFiniteNumber } from './stockDataRepair.ts';

function createLegacyDatabase() {
  const connection = new Database(':memory:');
  connection.exec(`
    CREATE TABLE finished_products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      current_stock REAL,
      updated_at DATETIME
    );
    CREATE TABLE finished_product_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      finished_product_id INTEGER,
      movement_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      stock_before REAL NOT NULL,
      stock_after REAL NOT NULL,
      reference_type TEXT,
      notes TEXT
    );
    CREATE TABLE productions (
      id INTEGER PRIMARY KEY,
      finished_product_id INTEGER,
      quantity_produced REAL
    );
    CREATE TABLE cash_transaction_items (
      id INTEGER PRIMARY KEY,
      finished_product_id INTEGER,
      quantity REAL
    );
  `);
  return connection;
}

test('stored finished stock accepts negative numbers and legacy numeric text', () => {
  assert.equal(storedFiniteNumber(5.5), 5.5);
  assert.equal(storedFiniteNumber('12.25'), 12.25);
  assert.equal(storedFiniteNumber(-1), -1);
  assert.equal(storedFiniteNumber('-3.5'), -3.5);
  assert.equal(storedFiniteNumber(null), null);
  assert.equal(storedFiniteNumber('necunoscut'), null);
});

test('repairs invalid finished stock from movements, history, or zero', () => {
  const connection = createLegacyDatabase();
  try {
    connection.prepare(`
      INSERT INTO finished_products (id, name, current_stock)
      VALUES (1, 'Mișcare', NULL), (2, 'Istoric', NULL), (3, 'Fără istoric', NULL), (4, 'Vândut înainte de producție', NULL)
    `).run();
    connection.prepare(`
      INSERT INTO finished_product_movements
        (finished_product_id, movement_type, quantity, stock_before, stock_after)
      VALUES (1, 'productie', 12, 0, 12)
    `).run();
    connection.prepare(`
      INSERT INTO productions (id, finished_product_id, quantity_produced)
      VALUES (1, 2, 10)
    `).run();
    connection.prepare(`
      INSERT INTO cash_transaction_items (id, finished_product_id, quantity)
      VALUES (1, 2, 3), (2, 4, 4)
    `).run();

    const repairs = repairInvalidFinishedProductStocks(connection);
    assert.deepEqual(repairs.map((item) => [item.productId, item.stock, item.source]), [
      [1, 12, 'last-movement'],
      [2, 7, 'history'],
      [3, 0, 'zero'],
      [4, -4, 'history'],
    ]);
    assert.deepEqual(connection.prepare(
      'SELECT id, current_stock FROM finished_products ORDER BY id',
    ).all(), [
      { id: 1, current_stock: 12 },
      { id: 2, current_stock: 7 },
      { id: 3, current_stock: 0 },
      { id: 4, current_stock: -4 },
    ]);
    assert.equal((connection.prepare(
      "SELECT COUNT(*) AS value FROM finished_product_movements WHERE reference_type = 'migration'",
    ).get() as { value: number }).value, 4);
  } finally {
    connection.close();
  }
});
