import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initialSchema } from './schema.ts';
import { getCashTransactionsByDateRange } from './cashHistory.ts';
import {
  localIsoDate,
  millisecondsUntilNextLocalMidnight,
  rolloverCashDay,
} from './cashDayRollover.ts';

function createDatabase() {
  const connection = new Database(':memory:');
  connection.pragma('foreign_keys = ON');
  connection.exec(initialSchema);
  return connection;
}

test('cash history uses the real local transaction date instead of the stale cash session date', () => {
  const connection = createDatabase();
  try {
    const dayId = Number(connection.prepare(
      "INSERT INTO cash_days (date, opening_balance) VALUES ('2026-07-21', 100)",
    ).run().lastInsertRowid);
    connection.prepare(`
      INSERT INTO cash_transactions (cash_day_id, type, category, amount, created_at)
      VALUES (?, 'IN', 'driver_collection', 25, '2026-08-14 12:00:00')
    `).run(dayId);

    assert.equal(getCashTransactionsByDateRange(connection, '2026-08-14', '2026-08-14', 'driver_collection').length, 1);
    assert.equal(getCashTransactionsByDateRange(connection, '2026-07-01', '2026-07-31', 'driver_collection').length, 0);
  } finally {
    connection.close();
  }
});

test('midnight rollover closes the stale day, carries its balance, and moves todays receipts', () => {
  const connection = createDatabase();
  try {
    const oldDayId = Number(connection.prepare(
      "INSERT INTO cash_days (date, opening_balance) VALUES ('2026-07-21', 1000)",
    ).run().lastInsertRowid);
    connection.prepare(`
      INSERT INTO cash_transactions (cash_day_id, type, category, amount, created_at)
      VALUES (?, 'IN', 'driver_collection', 100, '2026-07-21 12:00:00')
    `).run(oldDayId);
    connection.prepare(`
      INSERT INTO cash_transactions (cash_day_id, type, category, amount, created_at)
      VALUES (?, 'IN', 'driver_collection', 250, '2026-08-14 12:00:00')
    `).run(oldDayId);

    const result = rolloverCashDay(connection, '2026-08-14');
    assert.equal(result.rolledOver, true);
    assert.equal(result.movedTransactions, 1);
    const oldDay = connection.prepare(
      'SELECT is_closed, closing_balance FROM cash_days WHERE id = ?',
    ).get(oldDayId) as any;
    assert.deepEqual(oldDay, { is_closed: 1, closing_balance: 1100 });
    const currentDay = connection.prepare(
      "SELECT id, opening_balance, is_closed FROM cash_days WHERE date = '2026-08-14'",
    ).get() as any;
    assert.equal(currentDay.opening_balance, 1100);
    assert.equal(currentDay.is_closed, 0);
    assert.equal(
      (connection.prepare('SELECT cash_day_id FROM cash_transactions WHERE amount = 250').get() as any).cash_day_id,
      currentDay.id,
    );
    assert.equal(rolloverCashDay(connection, '2026-08-14').rolledOver, false);
  } finally {
    connection.close();
  }
});

test('local cash dates and the midnight timer do not use UTC day boundaries', () => {
  const localTime = new Date(2026, 7, 14, 23, 59, 30, 0);
  assert.equal(localIsoDate(localTime), '2026-08-14');
  assert.equal(millisecondsUntilNextLocalMidnight(localTime), 30_000);
});
