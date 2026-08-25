import type Database from 'better-sqlite3';
import {
  optionalText,
  requireFiniteNonNegative,
  requireFinitePositive,
  requireIsoDate,
  requirePositiveInteger,
  requireText,
} from '../businessValidation.ts';

type SqliteDatabase = Database.Database;

export interface InvoiceItemInput {
  productName: string;
  name_ro?: string;
  variant_label?: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  totalPrice?: number;
}

export interface InvoiceOrderInput {
  storeId: number;
  items: InvoiceItemInput[];
}

export interface WeeklyInvoiceInput extends InvoiceOrderInput {
  storeExternalId: string;
  periodStart: string;
  periodEnd: string;
  sourceFingerprint: string;
  sourceOrders: Array<{ id: string; updatedAt: string }>;
}

export interface CompanyPaymentInput {
  companyId: number;
  invoiceId?: number;
  amount: number;
  paymentDate: string;
  method: string;
  bankName?: string;
  notes?: string;
}

interface InvoiceRow {
  id: number;
  total_amount: number;
  paid_amount: number;
}

function validateInvoiceItems(itemsInput: InvoiceItemInput[]) {
  if (!Array.isArray(itemsInput) || itemsInput.length === 0 || itemsInput.length > 1000) {
    throw new Error('Factura trebuie să conțină între 1 și 1000 de poziții.');
  }
  const items = itemsInput.map((item) => {
    const productName = requireText(item.productName, 'Denumirea produsului', 300);
    const nameRo = optionalText(item.name_ro, 'Denumirea produsului în română', 300);
    const variantLabel = optionalText(item.variant_label, 'Varianta produsului', 200);
    const unit = optionalText(item.unit, 'Unitatea produsului', 50);
    const quantity = requireFinitePositive(item.quantity, `Cantitatea pentru ${productName}`);
    const unitPrice = requireFiniteNonNegative(item.unitPrice, `Prețul pentru ${productName}`);
    const totalPrice = quantity * unitPrice;
    if (!Number.isFinite(totalPrice)) throw new Error(`Totalul pentru ${productName} nu este valid.`);
    return { productName, name_ro: nameRo, variant_label: variantLabel, unit, quantity, unitPrice, totalPrice };
  });
  const totalAmount = items.reduce((sum, item) => sum + item.totalPrice, 0);
  if (!Number.isFinite(totalAmount)) throw new Error('Totalul facturii nu este valid.');
  return { items, totalAmount };
}

export function createInvoiceBatchTransaction(
  connection: SqliteDatabase,
  orders: InvoiceOrderInput[],
  invoiceDateInput: string,
) {
  const invoiceDate = requireIsoDate(invoiceDateInput, 'Data facturii');
  if (!Array.isArray(orders) || orders.length === 0 || orders.length > 500) {
    throw new Error('Lotul trebuie să conțină între 1 și 500 de facturi.');
  }

  return connection.transaction(() => {
    const setting = connection.prepare(
      "SELECT value FROM app_settings WHERE key = 'invoice_start_number'",
    ).get() as { value: string } | undefined;
    let currentNumber = Number.parseInt(setting?.value || '1', 10);
    if (!Number.isSafeInteger(currentNumber) || currentNumber <= 0) {
      throw new Error('Contorul de facturi nu este valid.');
    }

    const storeExists = connection.prepare('SELECT id FROM stores WHERE id = ? AND is_active = 1');
    const insertInvoice = connection.prepare(`
      INSERT INTO invoices (store_id, invoice_number, invoice_date, total_amount, paid_amount, status)
      VALUES (?, ?, ?, ?, 0, 'unpaid')
    `);
    const insertItem = connection.prepare(`
      INSERT INTO invoice_items (invoice_id, product_name, product_name_ro, variant_label, unit, quantity, unit_price, total_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const created: Array<{ invoiceId: number; invoiceNumber: string; totalAmount: number }> = [];

    for (const order of orders) {
      const storeId = requirePositiveInteger(order.storeId, 'Magazinul');
      if (!storeExists.get(storeId)) throw new Error('Magazinul facturat nu există sau este inactiv.');
      const { items, totalAmount } = validateInvoiceItems(order.items);

      const invoiceNumber = String(currentNumber);
      const invoice = insertInvoice.run(storeId, invoiceNumber, invoiceDate, totalAmount);
      const invoiceId = Number(invoice.lastInsertRowid);
      for (const item of items) {
        insertItem.run(invoiceId, item.productName, item.name_ro, item.variant_label, item.unit, item.quantity, item.unitPrice, item.totalPrice);
      }
      created.push({ invoiceId, invoiceNumber, totalAmount });
      currentNumber += 1;
      if (!Number.isSafeInteger(currentNumber)) throw new Error('Contorul de facturi a depășit limita acceptată.');
    }

    connection.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('invoice_start_number', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(currentNumber));
    return created;
  })();
}

export function createWeeklyInvoiceBatchTransaction(
  connection: SqliteDatabase,
  orders: WeeklyInvoiceInput[],
  invoiceDateInput: string,
) {
  const invoiceDate = requireIsoDate(invoiceDateInput, 'Data facturii');
  if (!Array.isArray(orders) || orders.length === 0 || orders.length > 500) {
    throw new Error('Lotul trebuie să conțină între 1 și 500 de facturi.');
  }
  return connection.transaction(() => {
    const setting = connection.prepare("SELECT value FROM app_settings WHERE key = 'invoice_start_number'").get() as { value: string } | undefined;
    let currentNumber = Number.parseInt(setting?.value || '1', 10);
    if (!Number.isSafeInteger(currentNumber) || currentNumber <= 0) throw new Error('Contorul de facturi nu este valid.');
    const storeExists = connection.prepare('SELECT id FROM stores WHERE id = ? AND is_active = 1');
    const existingWeek = connection.prepare(`SELECT invoice_id FROM invoice_import_batches WHERE source = 'vrbaker' AND store_external_id = ? AND period_start = ? AND period_end = ?`);
    const existingOrder = connection.prepare('SELECT external_order_id FROM invoice_source_orders WHERE external_order_id = ?');
    const insertInvoice = connection.prepare("INSERT INTO invoices (store_id, invoice_number, invoice_date, total_amount, paid_amount, status) VALUES (?, ?, ?, ?, 0, 'unpaid')");
    const insertItem = connection.prepare('INSERT INTO invoice_items (invoice_id, product_name, product_name_ro, variant_label, unit, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insertBatch = connection.prepare("INSERT INTO invoice_import_batches (invoice_id, source, store_external_id, period_start, period_end, source_fingerprint) VALUES (?, 'vrbaker', ?, ?, ?, ?)");
    const insertSource = connection.prepare('INSERT INTO invoice_source_orders (batch_id, external_order_id, external_updated_at) VALUES (?, ?, ?)');
    const created: Array<{ invoiceId: number; invoiceNumber: string; totalAmount: number; storeExternalId: string }> = [];
    for (const order of orders) {
      const storeId = requirePositiveInteger(order.storeId, 'Magazinul');
      const externalId = requireText(order.storeExternalId, 'ID-ul extern al magazinului', 64);
      const periodStart = requireIsoDate(order.periodStart, 'Începutul săptămânii');
      const periodEnd = requireIsoDate(order.periodEnd, 'Sfârșitul săptămânii');
      if (!storeExists.get(storeId)) throw new Error('Magazinul facturat nu există sau este inactiv.');
      if (existingWeek.get(externalId, periodStart, periodEnd)) throw new Error('Există deja o factură pentru acest magazin și această săptămână.');
      if (!Array.isArray(order.sourceOrders) || order.sourceOrders.length === 0) throw new Error('Factura nu conține comenzi sursă.');
      for (const source of order.sourceOrders) if (existingOrder.get(source.id)) throw new Error('Una dintre comenzile selectate a fost deja facturată.');
      const { items, totalAmount } = validateInvoiceItems(order.items);
      const invoiceNumber = String(currentNumber);
      const invoice = insertInvoice.run(storeId, invoiceNumber, invoiceDate, totalAmount);
      const invoiceId = Number(invoice.lastInsertRowid);
      for (const item of items) insertItem.run(invoiceId, item.productName, item.name_ro, item.variant_label, item.unit, item.quantity, item.unitPrice, item.totalPrice);
      const batchId = Number(insertBatch.run(invoiceId, externalId, periodStart, periodEnd, requireText(order.sourceFingerprint, 'Amprenta sursei', 128)).lastInsertRowid);
      for (const source of order.sourceOrders) insertSource.run(batchId, requireText(source.id, 'ID comandă', 64), requireText(source.updatedAt, 'Actualizarea comenzii', 100));
      created.push({ invoiceId, invoiceNumber, totalAmount, storeExternalId: externalId });
      currentNumber += 1;
    }
    connection.prepare("INSERT INTO app_settings (key, value) VALUES ('invoice_start_number', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(currentNumber));
    return created;
  })();
}

export function recordCompanyPaymentTransaction(connection: SqliteDatabase, data: CompanyPaymentInput) {
  const companyId = requirePositiveInteger(data.companyId, 'Compania');
  const invoiceId = data.invoiceId === undefined
    ? undefined
    : requirePositiveInteger(data.invoiceId, 'Factura');
  const amount = requireFinitePositive(data.amount, 'Suma încasată');
  const paymentDate = requireIsoDate(data.paymentDate, 'Data plății');
  const method = requireText(data.method, 'Metoda de plată', 100);
  const bankName = optionalText(data.bankName, 'Numele băncii', 200);
  const notes = optionalText(data.notes, 'Observațiile plății');

  return connection.transaction(() => {
    const company = connection.prepare(
      'SELECT client_id, credit_balance FROM companies WHERE id = ? AND is_active = 1',
    ).get(companyId) as { client_id: number; credit_balance: number } | undefined;
    if (!company) throw new Error('Compania nu există sau este inactivă.');
    const currentCredit = requireFiniteNonNegative(company.credit_balance ?? 0, 'Soldul de credit al companiei');

    let remaining = amount;
    const allocations: Array<{ invoiceId: number | null; amount: number }> = [];
    const insertPayment = connection.prepare(`
      INSERT INTO payments (client_id, company_id, invoice_id, amount, payment_date, method, bank_name, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateInvoice = connection.prepare(
      'UPDATE invoices SET paid_amount = ?, status = ? WHERE id = ?',
    );

    const allocateToInvoice = (invoice: InvoiceRow, allocationNotes: string | null) => {
      const total = requireFiniteNonNegative(invoice.total_amount, 'Totalul facturii');
      const paid = requireFiniteNonNegative(invoice.paid_amount, 'Suma achitată a facturii');
      if (paid > total + 0.01) throw new Error('Factura are o sumă achitată mai mare decât totalul.');
      const due = Math.max(0, total - paid);
      const allocated = Math.min(remaining, due);
      if (allocated <= 0) return;
      const newPaid = paid + allocated;
      const status = newPaid >= total - 0.01 ? 'paid' : 'partial';
      insertPayment.run(
        company.client_id,
        companyId,
        invoice.id,
        allocated,
        paymentDate,
        method,
        bankName,
        allocationNotes,
      );
      updateInvoice.run(newPaid, status, invoice.id);
      allocations.push({ invoiceId: invoice.id, amount: allocated });
      remaining -= allocated;
    };

    if (invoiceId) {
      const selected = connection.prepare(`
        SELECT i.id, i.total_amount, i.paid_amount
        FROM invoices i JOIN stores s ON s.id = i.store_id
        WHERE i.id = ? AND s.company_id = ?
      `).get(invoiceId, companyId) as InvoiceRow | undefined;
      if (!selected) throw new Error('Factura nu aparține companiei selectate.');
      allocateToInvoice(selected, notes);
    }

    if (remaining > 0) {
      const unpaid = connection.prepare(`
        SELECT i.id, i.total_amount, i.paid_amount
        FROM invoices i JOIN stores s ON s.id = i.store_id
        WHERE s.company_id = ? AND (i.total_amount - i.paid_amount) > 0.01
          AND (? IS NULL OR i.id != ?)
        ORDER BY i.invoice_date ASC, i.id ASC
      `).all(companyId, invoiceId || null, invoiceId || null) as InvoiceRow[];
      for (const invoice of unpaid) {
        if (remaining <= 0.000001) break;
        allocateToInvoice(
          invoice,
          notes ? `${notes} (Distribuire automată surplus)` : 'Distribuire automată surplus pe factură restantă',
        );
      }
    }

    if (remaining > 0.000001) {
      const creditNotes = notes
        ? `${notes} (Avans / Credit companie)`
        : 'Avans / Credit înregistrat în balanța companiei';
      insertPayment.run(
        company.client_id,
        companyId,
        null,
        remaining,
        paymentDate,
        method,
        bankName,
        creditNotes,
      );
      const newCredit = currentCredit + remaining;
      connection.prepare('UPDATE companies SET credit_balance = ? WHERE id = ?').run(newCredit, companyId);
      allocations.push({ invoiceId: null, amount: remaining });
      remaining = 0;
    }

    return { allocations };
  })();
}

export function updateInvoiceTransaction(
  connection: SqliteDatabase,
  invoiceIdInput: number,
  invoiceNumberInput: string,
  invoiceDateInput: string,
  itemsInput: InvoiceItemInput[],
) {
  const invoiceId = requirePositiveInteger(invoiceIdInput, 'Factura');
  const invoiceNumber = requireText(invoiceNumberInput, 'Numărul facturii', 100);
  const invoiceDate = requireIsoDate(invoiceDateInput, 'Data facturii');
  const { items, totalAmount } = validateInvoiceItems(itemsInput);

  return connection.transaction(() => {
    const imported = connection.prepare('SELECT 1 FROM invoice_import_batches WHERE invoice_id = ?').get(invoiceId);
    if (imported) {
      throw new Error('Factura importată din VR Baker nu poate fi modificată automat; diferențele se rezolvă manual.');
    }
    const existing = connection.prepare(
      'SELECT paid_amount FROM invoices WHERE id = ?',
    ).get(invoiceId) as { paid_amount: number } | undefined;
    if (!existing) throw new Error('Factura nu există.');
    const paidAmount = requireFiniteNonNegative(existing.paid_amount, 'Suma achitată a facturii');
    if (paidAmount > totalAmount + 0.01) {
      throw new Error('Totalul facturii nu poate fi mai mic decât suma deja achitată.');
    }
    const status = paidAmount <= 0.000001
      ? 'unpaid'
      : paidAmount >= totalAmount - 0.01 ? 'paid' : 'partial';
    const result = connection.prepare(`
      UPDATE invoices SET invoice_number = ?, invoice_date = ?, total_amount = ?, status = ?
      WHERE id = ?
    `).run(invoiceNumber, invoiceDate, totalAmount, status, invoiceId);
    if (result.changes !== 1) throw new Error('Factura nu a putut fi actualizată.');

    connection.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
    const insertItem = connection.prepare(`
      INSERT INTO invoice_items (invoice_id, product_name, product_name_ro, variant_label, unit, quantity, unit_price, total_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      insertItem.run(invoiceId, item.productName, item.name_ro, item.variant_label, item.unit, item.quantity, item.unitPrice, item.totalPrice);
    }
    return { invoiceId, totalAmount, paidAmount, status };
  })();
}

export function deleteUnpaidInvoiceTransaction(connection: SqliteDatabase, invoiceIdInput: number) {
  const invoiceId = requirePositiveInteger(invoiceIdInput, 'Factura');
  return connection.transaction(() => {
    const invoice = connection.prepare(
      'SELECT paid_amount FROM invoices WHERE id = ?',
    ).get(invoiceId) as { paid_amount: number } | undefined;
    if (!invoice) throw new Error('Factura nu există.');
    const paidAmount = requireFiniteNonNegative(invoice.paid_amount, 'Suma achitată a facturii');
    const paymentCount = (connection.prepare(
      'SELECT COUNT(*) AS count FROM payments WHERE invoice_id = ?',
    ).get(invoiceId) as { count: number }).count;
    if (paidAmount > 0.000001 || paymentCount > 0) {
      throw new Error('O factură cu plăți înregistrate nu poate fi ștearsă.');
    }
    connection.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
    const result = connection.prepare('DELETE FROM invoices WHERE id = ?').run(invoiceId);
    if (result.changes !== 1) throw new Error('Factura nu a putut fi ștearsă.');
    return true;
  })();
}
