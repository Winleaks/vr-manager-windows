import type Database from 'better-sqlite3';
import type { VrBakerProduct } from '../integrations/vrBakerApiClient.ts';

type SqliteDatabase = Database.Database;

interface LocalProductRow {
  id: number;
  name: string;
}

export interface FinishedProductCatalogSyncResult {
  received: number;
  created: number;
  updated: number;
  linked: number;
  archivedManual: number;
  deactivatedRemote: number;
}

export function ensureFinishedProductCatalogSchema(connection: SqliteDatabase) {
  const columns = new Set((connection.prepare(
    'PRAGMA table_info(finished_products)',
  ).all() as Array<{ name: string }>).map((column) => column.name));
  if (!columns.has('external_product_id')) connection.exec('ALTER TABLE finished_products ADD COLUMN external_product_id TEXT;');
  if (!columns.has('name_ro')) connection.exec('ALTER TABLE finished_products ADD COLUMN name_ro TEXT;');
  if (!columns.has('catalog_source')) connection.exec("ALTER TABLE finished_products ADD COLUMN catalog_source TEXT NOT NULL DEFAULT 'manual';");
  if (!columns.has('source_category')) connection.exec('ALTER TABLE finished_products ADD COLUMN source_category TEXT;');
  if (!columns.has('standard_price')) connection.exec('ALTER TABLE finished_products ADD COLUMN standard_price REAL NOT NULL DEFAULT 0;');
  if (!columns.has('display_order')) connection.exec('ALTER TABLE finished_products ADD COLUMN display_order INTEGER;');
  connection.exec("UPDATE finished_products SET name_ro = name WHERE name_ro IS NULL OR trim(name_ro) = '';");
  connection.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_finished_products_external ON finished_products(external_product_id) WHERE external_product_id IS NOT NULL;');
}

function localizedDisplayName(baseName: string, product: VrBakerProduct, locale: string) {
  const base = baseName.trim();
  const variant = product.variantLabel?.trim();
  if (!variant || base.toLocaleLowerCase(locale).includes(variant.toLocaleLowerCase(locale))) return base;
  return `${base} - ${variant}`;
}

function englishDisplayName(product: VrBakerProduct) {
  return localizedDisplayName(product.name, product, 'en-GB');
}

function romanianDisplayName(product: VrBakerProduct) {
  return localizedDisplayName(product.nameRo?.trim() || product.name, product, 'ro-RO');
}

function uniqueDisplayName(
  connection: SqliteDatabase,
  product: VrBakerProduct,
  currentId?: number,
) {
  const desired = englishDisplayName(product);
  const candidates = [
    desired,
    product.name.trim() !== desired ? `${desired} (${product.name.trim()})` : '',
    `${desired} [${product.id.slice(0, 8)}]`,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const owner = connection.prepare(
      'SELECT id FROM finished_products WHERE LOWER(name) = LOWER(?)',
    ).get(candidate) as { id: number } | undefined;
    if (!owner || owner.id === currentId) return candidate;
  }
  throw new Error(`Numele produsului „${desired}” intră în conflict cu un produs local.`);
}

function findManualMatch(connection: SqliteDatabase, product: VrBakerProduct) {
  const names = Array.from(new Set([
    englishDisplayName(product),
    romanianDisplayName(product),
    product.name,
    product.nameRo || '',
  ].map((name) => name.trim()).filter(Boolean)));
  for (const name of names) {
    const match = connection.prepare(`
      SELECT id, name FROM finished_products
      WHERE external_product_id IS NULL AND LOWER(name) = LOWER(?)
      LIMIT 1
    `).get(name) as LocalProductRow | undefined;
    if (match) return match;
  }
  return undefined;
}

export function syncFinishedProductCatalog(
  connection: SqliteDatabase,
  products: VrBakerProduct[],
): FinishedProductCatalogSyncResult {
  if (!Array.isArray(products) || products.length > 1000) {
    throw new Error('Catalogul de produse depășește limita permisă.');
  }
  const uniqueExternalIds = new Set(products.map((product) => product.id));
  if (uniqueExternalIds.size !== products.length) {
    throw new Error('Catalogul VR Baker conține produse duplicate.');
  }

  return connection.transaction(() => {
    let created = 0;
    let updated = 0;
    let linked = 0;

    for (const product of products) {
      let local = connection.prepare(
        'SELECT id, name FROM finished_products WHERE external_product_id = ?',
      ).get(product.id) as LocalProductRow | undefined;
      if (!local) {
        local = findManualMatch(connection, product);
        if (local) linked += 1;
      }

      const name = uniqueDisplayName(connection, product, local?.id);
      if (local) {
        connection.prepare(`
          UPDATE finished_products
          SET name = ?, name_ro = ?, production_unit = ?, external_product_id = ?, catalog_source = 'vrbaker',
              source_category = ?, standard_price = ?, display_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          name,
          romanianDisplayName(product),
          product.unit,
          product.id,
          product.category,
          product.priceStandard,
          product.displayOrder,
          product.available ? 1 : 0,
          local.id,
        );
        updated += 1;
      } else {
        connection.prepare(`
          INSERT INTO finished_products
            (name, name_ro, production_unit, external_product_id, catalog_source, source_category, standard_price, display_order, is_active)
          VALUES (?, ?, ?, ?, 'vrbaker', ?, ?, ?, ?)
        `).run(name, romanianDisplayName(product), product.unit, product.id, product.category, product.priceStandard, product.displayOrder, product.available ? 1 : 0);
        created += 1;
      }
    }

    const archivedManual = Number(connection.prepare(`
      UPDATE finished_products
      SET is_active = 0, updated_at = CURRENT_TIMESTAMP
      WHERE external_product_id IS NULL AND catalog_source = 'manual' AND is_active != 0
    `).run().changes);

    let deactivatedRemote = 0;
    if (products.length === 0) {
      deactivatedRemote = Number(connection.prepare(`
        UPDATE finished_products
        SET is_active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE catalog_source = 'vrbaker' AND is_active != 0
      `).run().changes);
    } else {
      const placeholders = products.map(() => '?').join(', ');
      deactivatedRemote = Number(connection.prepare(`
        UPDATE finished_products
        SET is_active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE catalog_source = 'vrbaker'
          AND external_product_id NOT IN (${placeholders})
          AND is_active != 0
      `).run(...products.map((product) => product.id)).changes);
    }

    return {
      received: products.length,
      created,
      updated,
      linked,
      archivedManual,
      deactivatedRemote,
    };
  })();
}
