import type Database from 'better-sqlite3';
import { requireIsoDate } from './businessValidation.ts';

type SqliteDatabase = Database.Database;

interface CashDayRow {
  id: number;
  date: string;
  opening_balance: number;
  is_closed: number;
}

export function localIsoDate(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function millisecondsUntilNextLocalMidnight(value = new Date()) {
  const midnight = new Date(value);
  midnight.setHours(24, 0, 0, 0);
  return Math.max(1, midnight.getTime() - value.getTime());
}

export function rolloverCashDay(connection: SqliteDatabase, todayInput = localIsoDate()) {
  const today = requireIsoDate(todayInput, 'Data curentă');

  return connection.transaction(() => {
    const openDays = connection.prepare(
      'SELECT id, date, opening_balance, is_closed FROM cash_days WHERE is_closed = 0 ORDER BY date',
    ).all() as CashDayRow[];
    if (openDays.length > 1) {
      throw new Error('Există mai multe zile de casă deschise. Închiderea automată a fost oprită pentru protejarea datelor.');
    }

    const activeDay = openDays[0];
    if (!activeDay || activeDay.date === today) {
      return { rolledOver: false, currentDayId: activeDay?.id || null, movedTransactions: 0 };
    }
    if (activeDay.date > today) {
      throw new Error('Data zilei de casă deschise este în viitor. Verifică data și ora calculatorului.');
    }

    const existingToday = connection.prepare(
      'SELECT id, date, opening_balance, is_closed FROM cash_days WHERE date = ?',
    ).get(today) as CashDayRow | undefined;
    if (existingToday?.is_closed) {
      throw new Error('Ziua de casă pentru astăzi este deja închisă.');
    }

    // Operațiunile înregistrate astăzi într-o sesiune veche trebuie să aparțină zilei curente.
    const totals = connection.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'IN' THEN amount ELSE 0 END), 0) AS total_in,
        COALESCE(SUM(CASE WHEN type = 'OUT' THEN amount ELSE 0 END), 0) AS total_out
      FROM cash_transactions
      WHERE cash_day_id = ? AND date(created_at, 'localtime') <> ?
    `).get(activeDay.id, today) as { total_in: number; total_out: number };
    const closingBalance = Math.round(
      (Number(activeDay.opening_balance) + Number(totals.total_in) - Number(totals.total_out)) * 100,
    ) / 100;

    connection.prepare(`
      UPDATE cash_days
      SET is_closed = 1, closing_balance = ?, closed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND is_closed = 0
    `).run(closingBalance, activeDay.id);

    let currentDayId = existingToday?.id;
    if (!currentDayId) {
      currentDayId = Number(connection.prepare(`
        INSERT INTO cash_days (date, opening_balance) VALUES (?, ?)
      `).run(today, closingBalance).lastInsertRowid);
    }

    const movedTransactions = connection.prepare(`
      UPDATE cash_transactions
      SET cash_day_id = ?
      WHERE cash_day_id = ? AND date(created_at, 'localtime') = ?
    `).run(currentDayId, activeDay.id, today).changes;

    return { rolledOver: true, currentDayId, movedTransactions };
  })();
}
