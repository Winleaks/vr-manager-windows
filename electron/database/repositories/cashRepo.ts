import { db } from '../db';

export const cashRepo = {
  // Ia ziua curenta deschisa sau creează una nouă (dacă ultima e închisă)
  getActiveDay: () => {
    let activeDay = db.prepare('SELECT * FROM cash_days WHERE is_closed = 0 ORDER BY date DESC LIMIT 1').get() as any;
    
    if (!activeDay) {
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
         // Dacă există deja (unique constraint), o luăm pe aia
         activeDay = db.prepare('SELECT * FROM cash_days WHERE date = ?').get(dateStr);
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
    db.prepare(`
      UPDATE cash_days 
      SET is_closed = 1, closing_balance = ?, closed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(closingBalance, dayId);
    return true;
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

  addTransaction: (data: {
    cash_day_id: number;
    type: 'IN' | 'OUT';
    category: string;
    amount: number;
    reference_id?: number | null;
    reference_name?: string | null;
    notes?: string | null;
    items?: { finished_product_id: number, quantity: number, unit_price: number }[];
  }) => {
    const transaction = db.transaction(() => {
      // 1. Inserăm tranzacția
      const stmt = db.prepare(`
        INSERT INTO cash_transactions (cash_day_id, type, category, amount, reference_id, reference_name, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        data.cash_day_id, 
        data.type, 
        data.category, 
        data.amount, 
        data.reference_id || null, 
        data.reference_name || null, 
        data.notes || null
      );
      const transactionId = info.lastInsertRowid;

      // 2. Dacă sunt items (ex. vânzare directă), scădem stocul produselor finite
      if (data.items && data.items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO cash_transaction_items (transaction_id, finished_product_id, quantity, unit_price)
          VALUES (?, ?, ?, ?)
        `);
        const updateProductStock = db.prepare(`
          UPDATE finished_products SET current_stock = current_stock - ? WHERE id = ?
        `);
        const getProductStock = db.prepare(`SELECT current_stock FROM finished_products WHERE id = ?`);
        const insertMovement = db.prepare(`
          INSERT INTO finished_product_movements (finished_product_id, movement_type, quantity, stock_before, stock_after, reference_type, reference_id, notes)
          VALUES (?, 'vanzare', ?, ?, ?, 'cash_transaction', ?, ?)
        `);

        for (const item of data.items) {
          insertItem.run(transactionId, item.finished_product_id, item.quantity, item.unit_price);
          
          const currentStockRow = getProductStock.get(item.finished_product_id) as any;
          const stockBefore = currentStockRow ? currentStockRow.current_stock : 0;
          const stockAfter = stockBefore - item.quantity;

          updateProductStock.run(item.quantity, item.finished_product_id);
          
          insertMovement.run(
            item.finished_product_id,
            item.quantity,
            stockBefore,
            stockAfter,
            transactionId,
            `Vânzare cash (Tranzacția #${transactionId})`
          );
        }
      }

      return transactionId;
    });

    return transaction();
  },

  deleteTransaction: (transactionId: number) => {
    const runDelete = db.transaction(() => {
      // 1. Preluăm item-ele tranzacției dacă a existat o scădere de stoc pentru produse finite
      const items = db.prepare('SELECT * FROM cash_transaction_items WHERE transaction_id = ?').all(transactionId) as any[];
      for (const item of items) {
        db.prepare('UPDATE finished_products SET current_stock = current_stock + ? WHERE id = ?').run(item.quantity, item.finished_product_id);
      }
      db.prepare('DELETE FROM finished_product_movements WHERE reference_type = "cash_transaction" AND reference_id = ?').run(transactionId);
      db.prepare('DELETE FROM cash_transaction_items WHERE transaction_id = ?').run(transactionId);
      db.prepare('DELETE FROM cash_transactions WHERE id = ?').run(transactionId);
    });
    runDelete();
    return true;
  }
};
