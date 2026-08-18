import { db } from '../db';
import { getCashTransactionsByDateRange } from '../cashHistory.ts';
import { localIsoDate, rolloverCashDay } from '../cashDayRollover.ts';
import {
  addCashTransaction,
  closeCashDayTransaction,
  deleteCashTransaction,
  initializeCashBalanceOnce,
  updateCashReceiptTransaction,
  type CashReceiptUpdateInput,
  type CashTransactionInput,
} from './inventoryTransactions';

export const cashRepo = {
  // Ia ziua curenta deschisa sau creează una nouă (dacă ultima e închisă)
  getActiveDay: (createIfMissing = true) => {
    if (createIfMissing) rolloverCashDay(db);
    let activeDay = db.prepare('SELECT * FROM cash_days WHERE is_closed = 0 ORDER BY date DESC LIMIT 1').get() as any;
    
    if (!activeDay) {
      if (!createIfMissing) return null;
      // Trebuie să deschidem o zi nouă (azi)
      const dateStr = localIsoDate();
      
      // Vedem dacă s-a deschis deja azi și s-a închis (preventiv, ca să nu avem erori la unique date, deși în mod normal se face doar una pe zi)
      // Dacă s-a închis deja azi, ar trebui tratată altfel, dar pt simplitate, creăm una nouă (dacă e altă zi).
      // Aflăm ultimul sold de închidere
      const lastClosedDay = db.prepare('SELECT closing_balance FROM cash_days WHERE is_closed = 1 ORDER BY date DESC LIMIT 1').get() as any;
      const openingBalance = lastClosedDay ? lastClosedDay.closing_balance : 0;

      try {
        const stmt = db.prepare(`
          INSERT INTO cash_days (date, opening_balance)
          VALUES (?, ?)
        `);
        const info = stmt.run(dateStr, openingBalance);
        activeDay = db.prepare('SELECT * FROM cash_days WHERE id = ?').get(info.lastInsertRowid);
      } catch (e: any) {
        const existingDay = db.prepare('SELECT * FROM cash_days WHERE date = ?').get(dateStr) as any;
        if (existingDay?.is_closed) throw new Error('Ziua de casă pentru astăzi este deja închisă.');
        if (!existingDay) throw e;
        activeDay = existingDay;
      }
    }

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

  closeDay: (dayId: number, closingBalance: number) => {
    return closeCashDayTransaction(db, dayId, closingBalance);
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

  addTransaction: (data: CashTransactionInput) => {
    const currentDay = cashRepo.getActiveDay(true);
    return addCashTransaction(db, { ...data, cash_day_id: currentDay.id });
  },

  deleteTransaction: (transactionId: number) => {
    return deleteCashTransaction(db, transactionId);
  }
};
