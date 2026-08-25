import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { ensureRawMaterialLocalizationSchema } from './rawMaterialLocalization.ts';

test('raw material localization migration preserves legacy stock and fills the Romanian name', () => {
  const connection = new Database(':memory:');
  connection.exec(`
    CREATE TABLE raw_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      unit TEXT NOT NULL,
      current_stock REAL NOT NULL DEFAULT 0,
      minimum_stock REAL NOT NULL DEFAULT 0
    );
    INSERT INTO raw_materials (name, unit, current_stock, minimum_stock)
    VALUES ('Flour', 'kg', 125.5, 20);
  `);

  ensureRawMaterialLocalizationSchema(connection);
  ensureRawMaterialLocalizationSchema(connection);

  const row = connection.prepare(`
    SELECT name, name_ro, unit, current_stock, minimum_stock
    FROM raw_materials
  `).get() as Record<string, unknown>;
  assert.deepEqual(row, {
    name: 'Flour',
    name_ro: 'Flour',
    unit: 'kg',
    current_stock: 125.5,
    minimum_stock: 20,
  });
  connection.close();
});

test('raw material localization keeps Romanian diacritics unchanged', () => {
  const connection = new Database(':memory:');
  connection.exec(`
    CREATE TABLE raw_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      name_ro TEXT,
      unit TEXT NOT NULL,
      current_stock REAL NOT NULL DEFAULT 0,
      minimum_stock REAL NOT NULL DEFAULT 0
    );
    INSERT INTO raw_materials (name, name_ro, unit)
    VALUES ('Wholemeal Flour', 'Făină integrală', 'kg');
  `);

  ensureRawMaterialLocalizationSchema(connection);

  const row = connection.prepare('SELECT name_ro FROM raw_materials').get() as { name_ro: string };
  assert.equal(row.name_ro, 'Făină integrală');
  connection.close();
});
