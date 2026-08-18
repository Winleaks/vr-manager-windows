import type Database from 'better-sqlite3';
import { requireIsoDate, requirePositiveInteger } from './businessValidation.ts';
import { localIsoDate } from './cashDayRollover.ts';

type SqliteDatabase = Database.Database;

export const DAILY_CASH_CATEGORY_LABELS: Record<string, string> = {
  driver_collection: 'Încasare șofer',
  direct_sale: 'Vânzare directă',
  purchase: 'Achiziție marfă',
  other_expense: 'Alte cheltuieli',
  cash_collection: 'Colectare cash',
  employee_collection: 'Încasare angajat',
  cash_adjustment: 'Ajustare sold',
};

export interface DailyCashReportTransaction {
  id: number;
  time: string;
  type: 'IN' | 'OUT';
  category: string;
  categoryLabel: string;
  reference: string;
  notes: string;
  amount: number;
}

export interface DailyCashCategoryTotal {
  category: string;
  label: string;
  type: 'IN' | 'OUT';
  amount: number;
}

export interface DailyCashReportSnapshot {
  dayId: number;
  date: string;
  status: 'PROVIZORIU' | 'FINAL';
  isClosed: boolean;
  canReopen: boolean;
  generatedAt: string;
  openingBalance: number;
  totalIn: number;
  totalOut: number;
  netCashFlow: number;
  balance: number;
  transactionCount: number;
  categoryTotals: DailyCashCategoryTotal[];
  transactions: DailyCashReportTransaction[];
}

interface CashDayRow {
  id: number;
  date: string;
  opening_balance: number;
  closing_balance: number | null;
  is_closed: number;
}

function money(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function getDailyCashReportSnapshot(
  connection: SqliteDatabase,
  dateInput: unknown,
  now = new Date(),
): DailyCashReportSnapshot | null {
  const date = requireIsoDate(dateInput, 'Data raportului');
  const day = connection.prepare(`
    SELECT id, date, opening_balance, closing_balance, is_closed
    FROM cash_days
    WHERE date = ?
  `).get(date) as CashDayRow | undefined;
  if (!day) return null;

  const rows = connection.prepare(`
    SELECT
      t.id,
      t.type,
      t.category,
      t.amount,
      COALESCE(d.name, e.name, t.reference_name, '') AS reference,
      COALESCE(t.notes, '') AS notes,
      strftime('%H:%M', t.created_at, 'localtime') AS local_time
    FROM cash_transactions t
    LEFT JOIN drivers d ON t.category = 'driver_collection' AND t.reference_id = d.id
    LEFT JOIN employees e ON t.category IN ('direct_sale', 'employee_collection') AND t.reference_id = e.id
    WHERE t.cash_day_id = ?
    ORDER BY t.created_at ASC, t.id ASC
  `).all(day.id) as Array<{
    id: number;
    type: 'IN' | 'OUT';
    category: string;
    amount: number;
    reference: string;
    notes: string;
    local_time: string | null;
  }>;

  let totalIn = 0;
  let totalOut = 0;
  const categoryTotals = new Map<string, DailyCashCategoryTotal>();
  const transactions = rows.map((row) => {
    const amount = money(row.amount);
    if (row.type === 'IN') totalIn += amount;
    if (row.type === 'OUT') totalOut += amount;
    const key = `${row.type}:${row.category}`;
    const existing = categoryTotals.get(key);
    categoryTotals.set(key, {
      category: row.category,
      label: DAILY_CASH_CATEGORY_LABELS[row.category] || row.category,
      type: row.type,
      amount: money((existing?.amount || 0) + amount),
    });
    return {
      id: row.id,
      time: row.local_time || '--:--',
      type: row.type,
      category: row.category,
      categoryLabel: DAILY_CASH_CATEGORY_LABELS[row.category] || row.category,
      reference: row.reference,
      notes: row.notes,
      amount,
    };
  });

  totalIn = money(totalIn);
  totalOut = money(totalOut);
  const netCashFlow = money(totalIn - totalOut);
  const calculatedBalance = money(Number(day.opening_balance) + netCashFlow);
  const isClosed = Boolean(day.is_closed);
  const balance = isClosed && day.closing_balance !== null
    ? money(day.closing_balance)
    : calculatedBalance;

  return {
    dayId: day.id,
    date: day.date,
    status: isClosed ? 'FINAL' : 'PROVIZORIU',
    isClosed,
    canReopen: isClosed && day.date === localIsoDate(now),
    generatedAt: now.toISOString(),
    openingBalance: money(day.opening_balance),
    totalIn,
    totalOut,
    netCashFlow,
    balance,
    transactionCount: transactions.length,
    categoryTotals: Array.from(categoryTotals.values()),
    transactions,
  };
}

export function recordDailyCashReportPrepared(connection: SqliteDatabase, dayIdInput: unknown, balanceInput: unknown) {
  const dayId = requirePositiveInteger(dayIdInput, 'Ziua de casă');
  if (typeof balanceInput !== 'number' || !Number.isFinite(balanceInput)) {
    throw new Error('Soldul raportului nu este valid.');
  }
  const day = connection.prepare('SELECT id FROM cash_days WHERE id = ?').get(dayId);
  if (!day) throw new Error('Ziua de casă nu există.');
  connection.prepare(`
    INSERT INTO cash_day_events (cash_day_id, event_type, balance)
    VALUES (?, 'report_prepared', ?)
  `).run(dayId, money(balanceInput));
}
