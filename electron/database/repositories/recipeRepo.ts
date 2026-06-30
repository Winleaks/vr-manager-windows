import { db } from '../db';

export const recipeRepo = {
  getByProductId: (productId: number) => {
    const recipe = db.prepare('SELECT * FROM recipes WHERE finished_product_id = ?').get(productId);
    
    if (!recipe) return null;
    
    const items = db.prepare(`
      SELECT ri.*, rm.name as raw_material_name, rm.unit as raw_material_unit
      FROM recipe_items ri
      JOIN raw_materials rm ON ri.raw_material_id = rm.id
      WHERE ri.recipe_id = ?
    `).all(recipe.id);
    
    return {
      ...recipe,
      items
    };
  },
  
  saveRecipe: (productId: number, batchSize: number, notes: string, items: {raw_material_id: number, quantity: number}[]) => {
    
    const transaction = db.transaction(() => {
      // Check if recipe exists
      let recipe = db.prepare('SELECT id FROM recipes WHERE finished_product_id = ?').get(productId);
      let recipeId;
      
      if (recipe) {
        recipeId = recipe.id;
        db.prepare('UPDATE recipes SET batch_size = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(batchSize, notes, recipeId);
        // Delete old items
        db.prepare('DELETE FROM recipe_items WHERE recipe_id = ?').run(recipeId);
      } else {
        const result = db.prepare(`
          INSERT INTO recipes (finished_product_id, batch_size, notes)
          VALUES (?, ?, ?)
        `).run(productId, batchSize, notes);
        recipeId = result.lastInsertRowid;
      }
      
      // Insert new items
      const insertItem = db.prepare(`
        INSERT INTO recipe_items (recipe_id, raw_material_id, quantity)
        VALUES (?, ?, ?)
      `);
      
      for (const item of items) {
        insertItem.run(recipeId, item.raw_material_id, item.quantity);
      }
      
      return recipeId;
    });
    
    return transaction();
  }
};
