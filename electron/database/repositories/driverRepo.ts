import { db } from '../db';

export const driverRepo = {
  getAll: () => {
    return db.prepare('SELECT * FROM drivers ORDER BY name ASC').all();
  },

  create: (name: string, phone?: string, car_details?: string) => {
    const stmt = db.prepare(`
      INSERT INTO drivers (name, phone, car_details)
      VALUES (?, ?, ?)
    `);
    const info = stmt.run(name, phone || null, car_details || null);
    return info.lastInsertRowid;
  },

  update: (id: number, name: string, phone?: string, car_details?: string) => {
    const stmt = db.prepare(`
      UPDATE drivers 
      SET name = ?, phone = ?, car_details = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(name, phone || null, car_details || null, id);
    return true;
  },

  toggleActive: (id: number, isActive: boolean) => {
    db.prepare('UPDATE drivers SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id);
    return true;
  }
};
