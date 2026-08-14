import { db } from '../db';
import {
  addCashTransaction,
  closeCashDayTransaction,
  deleteCashTransaction,
  type CashTransactionInput,
} from './inventoryTransactions';

export const cashRepo = {
  // Ia ziua curenta deschisa sau creează una nouă (dacă ultima e închisă)
  getActiveDay: (createIfMissing = true) => {
    let activeDay = db.prepare('SELECT * FROM cash_days WHERE is_closed = 0 ORDER BY date DESC LIMIT 1').get() as any;
    
    if (!activeDay) {
      if (!createIfMissing) return null;
      // Trebuie să deschidem o zi nouă (azi)
      const dateStr = new Date().toISOString().split('T')[0];
      
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
    let currentBalance = activeDay.opening_balance;
    for (const t of transactions) {
      if (t.type === 'IN') currentBalance += t.amount;
      if (t.type === 'OUT') currentBalance -= t.amount;
    }
    
    return { ...activeDay, current_balance: currentBalance };
  },

  closeDay: (dayId: number, closingBalance: number) => {
    return closeCashDayTransaction(db, dayId, closingBalance);
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
    let query = `
      SELECT t.*, 
             d.name as driver_name, 
             e.name as employee_name,
             c.date as cash_date
      FROM cash_transactions t
      JOIN cash_days c ON t.cash_day_id = c.id
      LEFT JOIN drivers d ON (t.category = 'driver_collection' AND t.reference_id = d.id)
      LEFT JOIN employees e ON ((t.category = 'direct_sale' OR t.category = 'employee_collection') AND t.reference_id = e.id)
      WHERE c.date >= ? AND c.date <= ?
    `;
    const params: any[] = [startDate, endDate];
    
    if (category) {
      if (category === 'purchase_or_expense') {
        query += ` AND (t.category = 'purchase' OR t.category = 'other_expense')`;
      } else {
        query += ` AND t.category = ?`;
        params.push(category);
      }
    }
    
    query += ` ORDER BY t.created_at DESC`;
    
    return db.prepare(query).all(...params) as any[];
  },

  getHistoricalZReports: (startDate: string, endDate: string) => {
    return db.prepare(`
      SELECT * FROM cash_days 
      WHERE date >= ? AND date <= ? AND is_closed = 1
      ORDER BY date DESC
    `).all(startDate, endDate) as any[];
  },

  addTransaction: (data: CashTransactionInput) => {
    return addCashTransaction(db, data);
  },

  deleteTransaction: (transactionId: number) => {
    return deleteCashTransaction(db, transactionId);
  }
};
