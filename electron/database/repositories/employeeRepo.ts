import { db } from '../db';

export const employeeRepo = {
  getAll: () => {
    return db.prepare('SELECT * FROM employees ORDER BY name ASC').all();
  },

  create: (name: string, role?: string) => {
    const stmt = db.prepare(`
      INSERT INTO employees (name, role)
      VALUES (?, ?)
    `);
    const info = stmt.run(name, role || null);
    return info.lastInsertRowid;
  },

  update: (id: number, name: string, role?: string) => {
    const stmt = db.prepare(`
      UPDATE employees 
      SET name = ?, role = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(name, role || null, id);
    return true;
  },

  toggleActive: (id: number, isActive: boolean) => {
    db.prepare('UPDATE employees SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id);
    return true;
  }
};
