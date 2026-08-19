import type Database from 'better-sqlite3';

type SqliteDatabase = Database.Database;

interface ProductStockRow {
  id: number;
  name: string;
  current_stock: unknown;
}

export interface StockRepairResult {
  productId: number;
  productName: string;
  stock: number;
  source: 'numeric-text' | 'last-movement' | 'history' | 'zero';
}

export function storedFiniteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function roundedStock(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function repairInvalidFinishedProductStocks(connection: SqliteDatabase) {
  const products = connection.prepare(
    'SELECT id, name, current_stock FROM finished_products ORDER BY id',
  ).all() as ProductStockRow[];
  const updateStock = connection.prepare(
    'UPDATE finished_products SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  );
  const insertAuditMovement = connection.prepare(`
    INSERT INTO finished_product_movements
      (finished_product_id, movement_type, quantity, stock_before, stock_after, reference_type, notes)
    VALUES (?, 'ajustare', ?, 0, ?, 'migration', ?)
  `);
  const repairs: StockRepairResult[] = [];

  for (const product of products) {
    const stored = storedFiniteNumber(product.current_stock);
    if (stored !== null) {
      if (typeof product.current_stock !== 'number') {
        const stock = roundedStock(stored);
        updateStock.run(stock, product.id);
        repairs.push({ productId: product.id, productName: product.name, stock, source: 'numeric-text' });
      }
      continue;
    }

    const movementRows = connection.prepare(`
      SELECT stock_after
      FROM finished_product_movements
      WHERE finished_product_id = ?
      ORDER BY id DESC
    `).all(product.id) as Array<{ stock_after: unknown }>;
    const movementStock = movementRows
      .map((row) => storedFiniteNumber(row.stock_after))
      .find((value): value is number => value !== null);

    let source: StockRepairResult['source'];
    let recoveredStock: number;
    if (movementStock !== undefined) {
      source = 'last-movement';
      recoveredStock = movementStock;
    } else {
      const produced = connection.prepare(`
        SELECT COALESCE(SUM(quantity_produced), 0) AS value
        FROM productions WHERE finished_product_id = ?
      `).get(product.id) as { value: unknown };
      const sold = connection.prepare(`
        SELECT COALESCE(SUM(quantity), 0) AS value
        FROM cash_transaction_items WHERE finished_product_id = ?
      `).get(product.id) as { value: unknown };
      const producedQuantity = storedFiniteNumber(produced.value) || 0;
      const soldQuantity = storedFiniteNumber(sold.value) || 0;
      recoveredStock = producedQuantity - soldQuantity;
      source = producedQuantity > 0 || soldQuantity > 0 ? 'history' : 'zero';
    }

    const stock = roundedStock(recoveredStock);
    updateStock.run(stock, product.id);
    insertAuditMovement.run(
      product.id,
      Math.abs(stock),
      stock,
      `Reparare automată stoc invalid pentru ${product.name}`,
    );
    repairs.push({ productId: product.id, productName: product.name, stock, source });
  }

  return repairs;
}
