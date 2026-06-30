import { db } from '../db';

export const finishedProductRepo = {
  getAll: () => {
    return db.prepare(`
      SELECT fp.*, c.name as category_name 
      FROM finished_products fp
      LEFT JOIN categories c ON fp.category_id = c.id
      WHERE fp.is_active = 1
      ORDER BY fp.name ASC
    `).all();
  },
  
  getById: (id: number) => {
    return db.prepare('SELECT * FROM finished_products WHERE id = ?').get(id);
  },
  
  create: (data: any) => {
    const stmt = db.prepare(`
      INSERT INTO finished_products (name, category_id, production_unit, notes)
      VALUES (@name, @category_id, @production_unit, @notes)
    `);
    const result = stmt.run({
      name: data.name,
      category_id: data.category_id || null,
      production_unit: data.production_unit || 'buc',
      notes: data.notes || null
    });
    return result.lastInsertRowid;
  },
  
  update: (id: number, data: any) => {
    const stmt = db.prepare(`
      UPDATE finished_products 
      SET name = @name, category_id = @category_id, production_unit = @production_unit, 
          notes = @notes, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `);
    stmt.run({
      id,
      name: data.name,
      category_id: data.category_id || null,
      production_unit: data.production_unit || 'buc',
      notes: data.notes || null
    });
    return true;
  },
  
  delete: (id: number) => {
    // Soft delete
    db.prepare('UPDATE finished_products SET is_active = 0 WHERE id = ?').run(id);
    return true;
  }
};
