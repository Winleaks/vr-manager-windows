import { db } from '../db';
import { createProductionTransaction } from './inventoryTransactions';
import { productDisplayName } from '../productDisplayName';

export const productionRepo = {
  getAll: () => {
    const rows = db.prepare(`
      SELECT p.*, COALESCE(NULLIF(cp.name, ''), fp.name) as product_name, cp.variant_label, fp.production_unit
      FROM productions p
      JOIN finished_products fp ON p.finished_product_id = fp.id
      LEFT JOIN cloud_products cp ON cp.supabase_product_id = fp.external_product_id
      ORDER BY p.production_date DESC, p.created_at DESC
    `).all() as Array<{ product_name: string; variant_label: string | null }>;
    return rows.map(row => ({ ...row, product_name: productDisplayName(row.product_name, row.variant_label) }));
  },

  create: (productId: number, quantity: number, date: string, notes: string) => {
    return createProductionTransaction(db, productId, quantity, date, notes);
  }
};
