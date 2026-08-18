import { db } from '../db';
import { getCashTransactionsByDateRange } from '../cashHistory.ts';
import { rolloverCashDay } from '../cashDayRollover.ts';
import { getDailyCashReportSnapshot, recordDailyCashReportPrepared } from '../dailyCashReport.ts';
import {
  addCashTransaction,
  closeCashDayTransaction,
  deleteCashTransaction,
  initializeCashBalanceOnce,
  reopenCashDayTransaction,
  updateCashReceiptTransaction,
  type CashReceiptUpdateInput,
  type CashTransactionInput,
} from './inventoryTransactions';

export const cashRepo = {
  // Ia ziua curenta deschisa sau creează una nouă (dacă ultima e închisă)
  getActiveDay: (createIfMissing = true) => {
    if (createIfMissing) rolloverCashDay(db);
    const activeDay = db.prepare('SELECT * FROM cash_days WHERE is_closed = 0 ORDER BY date DESC LIMIT 1').get() as any;
    if (!activeDay) return null;

    // Calculăm soldul live din tranzacțiile zilei
    const transactions = cashRepo.getTransactions(activeDay.id);
    let currentBalance = Number(activeDay.opening_balance);
    for (const t of transactions) {
      if (t.type === 'IN') currentBalance += Number(t.amount);
      if (t.type === 'OUT') currentBalance -= Number(t.amount);
    }
    currentBalance = Math.round(currentBalance * 100) / 100;
    
    const balanceInitialization = db.prepare(
      "SELECT value FROM app_settings WHERE key = 'daily_cash_balance_initialized_v1'",
    ).get();
    return { ...activeDay, current_balance: currentBalance, balance_initialized: Boolean(balanceInitialization) };
  },

  closeDay: (dayId: number) => {
    return closeCashDayTransaction(db, dayId);
  },

  reopenDay: (dayId: number) => {
    return reopenCashDayTransaction(db, dayId);
  },

  initializeBalance: (dayId: number, actualBalance: number) => {
    return initializeCashBalanceOnce(db, dayId, actualBalance);
  },

  updateReceipt: (data: CashReceiptUpdateInput) => {
    return updateCashReceiptTransaction(db, data);
  },

  getTransactions: (dayId: number) => {
    return db.prepare(`
      SELECT t.*, 
             d.name as driver_name, 
             e.name as employee_name
      FROM cash_transactions t
      LEFT JOIN drivers d ON (t.category = 'driver_collection' AND t.reference_id = d.id)
      LEFT JOIN employees e ON ((t.category = 'direct_sale' OR t.category = 'employee_collection') AND t.reference_id = e.id)
      WHERE t.cash_day_id = ?
      ORDER BY t.created_at DESC
    `).all(dayId) as any[];
  },

  getTransactionsByDateRange: (startDate: string, endDate: string, category?: string) => {
    return getCashTransactionsByDateRange(db, startDate, endDate, category);
  },

  getHistoricalZReports: (startDate: string, endDate: string) => {
    return db.prepare(`
      SELECT * FROM cash_days 
      WHERE date >= ? AND date <= ? AND is_closed = 1
      ORDER BY date DESC
    `).all(startDate, endDate) as any[];
  },

  getDailyReport: (date: string) => {
    return getDailyCashReportSnapshot(db, date);
  },

  recordReportPrepared: (dayId: number, balance: number) => {
    return recordDailyCashReportPrepared(db, dayId, balance);
  },

  addTransaction: (data: CashTransactionInput) => {
    const currentDay = cashRepo.getActiveDay(true);
    if (!currentDay) throw new Error('Ziua de casă pentru astăzi este închisă. Redeschide ziua înainte de a adăuga tranzacții.');
    return addCashTransaction(db, { ...data, cash_day_id: currentDay.id });
  },

  deleteTransaction: (transactionId: number) => {
    return deleteCashTransaction(db, transactionId);
  }
};
