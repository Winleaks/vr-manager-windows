import { db } from '../db';
import { createProductionTransaction } from './inventoryTransactions';

export const productionRepo = {
  getAll: () => {
    return db.prepare(`
      SELECT p.*, COALESCE(NULLIF(cp.name, ''), fp.name) as product_name, fp.production_unit
      FROM productions p
      JOIN finished_products fp ON p.finished_product_id = fp.id
      LEFT JOIN cloud_products cp ON cp.supabase_product_id = fp.external_product_id
      ORDER BY p.production_date DESC, p.created_at DESC
    `).all();
  },

  create: (productId: number, quantity: number, date: string, notes: string) => {
    return createProductionTransaction(db, productId, quantity, date, notes);
  }
};
