import type Database from 'better-sqlite3';
import { requireIsoDate } from './businessValidation.ts';

type SqliteDatabase = Database.Database;

export function getCashTransactionsByDateRange(
  connection: SqliteDatabase,
  startDateInput: unknown,
  endDateInput: unknown,
  categoryInput?: unknown,
) {
  const startDate = requireIsoDate(startDateInput, 'Data de început');
  const endDate = requireIsoDate(endDateInput, 'Data de sfârșit');
  if (startDate > endDate) throw new Error('Perioada selectată nu este validă.');
  if (categoryInput !== undefined && typeof categoryInput !== 'string') {
    throw new Error('Categoria tranzacției nu este validă.');
  }

  const linked = Boolean(connection.prepare("SELECT 1 FROM sqlite_master WHERE name='driver_cash_receipts'").get());
  let query = `
    SELECT t.*, ${linked ? 'r.amount_pence AS driver_cash_amount_pence, r.revision AS driver_cash_revision, ds.name AS driver_cash_store_name, dc.name AS driver_cash_company_name,' : ''}
           d.name as driver_name,
           e.name as employee_name,
           c.date as cash_date,
           date(t.created_at, 'localtime') as transaction_date,
           c.is_closed as cash_day_closed
    FROM cash_transactions t
    JOIN cash_days c ON t.cash_day_id = c.id
    ${linked ? 'LEFT JOIN driver_cash_receipts r ON r.root_id=t.driver_cash_root LEFT JOIN stores ds ON ds.id=r.store_id LEFT JOIN companies dc ON dc.id=r.company_id' : ''}
    LEFT JOIN drivers d ON (t.category = 'driver_collection' AND t.reference_id = d.id)
    LEFT JOIN employees e ON ((t.category = 'direct_sale' OR t.category = 'employee_collection') AND t.reference_id = e.id)
    WHERE date(t.created_at, 'localtime') >= ? AND date(t.created_at, 'localtime') <= ?
  `;
  const params: Array<string> = [startDate, endDate];

  if (categoryInput) {
    if (categoryInput === 'driver_collection') {
      query += ` AND t.category IN ('driver_collection', 'other_collection')`;
    } else if (categoryInput === 'purchase_or_expense') {
      query += ` AND (t.category = 'purchase' OR t.category = 'other_expense')`;
    } else {
      query += ' AND t.category = ?';
      params.push(categoryInput);
    }
  }

  query += ' ORDER BY t.created_at DESC';
  return connection.prepare(query).all(...params) as any[];
}
