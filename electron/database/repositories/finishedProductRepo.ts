import { db } from '../db';
import type { VrBakerProduct } from '../../integrations/vrBakerApiClient';
import { syncFinishedProductCatalog } from '../finishedProductCatalog';

export const finishedProductRepo = {
  getAll: () => {
    const rows = db.prepare(`
      SELECT fp.*, COALESCE(c.name, fp.source_category) as category_name,
             cp.name AS catalog_name, cp.name_ro AS catalog_name_ro
      FROM finished_products fp
      LEFT JOIN categories c ON fp.category_id = c.id
      LEFT JOIN cloud_products cp ON cp.supabase_product_id = fp.external_product_id
      WHERE fp.is_active = 1
      ORDER BY fp.name ASC
    `).all() as any[];
    return rows.map(({ catalog_name, catalog_name_ro, ...row }) => ({
      ...row,
      name: catalog_name || row.name,
      name_ro: catalog_name_ro || row.name_ro || catalog_name || row.name,
    }));
  },
  
  getById: (id: number) => {
    const result = db.prepare(`
      SELECT fp.*, cp.name AS catalog_name, cp.name_ro AS catalog_name_ro
      FROM finished_products fp LEFT JOIN cloud_products cp ON cp.supabase_product_id = fp.external_product_id
      WHERE fp.id = ?
    `).get(id) as any;
    if (!result) return result;
    const { catalog_name, catalog_name_ro, ...row } = result;
    return { ...row, name: catalog_name || row.name, name_ro: catalog_name_ro || row.name_ro || catalog_name || row.name };
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
  },

  syncFromVrBaker: (products: VrBakerProduct[]) => syncFinishedProductCatalog(db, products),
};
