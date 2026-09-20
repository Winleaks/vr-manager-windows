import assert from 'node:assert/strict';
import test from 'node:test';
import { productDisplayName } from './productDisplayName.ts';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('catalog and production names keep packaged and unpackaged variants distinct', () => {
  assert.equal(productDisplayName(' Bread ', ' Packed '), 'Bread - Packed');
  assert.equal(productDisplayName('Bread', 'Unpacked'), 'Bread - Unpacked');
  assert.equal(productDisplayName('Bread - PACKED', 'packed'), 'Bread - PACKED');
  assert.equal(productDisplayName('Pâine - ambalată', 'ambalată'), 'Pâine - ambalată');
  assert.equal(productDisplayName('Legacy Bread - Packed', null), 'Legacy Bread - Packed');
});

test('real catalog and production queries retain variants and legacy names without modifying stock', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE finished_products (id INTEGER PRIMARY KEY, name TEXT, name_ro TEXT, source_category TEXT, category_id INTEGER, external_product_id TEXT, display_order INTEGER, is_active INTEGER, current_stock REAL, production_unit TEXT);
      CREATE TABLE categories (id INTEGER, name TEXT);
      CREATE TABLE cloud_products (supabase_product_id TEXT, name TEXT, name_ro TEXT, variant_label TEXT, display_order INTEGER);
      CREATE TABLE productions (id INTEGER, finished_product_id INTEGER, production_date TEXT, created_at TEXT);
      INSERT INTO finished_products VALUES (1,'Bread - Packed','Pâine - ambalată',NULL,NULL,'packed',1,1,9,'pcs'),(2,'Bread - Unpacked','Pâine - neambalată',NULL,NULL,'unpacked',2,1,5,'pcs'),(3,'Legacy',NULL,NULL,NULL,NULL,NULL,1,4,'pcs');
      INSERT INTO cloud_products VALUES ('packed','Bread','Pâine','Packed',1),('unpacked','Bread','Pâine','Unpacked',2);
      INSERT INTO productions VALUES (1,1,'2026-09-20','1'),(2,2,'2026-09-20','2'),(3,3,'2026-09-20','3');`);
    const load = (name: string) => {
      const source = readFileSync(new URL(`./repositories/${name}.ts`, import.meta.url), 'utf8');
      const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      const exports: any = {};
      runInNewContext(compiled, { exports, require: (id: string) => {
        if (id === '../db') return { db };
        if (id === '../productDisplayName') return { productDisplayName };
        if (id === '../finishedProductCatalog' || id === './inventoryTransactions') return {};
        throw Error(`Unexpected dependency ${id}`);
      } });
      return exports[name];
    };
    const catalog = load('finishedProductRepo');
    assert.deepEqual(Array.from(catalog.getAll(), (row: any) => row.name), ['Bread - Packed', 'Bread - Unpacked', 'Legacy']);
    assert.equal(catalog.getById(1).variant_label, 'Packed');
    assert.equal(catalog.getById(2).name, 'Bread - Unpacked');
    assert.equal(catalog.getById(3).name, 'Legacy');
    assert.deepEqual(Array.from(load('productionRepo').getAll(), (row: any) => row.product_name), ['Legacy', 'Bread - Unpacked', 'Bread - Packed']);
    assert.equal((db.prepare('SELECT SUM(current_stock) AS total FROM finished_products').get() as any).total, 18);
  } finally { db.close(); }
});
