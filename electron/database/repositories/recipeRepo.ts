import { db } from '../db';
import { optionalText, requireFinitePositive, requirePositiveInteger } from '../businessValidation';

interface RecipeIdRow { id: number }

export const recipeRepo = {
  getByProductId: (productId: number) => {
    const recipe = db.prepare('SELECT * FROM recipes WHERE finished_product_id = ?').get(productId) as (RecipeIdRow & Record<string, unknown>) | undefined;
    
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
    const validProductId = requirePositiveInteger(productId, 'Produsul finit');
    const validBatchSize = requireFinitePositive(batchSize, 'Mărimea lotului');
    const validNotes = optionalText(notes, 'Observațiile rețetei');
    if (!Array.isArray(items) || items.length === 0) throw new Error('Rețeta trebuie să conțină cel puțin o materie primă.');

    const validatedItems = items.map((item) => ({
      raw_material_id: requirePositiveInteger(item.raw_material_id, 'Materia primă'),
      quantity: requireFinitePositive(item.quantity, 'Cantitatea materiei prime'),
    }));
    if (new Set(validatedItems.map((item) => item.raw_material_id)).size !== validatedItems.length) {
      throw new Error('Aceeași materie primă nu poate apărea de mai multe ori în rețetă.');
    }

    const transaction = db.transaction(() => {
      const product = db.prepare('SELECT id FROM finished_products WHERE id = ? AND is_active = 1').get(validProductId);
      if (!product) throw new Error('Produsul finit nu există sau este inactiv.');
      const materialExists = db.prepare('SELECT id FROM raw_materials WHERE id = ?');
      for (const item of validatedItems) {
        if (!materialExists.get(item.raw_material_id)) throw new Error('O materie primă din rețetă nu există.');
      }

      // Check if recipe exists
      const recipe = db.prepare('SELECT id FROM recipes WHERE finished_product_id = ?').get(validProductId) as RecipeIdRow | undefined;
      let recipeId: number | bigint;
      
      if (recipe) {
        recipeId = recipe.id;
        db.prepare('UPDATE recipes SET batch_size = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(validBatchSize, validNotes, recipeId);
        // Delete old items
        db.prepare('DELETE FROM recipe_items WHERE recipe_id = ?').run(recipeId);
      } else {
        const result = db.prepare(`
          INSERT INTO recipes (finished_product_id, batch_size, notes)
          VALUES (?, ?, ?)
        `).run(validProductId, validBatchSize, validNotes);
        recipeId = result.lastInsertRowid;
      }
      
      // Insert new items
      const insertItem = db.prepare(`
        INSERT INTO recipe_items (recipe_id, raw_material_id, quantity)
        VALUES (?, ?, ?)
      `);
      
      for (const item of validatedItems) {
        insertItem.run(recipeId, item.raw_material_id, item.quantity);
      }
      
      return recipeId;
    });
    
    return transaction();
  }
};
