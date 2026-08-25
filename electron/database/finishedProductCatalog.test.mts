import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initialSchema } from './schema.ts';
import { ensureFinishedProductCatalogSchema, syncFinishedProductCatalog } from './finishedProductCatalog.ts';
import type { VrBakerProduct } from '../integrations/vrBakerApiClient.ts';

const breadId = '11111111-1111-4111-8111-111111111111';
const cakeId = '22222222-2222-4222-8222-222222222222';

function product(overrides: Partial<VrBakerProduct> & Pick<VrBakerProduct, 'id' | 'name'>): VrBakerProduct {
  return {
    id: overrides.id,
    name: overrides.name,
    nameRo: overrides.nameRo || '',
    variantLabel: overrides.variantLabel || '',
    unit: overrides.unit || 'buc',
    category: overrides.category || 'bakery',
    priceStandard: overrides.priceStandard || 0,
    available: overrides.available !== false,
  };
}

test('catalog schema migration preserves legacy finished products', () => {
  const connection = new Database(':memory:');
  try {
    connection.exec(`
      CREATE TABLE finished_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        production_unit TEXT NOT NULL DEFAULT 'buc',
        current_stock REAL NOT NULL DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        updated_at DATETIME
      );
      INSERT INTO finished_products (name, current_stock) VALUES ('Produs vechi', -3);
    `);
    ensureFinishedProductCatalogSchema(connection);
    ensureFinishedProductCatalogSchema(connection);
    assert.deepEqual(connection.prepare(`
      SELECT name, name_ro, current_stock, external_product_id, catalog_source, source_category, standard_price
      FROM finished_products
    `).get(), {
      name: 'Produs vechi',
      name_ro: 'Produs vechi',
      current_stock: -3,
      external_product_id: null,
      catalog_source: 'manual',
      source_category: null,
      standard_price: 0,
    });
  } finally {
    connection.close();
  }
});

test('VR Baker catalog replaces manual products while preserving matched stock and recipes', () => {
  const connection = new Database(':memory:');
  connection.pragma('foreign_keys = ON');
  connection.exec(initialSchema);
  try {
    const matchedId = Number(connection.prepare(`
      INSERT INTO finished_products (name, current_stock) VALUES ('Pâine - 500g', -2)
    `).run().lastInsertRowid);
    const oldManualId = Number(connection.prepare(`
      INSERT INTO finished_products (name, current_stock) VALUES ('Produs manual vechi', 7)
    `).run().lastInsertRowid);
    connection.prepare(
      'INSERT INTO recipes (finished_product_id, batch_size) VALUES (?, 1)',
    ).run(matchedId);

    const first = syncFinishedProductCatalog(connection, [
      product({ id: breadId, name: 'Bread', nameRo: 'Pâine', variantLabel: '500g', priceStandard: 2.5 }),
      product({ id: cakeId, name: 'Cake', nameRo: 'Cozonac', priceStandard: 8 }),
    ]);
    assert.deepEqual(first, {
      received: 2,
      created: 1,
      updated: 1,
      linked: 1,
      archivedManual: 1,
      deactivatedRemote: 0,
    });
    assert.deepEqual(connection.prepare(`
      SELECT id, name, name_ro, current_stock, external_product_id, catalog_source, standard_price, is_active
      FROM finished_products WHERE id = ?
    `).get(matchedId), {
      id: matchedId,
      name: 'Bread - 500g',
      name_ro: 'Pâine - 500g',
      current_stock: -2,
      external_product_id: breadId,
      catalog_source: 'vrbaker',
      standard_price: 2.5,
      is_active: 1,
    });
    assert.equal((connection.prepare(
      'SELECT finished_product_id FROM recipes WHERE finished_product_id = ?',
    ).get(matchedId) as { finished_product_id: number }).finished_product_id, matchedId);
    assert.equal((connection.prepare(
      'SELECT is_active FROM finished_products WHERE id = ?',
    ).get(oldManualId) as { is_active: number }).is_active, 0);

    const second = syncFinishedProductCatalog(connection, [
      product({ id: breadId, name: 'Bread', nameRo: 'Pâine', variantLabel: '600g', priceStandard: 3 }),
    ]);
    assert.equal(second.created, 0);
    assert.equal(second.updated, 1);
    assert.equal(second.deactivatedRemote, 1);
    assert.deepEqual(connection.prepare(`
      SELECT name, name_ro, current_stock, standard_price FROM finished_products WHERE id = ?
    `).get(matchedId), { name: 'Bread - 600g', name_ro: 'Pâine - 600g', current_stock: -2, standard_price: 3 });
    assert.equal((connection.prepare(
      'SELECT is_active FROM finished_products WHERE external_product_id = ?',
    ).get(cakeId) as { is_active: number }).is_active, 0);
  } finally {
    connection.close();
  }
});

test('duplicate external products are rejected before local catalog changes', () => {
  const connection = new Database(':memory:');
  connection.exec(initialSchema);
  try {
    connection.prepare("INSERT INTO finished_products (name) VALUES ('Manual')").run();
    assert.throws(() => syncFinishedProductCatalog(connection, [
      product({ id: breadId, name: 'Bread A' }),
      product({ id: breadId, name: 'Bread B' }),
    ]), /duplicate/);
    assert.deepEqual(connection.prepare(
      'SELECT name, is_active, external_product_id FROM finished_products',
    ).all(), [{ name: 'Manual', is_active: 1, external_product_id: null }]);
  } finally {
    connection.close();
  }
});
