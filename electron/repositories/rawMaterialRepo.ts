import { db } from '../database/db'

export interface RawMaterial {
  id?: number
  name: string
  category_id?: number | null
  unit: string
  current_stock: number
  minimum_stock: number
  supplier_id?: number | null
  notes?: string | null
  created_at?: string
  updated_at?: string
  category_name?: string
}

export function getAllRawMaterials() {
  return db.prepare(`
    SELECT r.*, c.name as category_name 
    FROM raw_materials r
    LEFT JOIN categories c ON r.category_id = c.id
    ORDER BY r.name ASC
  `).all()
}

export function addRawMaterial(rm: RawMaterial) {
  const transaction = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO raw_materials (name, category_id, unit, current_stock, minimum_stock, supplier_id, notes)
      VALUES (@name, @category_id, @unit, @current_stock, @minimum_stock, @supplier_id, @notes)
    `)
    const initialStock = rm.current_stock || 0
    const result = stmt.run({
      name: rm.name,
      category_id: rm.category_id || null,
      unit: rm.unit,
      current_stock: initialStock,
      minimum_stock: rm.minimum_stock || 0,
      supplier_id: rm.supplier_id || null,
      notes: rm.notes || null
    })

    const newId = result.lastInsertRowid
    if (initialStock > 0) {
      const reason = rm.notes ? `Stoc inițial (${rm.notes})` : 'Stoc inițial la adăugare materie primă'
      const adjResult = db.prepare(`
        INSERT INTO stock_adjustments (raw_material_id, quantity_delta, reason)
        VALUES (?, ?, ?)
      `).run(newId, initialStock, reason)

      db.prepare(`
        INSERT INTO stock_movements (raw_material_id, movement_type, quantity, stock_before, stock_after, reference_type, reference_id, notes)
        VALUES (?, 'intrare', ?, ?, ?, 'manual', ?, ?)
      `).run(newId, initialStock, 0, initialStock, adjResult.lastInsertRowid, reason)
    }

    return result
  })

  return transaction()
}

export function updateRawMaterial(id: number, rm: RawMaterial) {
  const transaction = db.transaction(() => {
    const oldRow = db.prepare('SELECT current_stock FROM raw_materials WHERE id = ?').get(id) as { current_stock: number } | undefined
    const stockBefore = oldRow ? oldRow.current_stock : 0
    const newStock = rm.current_stock !== undefined && rm.current_stock !== null ? Number(rm.current_stock) : stockBefore
    const delta = newStock - stockBefore

    const stmt = db.prepare(`
      UPDATE raw_materials 
      SET name = @name, category_id = @category_id, unit = @unit, current_stock = @current_stock, minimum_stock = @minimum_stock, 
          supplier_id = @supplier_id, notes = @notes, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `)
    const result = stmt.run({
      id,
      name: rm.name,
      category_id: rm.category_id || null,
      unit: rm.unit,
      current_stock: newStock,
      minimum_stock: rm.minimum_stock || 0,
      supplier_id: rm.supplier_id || null,
      notes: rm.notes || null
    })

    if (oldRow && delta !== 0) {
      const reason = rm.notes ? `Modificare stoc la editare materie primă (${rm.notes})` : 'Modificare manuală stoc din editare materie primă'
      const adjResult = db.prepare(`
        INSERT INTO stock_adjustments (raw_material_id, quantity_delta, reason)
        VALUES (?, ?, ?)
      `).run(id, delta, reason)

      db.prepare(`
        INSERT INTO stock_movements (raw_material_id, movement_type, quantity, stock_before, stock_after, reference_type, reference_id, notes)
        VALUES (?, 'ajustare', ?, ?, ?, 'manual', ?, ?)
      `).run(id, Math.abs(delta), stockBefore, newStock, adjResult.lastInsertRowid, reason)
    }

    return result
  })

  return transaction()
}

export function getCategories(type?: string) {
  let query = 'SELECT * FROM categories'
  if (type) {
    query += ' WHERE type = ?'
    return db.prepare(query).all(type)
  }
  return db.prepare(query).all()
}

export function addCategory(name: string, type: string) {
  const stmt = db.prepare('INSERT INTO categories (name, type) VALUES (?, ?)')
  return stmt.run(name, type)
}

export function updateCategory(id: number, name: string) {
  const stmt = db.prepare('UPDATE categories SET name = ? WHERE id = ?')
  return stmt.run(name, id)
}

export function deleteCategory(id: number) {
  const transaction = db.transaction(() => {
    db.prepare('UPDATE raw_materials SET category_id = NULL WHERE category_id = ?').run(id)
    db.prepare('UPDATE finished_products SET category_id = NULL WHERE category_id = ?').run(id)
    return db.prepare('DELETE FROM categories WHERE id = ?').run(id)
  })
  return transaction()
}

