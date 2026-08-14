import { db } from '../db';
import { adjustRawMaterialStockTransaction } from './inventoryTransactions';

export const stockMovementRepo = {
  getAll: (limit: number = 100) => {
    const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 1000) : 100;
    return db.prepare(`
      SELECT sm.*, rm.name as raw_material_name, rm.unit
      FROM stock_movements sm
      JOIN raw_materials rm ON sm.raw_material_id = rm.id
      ORDER BY sm.created_at DESC
      LIMIT ?
    `).all(safeLimit);
  },

  adjustStock: (rawMaterialId: number, newStock: number, reason: string) => {
    return adjustRawMaterialStockTransaction(db, rawMaterialId, newStock, reason);
  }
};
