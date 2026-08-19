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
import { localIsoDate } from '../cashDayRollover.ts';
import { storedFiniteNumber } from '../stockDataRepair.ts';

type SqliteDatabase = Database.Database;

interface RecipeRow { id: number; batch_size: number }
interface RecipeItemRow { raw_material_id: number; quantity: number; name: string; current_stock: number }
interface ProductRow { id: number; name: string; current_stock: number; is_active: number }
interface CashDayRow { id: number; date?: string; opening_balance: number; is_closed: number }

function requireStoredStock(value: unknown, label: string) {
  const stock = storedFiniteNumber(value);
  if (stock === null) {
    throw new Error(`${label} nu este configurat corect. Repornește aplicația pentru repararea automată a datelor.`);
  }
  return stock;
}

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

const CASH_BALANCE_INITIALIZED_KEY = 'daily_cash_balance_initialized_v1';

export function initializeCashBalanceOnce(
  connection: SqliteDatabase,
  dayIdInput: number,
  actualBalanceInput: number,
) {
  const dayId = requirePositiveInteger(dayIdInput, 'Ziua de casă');
  const actualBalance = requireMoneyNonNegative(actualBalanceInput, 'Soldul inițial');

  return connection.transaction(() => {
    const existingInitialization = connection.prepare(
      'SELECT value FROM app_settings WHERE key = ?',
    ).get(CASH_BALANCE_INITIALIZED_KEY);
    if (existingInitialization) throw new Error('Soldul inițial al casei a fost deja configurat și nu mai poate fi modificat.');

    const day = connection.prepare(
      'SELECT id, opening_balance, is_closed FROM cash_days WHERE id = ?',
    ).get(dayId) as CashDayRow | undefined;
    if (!day) throw new Error('Ziua de casă nu există.');
    if (day.is_closed) throw new Error('Soldul unei zile închise nu poate fi inițializat.');

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

    let adjustmentId: number | null = null;
    if (difference !== 0) {
      adjustmentId = Number(connection.prepare(`
        INSERT INTO cash_transactions (cash_day_id, type, category, amount, notes)
        VALUES (?, ?, 'cash_adjustment', ?, ?)
      `).run(
        dayId,
        difference > 0 ? 'IN' : 'OUT',
        Math.abs(difference),
        `Inițializare unică sold casă: £${actualBalance.toFixed(2)}`,
      ).lastInsertRowid);
    }

    connection.prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?)',
    ).run(CASH_BALANCE_INITIALIZED_KEY, actualBalance.toFixed(2));
    return { adjustmentId, currentBalance: actualBalance };
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
    product.current_stock = requireStoredStock(product.current_stock, 'Stocul produsului finit');

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
        product.current_stock = requireStoredStock(product.current_stock, `Stocul produsului ${product.name}`);
        requestedByProduct.set(productId, { product, quantity: itemQuantity });
      }
    }
    if (items.length > 0 && Math.abs(calculatedAmount - amount) > 0.01) {
      throw new Error('Suma tranzacției nu corespunde produselor vândute.');
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

export function closeCashDayTransaction(
  connection: SqliteDatabase,
  dayIdInput: number,
  todayInput = localIsoDate(),
) {
  const dayId = requirePositiveInteger(dayIdInput, 'Ziua de casă');
  const today = requireIsoDate(todayInput, 'Data curentă');

  return connection.transaction(() => {
    const day = connection.prepare(
      'SELECT id, date, opening_balance, is_closed FROM cash_days WHERE id = ?',
    ).get(dayId) as CashDayRow | undefined;
    if (!day) throw new Error('Ziua de casă nu există.');
    if (day.is_closed) throw new Error('Ziua de casă este deja închisă.');
    if (day.date !== today) throw new Error('Numai ziua curentă poate fi închisă manual.');
    const totals = connection.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'IN' THEN amount ELSE 0 END), 0) AS total_in,
        COALESCE(SUM(CASE WHEN type = 'OUT' THEN amount ELSE 0 END), 0) AS total_out
      FROM cash_transactions WHERE cash_day_id = ?
    `).get(dayId) as { total_in: number; total_out: number };
    const calculatedBalance = Math.round(
      (Number(day.opening_balance) + Number(totals.total_in) - Number(totals.total_out)) * 100,
    ) / 100;
    const result = connection.prepare(`
      UPDATE cash_days SET is_closed = 1, closing_balance = ?, closed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND is_closed = 0
    `).run(calculatedBalance, dayId);
    if (result.changes !== 1) throw new Error('Ziua de casă nu a putut fi închisă.');
    connection.prepare(`
      INSERT INTO cash_day_events (cash_day_id, event_type, balance)
      VALUES (?, 'manual_close', ?)
    `).run(dayId, calculatedBalance);
    return { dayId, date: day.date, closingBalance: calculatedBalance };
  })();
}

export function reopenCashDayTransaction(
  connection: SqliteDatabase,
  dayIdInput: number,
  todayInput = localIsoDate(),
) {
  const dayId = requirePositiveInteger(dayIdInput, 'Ziua de casă');
  const today = requireIsoDate(todayInput, 'Data curentă');

  return connection.transaction(() => {
    const day = connection.prepare(
      'SELECT id, date, opening_balance, closing_balance, is_closed FROM cash_days WHERE id = ?',
    ).get(dayId) as (CashDayRow & { closing_balance: number | null }) | undefined;
    if (!day) throw new Error('Ziua de casă nu există.');
    if (!day.is_closed) throw new Error('Ziua de casă este deja deschisă.');
    if (day.date !== today) throw new Error('Numai ziua calendaristică actuală poate fi redeschisă.');
    const otherOpenDay = connection.prepare(
      'SELECT id FROM cash_days WHERE is_closed = 0 AND id <> ? LIMIT 1',
    ).get(dayId);
    if (otherOpenDay) throw new Error('Există deja o altă zi de casă deschisă.');

    const previousBalance = day.closing_balance;
    const result = connection.prepare(`
      UPDATE cash_days
      SET is_closed = 0, closing_balance = NULL, closed_at = NULL
      WHERE id = ? AND is_closed = 1
    `).run(dayId);
    if (result.changes !== 1) throw new Error('Ziua de casă nu a putut fi redeschisă.');
    connection.prepare(`
      INSERT INTO cash_day_events (cash_day_id, event_type, balance)
      VALUES (?, 'reopen', ?)
    `).run(dayId, previousBalance);
    return { dayId, date: day.date };
  })();
}

export function deleteCashTransaction(connection: SqliteDatabase, transactionIdInput: number) {
  const transactionId = requirePositiveInteger(transactionIdInput, 'Tranzacția de casă');
  return connection.transaction(() => {
    const cashTransaction = connection.prepare(`
      SELECT t.id, t.category, d.is_closed
      FROM cash_transactions t JOIN cash_days d ON d.id = t.cash_day_id
      WHERE t.id = ?
    `).get(transactionId) as { id: number; category: string; is_closed: number } | undefined;
    if (!cashTransaction) throw new Error('Tranzacția de casă nu există.');
    if (cashTransaction.is_closed) throw new Error('Tranzacțiile unei zile închise nu pot fi șterse.');
    if (cashTransaction.category === 'cash_adjustment') {
      throw new Error('Inițializarea soldului este protejată și nu poate fi ștearsă.');
    }

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
    const deleted = connection.prepare('DELETE FROM cash_transactions WHERE id = ?').run(transactionId);
    if (deleted.changes !== 1) throw new Error('Tranzacția nu a putut fi ștearsă.');
    return true;
  })();
}
