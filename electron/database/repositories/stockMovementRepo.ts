import { db } from '../db';

export const stockMovementRepo = {
  getAll: (limit: number = 100) => {
    return db.prepare(`
      SELECT sm.*, rm.name as raw_material_name, rm.unit
      FROM stock_movements sm
      JOIN raw_materials rm ON sm.raw_material_id = rm.id
      ORDER BY sm.created_at DESC
      LIMIT ?
    `).all(limit);
  },

  adjustStock: (rawMaterialId: number, newStock: number, reason: string) => {
    const transaction = db.transaction(() => {
      const currentStockRow = db.prepare('SELECT current_stock FROM raw_materials WHERE id = ?').get(rawMaterialId) as { current_stock: number };
      if (!currentStockRow) throw new Error("Materia primă nu există!");
      
      const stockBefore = currentStockRow.current_stock;
      const delta = newStock - stockBefore;
      
      if (delta === 0) return true; // nothing to do

      // Update raw material stock
      db.prepare('UPDATE raw_materials SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(newStock, rawMaterialId);

      // Record adjustment
      const adjResult = db.prepare(`
        INSERT INTO stock_adjustments (raw_material_id, quantity_delta, reason)
        VALUES (?, ?, ?)
      `).run(rawMaterialId, delta, reason);

      // Record movement
      db.prepare(`
        INSERT INTO stock_movements (raw_material_id, movement_type, quantity, stock_before, stock_after, reference_type, reference_id, notes)
        VALUES (?, 'ajustare', ?, ?, ?, 'manual', ?, ?)
      `).run(rawMaterialId, Math.abs(delta), stockBefore, newStock, adjResult.lastInsertRowid, reason);

      return true;
    });

    return transaction();
  }
};
