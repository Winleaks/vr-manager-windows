import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initialSchema } from './schema.ts';
import {
  addCashTransaction,
  adjustRawMaterialStockTransaction,
  closeCashDayTransaction,
  createProductionTransaction,
  deleteCashTransaction,
  initializeCashBalanceOnce,
  updateCashReceiptTransaction,
} from './repositories/inventoryTransactions.ts';

function createDatabase() {
  const connection = new Database(':memory:');
  connection.pragma('foreign_keys = ON');
  connection.exec(initialSchema);
  return connection;
}

test('production updates product and material stocks atomically', () => {
  const connection = createDatabase();
  try {
    const materialId = Number(connection.prepare(
      "INSERT INTO raw_materials (name, unit, current_stock) VALUES ('Făină', 'kg', 10)",
    ).run().lastInsertRowid);
    const productId = Number(connection.prepare(
      "INSERT INTO finished_products (name, current_stock) VALUES ('Pâine', 0)",
    ).run().lastInsertRowid);
    const recipeId = Number(connection.prepare(
      'INSERT INTO recipes (finished_product_id, batch_size) VALUES (?, 1)',
    ).run(productId).lastInsertRowid);
    connection.prepare(
      'INSERT INTO recipe_items (recipe_id, raw_material_id, quantity) VALUES (?, ?, 2)',
    ).run(recipeId, materialId);

    const productionId = createProductionTransaction(connection, productId, 3, '2026-08-11', 'test');
    assert.ok(productionId > 0);
    assert.equal((connection.prepare('SELECT current_stock AS value FROM raw_materials WHERE id = ?').get(materialId) as any).value, 4);
    assert.equal((connection.prepare('SELECT current_stock AS value FROM finished_products WHERE id = ?').get(productId) as any).value, 3);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM productions').get() as any).value, 1);

    assert.throws(
      () => createProductionTransaction(connection, productId, 3, '2026-08-11', 'insufficient'),
      /Stoc insuficient/,
    );
    assert.equal((connection.prepare('SELECT current_stock AS value FROM raw_materials WHERE id = ?').get(materialId) as any).value, 4);
    assert.equal((connection.prepare('SELECT current_stock AS value FROM finished_products WHERE id = ?').get(productId) as any).value, 3);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM productions').get() as any).value, 1);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM stock_movements').get() as any).value, 1);
  } finally {
    connection.close();
  }
});

test('cash sale rejects insufficient stock without leaving partial accounting rows', () => {
  const connection = createDatabase();
  try {
    const productId = Number(connection.prepare(
      "INSERT INTO finished_products (name, current_stock) VALUES ('Covrig', 5)",
    ).run().lastInsertRowid);
    const dayId = Number(connection.prepare(
      "INSERT INTO cash_days (date, opening_balance) VALUES ('2026-08-11', 10)",
    ).run().lastInsertRowid);

    const transactionId = addCashTransaction(connection, {
      cash_day_id: dayId,
      type: 'IN',
      category: 'direct_sale',
      amount: 6,
      items: [{ finished_product_id: productId, quantity: 2, unit_price: 3 }],
    });
    assert.ok(transactionId > 0);
    assert.equal((connection.prepare('SELECT current_stock AS value FROM finished_products WHERE id = ?').get(productId) as any).value, 3);

    assert.throws(() => addCashTransaction(connection, {
      cash_day_id: dayId,
      type: 'IN',
      category: 'direct_sale',
      amount: 12,
      items: [{ finished_product_id: productId, quantity: 4, unit_price: 3 }],
    }), /Stoc insuficient/);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM cash_transactions').get() as any).value, 1);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM cash_transaction_items').get() as any).value, 1);
    assert.equal((connection.prepare('SELECT current_stock AS value FROM finished_products WHERE id = ?').get(productId) as any).value, 3);

    assert.throws(() => closeCashDayTransaction(connection, dayId, 15), /nu corespunde/);
    assert.equal((connection.prepare('SELECT is_closed AS value FROM cash_days WHERE id = ?').get(dayId) as any).value, 0);
    assert.equal(closeCashDayTransaction(connection, dayId, 16), true);
    assert.throws(() => deleteCashTransaction(connection, transactionId), /zile închise/);
  } finally {
    connection.close();
  }
});

test('open receipts can be edited or deleted and missing rows report an error', () => {
  const connection = createDatabase();
  try {
    const dayId = Number(connection.prepare(
      "INSERT INTO cash_days (date, opening_balance) VALUES ('2026-08-14', 0)",
    ).run().lastInsertRowid);
    const driverId = Number(connection.prepare(
      "INSERT INTO drivers (name) VALUES ('Șofer test')",
    ).run().lastInsertRowid);

    const receiptId = addCashTransaction(connection, {
      cash_day_id: dayId,
      type: 'IN',
      category: 'driver_collection',
      amount: 100,
      reference_id: driverId,
      notes: 'Inițial',
    });
    assert.equal(updateCashReceiptTransaction(connection, {
      id: receiptId,
      amount: 123.45,
      reference_id: driverId,
      notes: 'Corectat',
    }), true);
    const updated = connection.prepare(
      'SELECT amount, reference_id, notes FROM cash_transactions WHERE id = ?',
    ).get(receiptId) as any;
    assert.deepEqual(updated, { amount: 123.45, reference_id: driverId, notes: 'Corectat' });

    assert.equal(deleteCashTransaction(connection, receiptId), true);
    assert.equal(
      (connection.prepare('SELECT COUNT(*) AS value FROM cash_transactions WHERE id = ?').get(receiptId) as any).value,
      0,
    );
    assert.throws(() => deleteCashTransaction(connection, receiptId), /nu există/);

    const closedReceiptId = addCashTransaction(connection, {
      cash_day_id: dayId,
      type: 'IN',
      category: 'driver_collection',
      amount: 10,
      reference_id: driverId,
    });
    assert.equal(closeCashDayTransaction(connection, dayId, 10), true);
    assert.throws(() => updateCashReceiptTransaction(connection, {
      id: closedReceiptId,
      amount: 12,
      reference_id: driverId,
    }), /zile închise/);
  } finally {
    connection.close();
  }
});

test('cash balance is initialized once at £578.25 and remains transaction-driven', () => {
  const connection = createDatabase();
  try {
    const dayId = Number(connection.prepare(
      "INSERT INTO cash_days (date, opening_balance) VALUES ('2026-08-14', 1000)",
    ).run().lastInsertRowid);
    connection.prepare(`
      INSERT INTO cash_transactions (cash_day_id, type, category, amount, notes)
      VALUES (?, 'IN', 'driver_collection', 250, 'Istoric existent')
    `).run(dayId);
    connection.prepare(`
      INSERT INTO cash_transactions (cash_day_id, type, category, amount, notes)
      VALUES (?, 'OUT', 'purchase', 50, 'Istoric existent')
    `).run(dayId);

    const initialization = initializeCashBalanceOnce(connection, dayId, 578.25);
    assert.ok(initialization.adjustmentId && initialization.adjustmentId > 0);
    assert.equal(initialization.currentBalance, 578.25);
    const rows = connection.prepare(
      'SELECT type, category, amount FROM cash_transactions WHERE cash_day_id = ? ORDER BY id',
    ).all(dayId) as Array<{ type: string; category: string; amount: number }>;
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[2], { type: 'OUT', category: 'cash_adjustment', amount: 621.75 });
    const totals = connection.prepare(`
      SELECT
        SUM(CASE WHEN type = 'IN' THEN amount ELSE 0 END) AS total_in,
        SUM(CASE WHEN type = 'OUT' THEN amount ELSE 0 END) AS total_out
      FROM cash_transactions WHERE cash_day_id = ?
    `).get(dayId) as { total_in: number; total_out: number };
    assert.equal(Math.round((1000 + totals.total_in - totals.total_out) * 100) / 100, 578.25);
    assert.equal(
      (connection.prepare("SELECT value FROM app_settings WHERE key = 'daily_cash_balance_initialized_v1'").get() as any).value,
      '578.25',
    );
    assert.throws(
      () => initializeCashBalanceOnce(connection, dayId, 600),
      /deja configurat/,
    );
    assert.throws(
      () => deleteCashTransaction(connection, initialization.adjustmentId!),
      /protejată/,
    );
    assert.equal(
      (connection.prepare('SELECT COUNT(*) AS value FROM cash_transactions WHERE cash_day_id = ?').get(dayId) as any).value,
      3,
    );

    addCashTransaction(connection, {
      cash_day_id: dayId,
      type: 'IN',
      category: 'driver_collection',
      amount: 21.75,
    });
    const updatedTotals = connection.prepare(`
      SELECT
        SUM(CASE WHEN type = 'IN' THEN amount ELSE 0 END) AS total_in,
        SUM(CASE WHEN type = 'OUT' THEN amount ELSE 0 END) AS total_out
      FROM cash_transactions WHERE cash_day_id = ?
    `).get(dayId) as { total_in: number; total_out: number };
    assert.equal(Math.round((1000 + updatedTotals.total_in - updatedTotals.total_out) * 100) / 100, 600);
  } finally {
    connection.close();
  }
});

test('manual stock adjustment rejects invalid stock and records valid changes', () => {
  const connection = createDatabase();
  try {
    const materialId = Number(connection.prepare(
      "INSERT INTO raw_materials (name, unit, current_stock) VALUES ('Sare', 'kg', 5)",
    ).run().lastInsertRowid);
    assert.throws(() => adjustRawMaterialStockTransaction(connection, materialId, -1, 'inventar'));
    assert.throws(() => adjustRawMaterialStockTransaction(connection, materialId, Number.NaN, 'inventar'));
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM stock_adjustments').get() as any).value, 0);

    assert.equal(adjustRawMaterialStockTransaction(connection, materialId, 8, 'Inventar fizic'), true);
    assert.equal((connection.prepare('SELECT current_stock AS value FROM raw_materials WHERE id = ?').get(materialId) as any).value, 8);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM stock_adjustments').get() as any).value, 1);
    assert.equal((connection.prepare('SELECT COUNT(*) AS value FROM stock_movements').get() as any).value, 1);
  } finally {
    connection.close();
  }
});
