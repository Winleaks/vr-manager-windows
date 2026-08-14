import type Database from 'better-sqlite3';
import {
  optionalText,
  requireFiniteNonNegative,
  requireFinitePositive,
  requireIsoDate,
  requireMoneyNonNegative,
  requireMoneyPositive,
  requirePositiveInteger,
  requireText,
} from '../businessValidation.ts';

type SqliteDatabase = Database.Database;

interface RecipeRow { id: number; batch_size: number }
interface RecipeItemRow { raw_material_id: number; quantity: number; name: string; current_stock: number }
interface ProductRow { id: number; name: string; current_stock: number; is_active: number }
interface CashDayRow { id: number; opening_balance: number; is_closed: number }

export interface CashTransactionInput {
  cash_day_id: number;
  type: 'IN' | 'OUT';
  category: string;
  amount: number;
  reference_id?: number | null;
  reference_name?: string | null;
  notes?: string | null;
  items?: Array<{ finished_product_id: number; quantity: number; unit_price: number }>;
}

export interface CashReceiptUpdateInput {
  id: number;
  amount: number;
  reference_id: number;
  notes?: string | null;
}

export function reconcileCurrentCashBalance(
  connection: SqliteDatabase,
  dayIdInput: number,
  actualBalanceInput: number,
) {
  const dayId = requirePositiveInteger(dayIdInput, 'Ziua de casă');
  const actualBalance = requireMoneyNonNegative(actualBalanceInput, 'Soldul curent');

  return connection.transaction(() => {
    const day = connection.prepare(
      'SELECT id, opening_balance, is_closed FROM cash_days WHERE id = ?',
    ).get(dayId) as CashDayRow | undefined;
    if (!day) throw new Error('Ziua de casă nu există.');
    if (day.is_closed) throw new Error('Soldul unei zile închise nu poate fi ajustat.');

    const totals = connection.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'IN' THEN amount ELSE 0 END), 0) AS total_in,
        COALESCE(SUM(CASE WHEN type = 'OUT' THEN amount ELSE 0 END), 0) AS total_out
      FROM cash_transactions WHERE cash_day_id = ?
    `).get(dayId) as { total_in: number; total_out: number };
    const currentBalance = Math.round(
      (Number(day.opening_balance) + Number(totals.total_in) - Number(totals.total_out)) * 100,
    ) / 100;
    const difference = Math.round((actualBalance - currentBalance) * 100) / 100;
    if (difference === 0) return null;

    const result = connection.prepare(`
      INSERT INTO cash_transactions (cash_day_id, type, category, amount, notes)
      VALUES (?, ?, 'cash_adjustment', ?, ?)
    `).run(
      dayId,
      difference > 0 ? 'IN' : 'OUT',
      Math.abs(difference),
      `Ajustare la soldul fizic verificat: £${actualBalance.toFixed(2)}`,
    );
    return Number(result.lastInsertRowid);
  })();
}

export function updateCashDayOpeningBalance(
  connection: SqliteDatabase,
  dayIdInput: number,
  openingBalanceInput: number,
) {
  const dayId = requirePositiveInteger(dayIdInput, 'Ziua de casă');
  const openingBalance = requireMoneyNonNegative(openingBalanceInput, 'Soldul de deschidere');

  return connection.transaction(() => {
    const day = connection.prepare(
      'SELECT id, is_closed FROM cash_days WHERE id = ?',
    ).get(dayId) as { id: number; is_closed: number } | undefined;
    if (!day) throw new Error('Ziua de casă nu există.');
    if (day.is_closed) throw new Error('Soldul unei zile închise nu poate fi modificat.');
    const transactionCount = Number((connection.prepare(
      'SELECT COUNT(*) AS count FROM cash_transactions WHERE cash_day_id = ?',
    ).get(dayId) as { count: number }).count);
    if (transactionCount > 0) {
      throw new Error('Soldul de deschidere poate fi modificat numai înainte de prima tranzacție.');
    }
    const result = connection.prepare(
      'UPDATE cash_days SET opening_balance = ? WHERE id = ? AND is_closed = 0',
    ).run(openingBalance, dayId);
    if (result.changes !== 1) throw new Error('Soldul de deschidere nu a putut fi actualizat.');
    return true;
  })();
}

export function updateCashReceiptTransaction(
  connection: SqliteDatabase,
  data: CashReceiptUpdateInput,
) {
  const transactionId = requirePositiveInteger(data.id, 'Încasarea');
  const amount = requireMoneyPositive(data.amount, 'Suma încasării');
  const referenceId = requirePositiveInteger(data.reference_id, 'Șoferul');
  const notes = optionalText(data.notes, 'Observațiile încasării');

  return connection.transaction(() => {
    const receipt = connection.prepare(`
      SELECT t.id, t.type, t.category, d.is_closed
      FROM cash_transactions t
      JOIN cash_days d ON d.id = t.cash_day_id
      WHERE t.id = ?
    `).get(transactionId) as { id: number; type: string; category: string; is_closed: number } | undefined;
    if (!receipt) throw new Error('Încasarea nu există.');
    if (receipt.is_closed) throw new Error('Încasările unei zile închise nu pot fi modificate.');
    if (receipt.type !== 'IN' || receipt.category !== 'driver_collection') {
      throw new Error('Numai încasările de la șoferi pot fi modificate din acest ecran.');
    }
    const driver = connection.prepare('SELECT id FROM drivers WHERE id = ?').get(referenceId);
    if (!driver) throw new Error('Șoferul selectat nu există.');
    const result = connection.prepare(`
      UPDATE cash_transactions
      SET amount = ?, reference_id = ?, notes = ?
      WHERE id = ?
    `).run(amount, referenceId, notes, transactionId);
    if (result.changes !== 1) throw new Error('Încasarea nu a putut fi actualizată.');
    return true;
  })();
}

export function createProductionTransaction(
  connection: SqliteDatabase,
  productIdInput: number,
  quantityInput: number,
  dateInput: string,
  notes?: string,
) {
  const productId = requirePositiveInteger(productIdInput, 'Produsul finit');
  const quantity = requireFinitePositive(quantityInput, 'Cantitatea produsă');
  const productionDate = requireIsoDate(dateInput, 'Data producției');
  const productionNotes = optionalText(notes, 'Observațiile producției');

  return connection.transaction(() => {
    const product = connection.prepare(
      'SELECT id, name, current_stock, is_active FROM finished_products WHERE id = ?',
    ).get(productId) as ProductRow | undefined;
    if (!product || !product.is_active) throw new Error('Produsul finit nu există sau este inactiv.');
    requireFiniteNonNegative(product.current_stock, 'Stocul produsului finit');

    const recipe = connection.prepare(
      'SELECT id, batch_size FROM recipes WHERE finished_product_id = ?',
    ).get(productId) as RecipeRow | undefined;
    if (!recipe) throw new Error('Produsul nu are o rețetă definită.');
    const batchSize = requireFinitePositive(recipe.batch_size, 'Mărimea lotului din rețetă');

    const recipeItems = connection.prepare(`
      SELECT ri.raw_material_id, ri.quantity, rm.name, rm.current_stock
      FROM recipe_items ri
      JOIN raw_materials rm ON rm.id = ri.raw_material_id
      WHERE ri.recipe_id = ?
    `).all(recipe.id) as RecipeItemRow[];
    if (recipeItems.length === 0) throw new Error('Rețeta nu conține materii prime.');

    const multiplier = quantity / batchSize;
    const requirements = new Map<number, { name: string; stockBefore: number; consumed: number }>();
    for (const item of recipeItems) {
      const recipeQuantity = requireFinitePositive(item.quantity, `Cantitatea din rețetă pentru ${item.name}`);
      const stockBefore = requireFiniteNonNegative(item.current_stock, `Stocul materiei prime ${item.name}`);
      const existing = requirements.get(item.raw_material_id);
      requirements.set(item.raw_material_id, {
        name: item.name,
        stockBefore,
        consumed: (existing?.consumed || 0) + recipeQuantity * multiplier,
      });
    }

    for (const requirement of requirements.values()) {
      if (!Number.isFinite(requirement.consumed) || requirement.consumed <= 0) {
        throw new Error(`Consumul calculat pentru ${requirement.name} nu este valid.`);
      }
      if (requirement.consumed > requirement.stockBefore + 1e-9) {
        throw new Error(`Stoc insuficient pentru ${requirement.name}.`);
      }
    }

    const productionResult = connection.prepare(`
      INSERT INTO productions (finished_product_id, quantity_produced, production_date, notes)
      VALUES (?, ?, ?, ?)
    `).run(productId, quantity, productionDate, productionNotes);
    const productionId = Number(productionResult.lastInsertRowid);

    const finishedStockAfter = product.current_stock + quantity;
    connection.prepare(
      'UPDATE finished_products SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(finishedStockAfter, productId);
    connection.prepare(`
      INSERT INTO finished_product_movements
        (finished_product_id, movement_type, quantity, stock_before, stock_after, reference_type, reference_id, notes)
      VALUES (?, 'productie', ?, ?, ?, 'production', ?, ?)
    `).run(productId, quantity, product.current_stock, finishedStockAfter, productionId, `Producție #${productionId}`);

    const updateRawStock = connection.prepare(
      'UPDATE raw_materials SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    );
    const insertMovement = connection.prepare(`
      INSERT INTO stock_movements
        (raw_material_id, movement_type, quantity, stock_before, stock_after, reference_type, reference_id, notes)
      VALUES (?, 'consum', ?, ?, ?, 'productie', ?, ?)
    `);
    for (const [rawMaterialId, requirement] of requirements) {
      const stockAfter = requirement.stockBefore - requirement.consumed;
      updateRawStock.run(stockAfter, rawMaterialId);
      insertMovement.run(
        rawMaterialId,
        requirement.consumed,
        requirement.stockBefore,
        stockAfter,
        productionId,
        `Consum producție #${productionId}`,
      );
    }

    return productionId;
  })();
}

export function adjustRawMaterialStockTransaction(
  connection: SqliteDatabase,
  rawMaterialIdInput: number,
  newStockInput: number,
  reasonInput: string,
) {
  const rawMaterialId = requirePositiveInteger(rawMaterialIdInput, 'Materia primă');
  const newStock = requireFiniteNonNegative(newStockInput, 'Stocul nou');
  const reason = requireText(reasonInput, 'Motivul ajustării');

  return connection.transaction(() => {
    const current = connection.prepare(
      'SELECT current_stock FROM raw_materials WHERE id = ?',
    ).get(rawMaterialId) as { current_stock: number } | undefined;
    if (!current) throw new Error('Materia primă nu există.');
    const stockBefore = requireFiniteNonNegative(current.current_stock, 'Stocul curent');
    const delta = newStock - stockBefore;
    if (delta === 0) return true;

    connection.prepare(
      'UPDATE raw_materials SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(newStock, rawMaterialId);
    const adjustment = connection.prepare(`
      INSERT INTO stock_adjustments (raw_material_id, quantity_delta, reason)
      VALUES (?, ?, ?)
    `).run(rawMaterialId, delta, reason);
    connection.prepare(`
      INSERT INTO stock_movements
        (raw_material_id, movement_type, quantity, stock_before, stock_after, reference_type, reference_id, notes)
      VALUES (?, 'ajustare', ?, ?, ?, 'manual', ?, ?)
    `).run(rawMaterialId, Math.abs(delta), stockBefore, newStock, adjustment.lastInsertRowid, reason);
    return true;
  })();
}

export function addCashTransaction(connection: SqliteDatabase, data: CashTransactionInput) {
  const dayId = requirePositiveInteger(data.cash_day_id, 'Ziua de casă');
  if (data.type !== 'IN' && data.type !== 'OUT') throw new Error('Tipul tranzacției de casă nu este valid.');
  const category = requireText(data.category, 'Categoria', 100);
  const amount = requireFinitePositive(data.amount, 'Suma');
  const referenceId = data.reference_id === undefined || data.reference_id === null
    ? null
    : requirePositiveInteger(data.reference_id, 'Referința tranzacției');
  const referenceName = optionalText(data.reference_name, 'Numele referinței', 300);
  const transactionNotes = optionalText(data.notes, 'Observațiile tranzacției');
  const items = data.items || [];
  if (category === 'direct_sale' && (data.type !== 'IN' || items.length === 0)) {
    throw new Error('Vânzarea directă trebuie să fie o încasare cu cel puțin un produs.');
  }
  if (category !== 'direct_sale' && items.length > 0) {
    throw new Error('Produsele pot fi asociate doar unei vânzări directe.');
  }

  return connection.transaction(() => {
    const day = connection.prepare(
      'SELECT id, opening_balance, is_closed FROM cash_days WHERE id = ?',
    ).get(dayId) as CashDayRow | undefined;
    if (!day) throw new Error('Ziua de casă nu există.');
    if (day.is_closed) throw new Error('Ziua de casă este deja închisă.');

    const requestedByProduct = new Map<number, { product: ProductRow; quantity: number }>();
    let calculatedAmount = 0;
    for (const item of items) {
      const productId = requirePositiveInteger(item.finished_product_id, 'Produsul vândut');
      const itemQuantity = requireFinitePositive(item.quantity, 'Cantitatea vândută');
      const unitPrice = requireFiniteNonNegative(item.unit_price, 'Prețul unitar');
      calculatedAmount += itemQuantity * unitPrice;
      const existing = requestedByProduct.get(productId);
      if (existing) {
        existing.quantity += itemQuantity;
      } else {
        const product = connection.prepare(
          'SELECT id, name, current_stock, is_active FROM finished_products WHERE id = ?',
        ).get(productId) as ProductRow | undefined;
        if (!product || !product.is_active) throw new Error('Un produs vândut nu există sau este inactiv.');
        requireFiniteNonNegative(product.current_stock, `Stocul produsului ${product.name}`);
        requestedByProduct.set(productId, { product, quantity: itemQuantity });
      }
    }
    if (items.length > 0 && Math.abs(calculatedAmount - amount) > 0.01) {
      throw new Error('Suma tranzacției nu corespunde produselor vândute.');
    }
    for (const { product, quantity } of requestedByProduct.values()) {
      if (quantity > product.current_stock + 1e-9) throw new Error(`Stoc insuficient pentru ${product.name}.`);
    }

    const transactionResult = connection.prepare(`
      INSERT INTO cash_transactions
        (cash_day_id, type, category, amount, reference_id, reference_name, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      dayId,
      data.type,
      category,
      amount,
      referenceId,
      referenceName,
      transactionNotes,
    );
    const transactionId = Number(transactionResult.lastInsertRowid);

    const insertItem = connection.prepare(`
      INSERT INTO cash_transaction_items (transaction_id, finished_product_id, quantity, unit_price)
      VALUES (?, ?, ?, ?)
    `);
    for (const item of items) {
      insertItem.run(transactionId, item.finished_product_id, item.quantity, item.unit_price);
    }

    const updateStock = connection.prepare(
      'UPDATE finished_products SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    );
    const insertMovement = connection.prepare(`
      INSERT INTO finished_product_movements
        (finished_product_id, movement_type, quantity, stock_before, stock_after, reference_type, reference_id, notes)
      VALUES (?, 'vanzare', ?, ?, ?, 'cash_transaction', ?, ?)
    `);
    for (const [productId, requested] of requestedByProduct) {
      const stockAfter = requested.product.current_stock - requested.quantity;
      updateStock.run(stockAfter, productId);
      insertMovement.run(
        productId,
        requested.quantity,
        requested.product.current_stock,
        stockAfter,
        transactionId,
        `Vânzare cash (Tranzacția #${transactionId})`,
      );
    }
    return transactionId;
  })();
}

export function closeCashDayTransaction(connection: SqliteDatabase, dayIdInput: number, closingBalanceInput: number) {
  const dayId = requirePositiveInteger(dayIdInput, 'Ziua de casă');
  if (typeof closingBalanceInput !== 'number' || !Number.isFinite(closingBalanceInput)) {
    throw new Error('Soldul final trebuie să fie un număr finit.');
  }

  return connection.transaction(() => {
    const day = connection.prepare(
      'SELECT id, opening_balance, is_closed FROM cash_days WHERE id = ?',
    ).get(dayId) as CashDayRow | undefined;
    if (!day) throw new Error('Ziua de casă nu există.');
    if (day.is_closed) throw new Error('Ziua de casă este deja închisă.');
    const totals = connection.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'IN' THEN amount ELSE 0 END), 0) AS total_in,
        COALESCE(SUM(CASE WHEN type = 'OUT' THEN amount ELSE 0 END), 0) AS total_out
      FROM cash_transactions WHERE cash_day_id = ?
    `).get(dayId) as { total_in: number; total_out: number };
    const calculatedBalance = day.opening_balance + totals.total_in - totals.total_out;
    if (Math.abs(calculatedBalance - closingBalanceInput) > 0.01) {
      throw new Error('Soldul final nu corespunde tranzacțiilor zilei.');
    }
    const result = connection.prepare(`
      UPDATE cash_days SET is_closed = 1, closing_balance = ?, closed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND is_closed = 0
    `).run(closingBalanceInput, dayId);
    if (result.changes !== 1) throw new Error('Ziua de casă nu a putut fi închisă.');
    return true;
  })();
}

export function deleteCashTransaction(connection: SqliteDatabase, transactionIdInput: number) {
  const transactionId = requirePositiveInteger(transactionIdInput, 'Tranzacția de casă');
  return connection.transaction(() => {
    const cashTransaction = connection.prepare(`
      SELECT t.id, d.is_closed
      FROM cash_transactions t JOIN cash_days d ON d.id = t.cash_day_id
      WHERE t.id = ?
    `).get(transactionId) as { id: number; is_closed: number } | undefined;
    if (!cashTransaction) throw new Error('Tranzacția de casă nu există.');
    if (cashTransaction.is_closed) throw new Error('Tranzacțiile unei zile închise nu pot fi șterse.');

    const items = connection.prepare(
      'SELECT finished_product_id, quantity FROM cash_transaction_items WHERE transaction_id = ?',
    ).all(transactionId) as Array<{ finished_product_id: number; quantity: number }>;
    for (const item of items) {
      const result = connection.prepare(
        'UPDATE finished_products SET current_stock = current_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ).run(item.quantity, item.finished_product_id);
      if (result.changes !== 1) throw new Error('Stocul produsului asociat nu a putut fi restaurat.');
    }
    connection.prepare(
      "DELETE FROM finished_product_movements WHERE reference_type = 'cash_transaction' AND reference_id = ?",
    ).run(transactionId);
    connection.prepare('DELETE FROM cash_transaction_items WHERE transaction_id = ?').run(transactionId);
    connection.prepare('DELETE FROM cash_transactions WHERE id = ?').run(transactionId);
    return true;
  })();
}
