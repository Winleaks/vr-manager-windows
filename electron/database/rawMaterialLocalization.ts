import type Database from 'better-sqlite3';

export function ensureRawMaterialLocalizationSchema(connection: Database.Database) {
  const columns = connection.prepare('PRAGMA table_info(raw_materials)').all() as { name: string }[];
  if (!columns.some((column) => column.name === 'name_ro')) {
    connection.exec('ALTER TABLE raw_materials ADD COLUMN name_ro TEXT;');
  }

  connection.prepare(`
    UPDATE raw_materials
    SET name_ro = name
    WHERE name_ro IS NULL OR trim(name_ro) = ''
  `).run();
}
