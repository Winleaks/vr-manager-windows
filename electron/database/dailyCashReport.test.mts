import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initialSchema } from './schema.ts';
import { getDailyCashReportSnapshot, recordDailyCashReportPrepared } from './dailyCashReport.ts';

function createDatabase() {
  const connection = new Database(':memory:');
  connection.pragma('foreign_keys = ON');
  connection.exec(initialSchema);
  return connection;
}

test('daily cash report uses the authoritative day, totals and references', () => {
  const connection = createDatabase();
  try {
    const dayId = Number(connection.prepare(`
      INSERT INTO cash_days (date, opening_balance, is_closed, closing_balance)
      VALUES ('2026-08-18', 100, 1, 125)
    `).run().lastInsertRowid);
    const driverId = Number(connection.prepare("INSERT INTO drivers (name) VALUES ('Șofer Test')").run().lastInsertRowid);
    connection.prepare(`
      INSERT INTO cash_transactions (cash_day_id, type, category, amount, reference_id, notes, created_at)
      VALUES (?, 'IN', 'driver_collection', 30, ?, 'Traseu nord', '2026-08-18 09:15:00')
    `).run(dayId, driverId);
    connection.prepare(`
      INSERT INTO cash_transactions (cash_day_id, type, category, amount, notes, created_at)
      VALUES (?, 'OUT', 'purchase', 5, 'Făină', '2026-08-18 10:30:00')
    `).run(dayId);

    const report = getDailyCashReportSnapshot(connection, '2026-08-18', new Date(2026, 7, 18, 12));
    assert.ok(report);
    assert.equal(report.status, 'FINAL');
    assert.equal(report.canReopen, true);
    assert.equal(report.openingBalance, 100);
    assert.equal(report.totalIn, 30);
    assert.equal(report.totalOut, 5);
    assert.equal(report.netCashFlow, 25);
    assert.equal(report.balance, 125);
    assert.equal(report.transactionCount, 2);
    assert.equal(report.transactions[0].reference, 'Șofer Test');
    assert.equal(report.transactions[1].categoryLabel, 'Achiziție marfă');
    assert.deepEqual(report.categoryTotals.map((item) => [item.type, item.amount]), [['IN', 30], ['OUT', 5]]);

    recordDailyCashReportPrepared(connection, report.dayId, report.balance);
    assert.deepEqual(connection.prepare(
      'SELECT event_type, balance FROM cash_day_events WHERE cash_day_id = ?',
    ).get(dayId), { event_type: 'report_prepared', balance: 125 });
  } finally {
    connection.close();
  }
});

test('daily cash report supports an empty open day and rejects invalid dates', () => {
  const connection = createDatabase();
  try {
    connection.prepare("INSERT INTO cash_days (date, opening_balance) VALUES ('2026-08-18', 42.5)").run();
    const report = getDailyCashReportSnapshot(connection, '2026-08-18', new Date(2026, 7, 18, 12));
    assert.ok(report);
    assert.equal(report.status, 'PROVIZORIU');
    assert.equal(report.transactionCount, 0);
    assert.equal(report.balance, 42.5);
    assert.equal(getDailyCashReportSnapshot(connection, '2026-08-17'), null);
    assert.throws(() => getDailyCashReportSnapshot(connection, '../2026-08-18'), /YYYY-MM-DD/);
  } finally {
    connection.close();
  }
});
