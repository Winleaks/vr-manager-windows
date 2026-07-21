import { db } from '../db';

export const productionRepo = {
  getAll: () => {
    return db.prepare(`
      SELECT p.*, fp.name as product_name, fp.production_unit
      FROM productions p
      JOIN finished_products fp ON p.finished_product_id = fp.id
      ORDER BY p.production_date DESC, p.created_at DESC
    `).all();
  },

  create: (productId: number, quantity: number, date: string, notes: string) => {
    
    const transaction = db.transaction(() => {
      // 1. Get Recipe for Product
      const recipe = db.prepare('SELECT id, batch_size FROM recipes WHERE finished_product_id = ?').get(productId);
      if (!recipe) {
        throw new Error('Produsul nu are o rețetă definită!');
      }

      // 2. Insert Production Record
      const insertProduction = db.prepare(`
        INSERT INTO productions (finished_product_id, quantity_produced, production_date, notes)
        VALUES (?, ?, ?, ?)
      `);
      const prodResult = insertProduction.run(productId, quantity, date, notes);
      const productionId = prodResult.lastInsertRowid;

      // 2.5 Update Finished Product Stock
      const updateFinishedProductStock = db.prepare('UPDATE finished_products SET current_stock = current_stock + ? WHERE id = ?');
      updateFinishedProductStock.run(quantity, productId);
      
      const getFinishedProductStock = db.prepare('SELECT current_stock FROM finished_products WHERE id = ?');
      const fpStockRow = getFinishedProductStock.get(productId) as any;
      const stockAfterFp = fpStockRow ? fpStockRow.current_stock : quantity;
      const stockBeforeFp = stockAfterFp - quantity;

      const insertFpMovement = db.prepare(`
        INSERT INTO finished_product_movements (finished_product_id, movement_type, quantity, stock_before, stock_after, reference_type, reference_id, notes)
        VALUES (?, 'productie', ?, ?, ?, 'production', ?, ?)
      `);
      insertFpMovement.run(
        productId,
        quantity,
        stockBeforeFp,
        stockAfterFp,
        productionId,
        `Producție #${productionId}`
      );

      // 3. Calculate consumption
      const recipeItems = db.prepare(`
        SELECT raw_material_id, quantity 
        FROM recipe_items 
        WHERE recipe_id = ?
      `).all(recipe.id);

      const multiplier = quantity / recipe.batch_size;

      const updateStock = db.prepare(`
        UPDATE raw_materials 
        SET current_stock = current_stock - ? 
        WHERE id = ?
      `);

      const getStock = db.prepare('SELECT current_stock FROM raw_materials WHERE id = ?');

      const insertMovement = db.prepare(`
        INSERT INTO stock_movements (raw_material_id, movement_type, quantity, stock_before, stock_after, reference_type, reference_id, notes)
        VALUES (?, 'consum', ?, ?, ?, 'productie', ?, ?)
      `);

      // 4. Update Stock and Record Movements
      for (const item of recipeItems) {
        const consumedQuantity = item.quantity * multiplier;
        const currentStockRow = getStock.get(item.raw_material_id);
        const stockBefore = currentStockRow ? currentStockRow.current_stock : 0;
        const stockAfter = stockBefore - consumedQuantity;

        updateStock.run(consumedQuantity, item.raw_material_id);

        insertMovement.run(
          item.raw_material_id, 
          consumedQuantity, 
          stockBefore, 
          stockAfter, 
          productionId, 
          `Consum producție #${productionId}`
        );
      }

      return productionId;
    });

    return transaction();
  }
};
