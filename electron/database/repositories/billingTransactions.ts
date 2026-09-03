import type Database from 'better-sqlite3';
import {
  optionalText,
  requireFiniteNonNegative,
  requireFinitePositive,
  requireIsoDate,
  requireMoneyPositive,
  requirePositiveInteger,
  requireText,
} from '../businessValidation.ts';
import {
  isIssuerReady,
  issuerSnapshot,
  type BillingIssuerRow,
} from '../billingIssuers.ts';
import {
  addPaymentCreditEntry,
  getInvoiceFinancials,
  syncCompanyCreditBalance,
  syncInvoiceFinancialStatus,
} from '../creditNotes.ts';

type SqliteDatabase = Database.Database;
const EPSILON = 0.005;

function ensureInvoiceProductColumns(connection: SqliteDatabase) {
  const columns = new Set((connection.prepare('PRAGMA table_info(invoice_items)').all() as Array<{ name: string }>).map((row) => row.name));
  if (!columns.has('external_product_id')) connection.exec('ALTER TABLE invoice_items ADD COLUMN external_product_id TEXT;');
  if (!columns.has('finished_product_id')) connection.exec('ALTER TABLE invoice_items ADD COLUMN finished_product_id INTEGER;');
}

export interface InvoiceItemInput {
  productName: string;
  name_ro?: string;
  variant_label?: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  totalPrice?: number;
  externalProductId?: string;
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
  issuerId?: number;
  invoiceId?: number;
  amount: number;
  paymentDate: string;
  method: string;
  bankName?: string;
  notes?: string;
}

export interface UpdatePaymentInput {
  id: number;
  amount: number;
  method: 'cash' | 'transfer';
  bankName?: string;
  reason: string;
}

interface InvoiceRow {
  id: number;
  total_amount: number;
  paid_amount: number;
}

function recordIssuerPaymentTransaction(connection: SqliteDatabase, data: CompanyPaymentInput) {
  const companyId = requirePositiveInteger(data.companyId, 'Compania');
  const invoiceId = data.invoiceId === undefined ? undefined : requirePositiveInteger(data.invoiceId, 'Factura');
  const amount = requireFinitePositive(data.amount, 'Suma încasată');
  const paymentDate = requireIsoDate(data.paymentDate, 'Data plății');
  const method = requireText(data.method, 'Metoda de plată', 100);
  const bankName = optionalText(data.bankName, 'Numele băncii', 200);
  const notes = optionalText(data.notes, 'Observațiile plății');

  return connection.transaction(() => {
    const hasCreditLedger = Boolean(connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'company_credit_entries'").get());
    const company = connection.prepare('SELECT client_id, issuer_id FROM companies WHERE id = ? AND is_active = 1').get(companyId) as { client_id: number; issuer_id: number | null } | undefined;
    if (!company) throw new Error('Compania nu există sau este inactivă.');
    let issuerId = data.issuerId === undefined ? undefined : requirePositiveInteger(data.issuerId, 'Emitentul');
    if (invoiceId) {
      const identity = connection.prepare(`
        SELECT ii.issuer_id FROM invoice_identities ii
        JOIN invoices i ON i.id = ii.invoice_id JOIN stores s ON s.id = i.store_id
        WHERE ii.invoice_id = ? AND s.company_id = ? AND i.status != 'cancelled'
      `).get(invoiceId, companyId) as { issuer_id: number } | undefined;
      if (!identity) throw new Error('Factura nu aparține companiei selectate sau este anulată.');
      if (issuerId && issuerId !== identity.issuer_id) throw new Error('Factura aparține altei societăți emitente.');
      issuerId = identity.issuer_id;
    }
    issuerId ||= company.issuer_id || undefined;
    if (!issuerId) throw new Error('Selectează societatea emitentă pentru această încasare.');
    const issuer = connection.prepare('SELECT id FROM billing_issuers WHERE id = ? AND is_active = 1').get(issuerId);
    if (!issuer) throw new Error('Societatea emitentă nu este activă.');

    connection.prepare('INSERT OR IGNORE INTO company_issuer_credits (company_id, issuer_id, balance) VALUES (?, ?, 0)').run(companyId, issuerId);
    const creditRow = connection.prepare('SELECT balance FROM company_issuer_credits WHERE company_id = ? AND issuer_id = ?').get(companyId, issuerId) as { balance: number };
    const currentCredit = requireFiniteNonNegative(creditRow.balance, 'Soldul de credit al companiei');
    let remaining = amount;
    const allocations: Array<{ invoiceId: number | null; amount: number }> = [];
    const insertPayment = connection.prepare(`
      INSERT INTO payments (client_id, company_id, invoice_id, issuer_id, amount, payment_date, method, bank_name, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateInvoice = connection.prepare('UPDATE invoices SET paid_amount = ?, status = ? WHERE id = ?');
    const allocateToInvoice = (invoice: InvoiceRow, allocationNotes: string | null) => {
      const total = requireFiniteNonNegative(invoice.total_amount, 'Totalul facturii');
      const paid = requireFiniteNonNegative(invoice.paid_amount, 'Suma achitată a facturii');
      const due = hasCreditLedger ? getInvoiceFinancials(connection, invoice.id).outstanding : Math.max(0, total - paid);
      const allocated = Math.min(remaining, due);
      if (allocated <= 0) return;
      const newPaid = paid + allocated;
      insertPayment.run(company.client_id, companyId, invoice.id, issuerId, allocated, paymentDate, method, bankName, allocationNotes);
      updateInvoice.run(newPaid, newPaid >= total - 0.01 ? 'paid' : 'partial', invoice.id);
      if (hasCreditLedger) syncInvoiceFinancialStatus(connection, invoice.id);
      allocations.push({ invoiceId: invoice.id, amount: allocated });
      remaining -= allocated;
    };

    if (invoiceId) {
      const selected = connection.prepare(`
        SELECT i.id, i.total_amount, i.paid_amount FROM invoices i
        JOIN stores s ON s.id = i.store_id JOIN invoice_identities ii ON ii.invoice_id = i.id
        WHERE i.id = ? AND s.company_id = ? AND ii.issuer_id = ? AND i.status != 'cancelled'
      `).get(invoiceId, companyId, issuerId) as InvoiceRow | undefined;
      if (!selected) throw new Error('Factura nu aparține companiei și emitentului selectat.');
      allocateToInvoice(selected, notes);
    }
    if (remaining > 0.000001) {
      const unpaid = connection.prepare(`
        SELECT i.id, i.total_amount, i.paid_amount FROM invoices i
        JOIN stores s ON s.id = i.store_id JOIN invoice_identities ii ON ii.invoice_id = i.id
        WHERE s.company_id = ? AND ii.issuer_id = ? AND i.status != 'cancelled'
          AND (? IS NULL OR i.id != ?)
        ORDER BY i.invoice_date ASC, i.id ASC
      `).all(companyId, issuerId, invoiceId || null, invoiceId || null) as InvoiceRow[];
      for (const invoice of unpaid) {
        if (remaining <= 0.000001) break;
        if (hasCreditLedger && getInvoiceFinancials(connection, invoice.id).outstanding <= EPSILON) continue;
        if (!hasCreditLedger && invoice.total_amount - invoice.paid_amount <= 0.01) continue;
        allocateToInvoice(invoice, notes ? `${notes} (Distribuire automată surplus)` : 'Distribuire automată surplus pe factură restantă');
      }
    }
    if (remaining > 0.000001) {
      const creditNotes = notes ? `${notes} (Avans / Credit companie)` : 'Avans / Credit înregistrat în balanța companiei';
      const payment = insertPayment.run(company.client_id, companyId, null, issuerId, remaining, paymentDate, method, bankName, creditNotes);
      if (hasCreditLedger) addPaymentCreditEntry(connection, companyId, issuerId, Number(payment.lastInsertRowid), remaining);
      else connection.prepare('UPDATE company_issuer_credits SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE company_id = ? AND issuer_id = ?').run(currentCredit + remaining, companyId, issuerId);
      allocations.push({ invoiceId: null, amount: remaining });
      remaining = 0;
    }
    if (!hasCreditLedger) {
      const aggregateCredit = (connection.prepare('SELECT COALESCE(SUM(balance), 0) AS value FROM company_issuer_credits WHERE company_id = ?').get(companyId) as { value: number }).value;
      connection.prepare('UPDATE companies SET credit_balance = ? WHERE id = ?').run(aggregateCredit, companyId);
    }
    connection.prepare(`INSERT INTO billing_audit_events (event_type, issuer_id, company_id, details) VALUES ('payment_recorded', ?, ?, ?)`)
      .run(issuerId, companyId, JSON.stringify({ amount, invoiceId: invoiceId || null, allocations: allocations.length }));
    return { allocations, issuerId };
  })();
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
    const externalProductId = optionalText(item.externalProductId, 'ID-ul extern al produsului', 100);
    return { productName, name_ro: nameRo, variant_label: variantLabel, unit, quantity, unitPrice, totalPrice, externalProductId };
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
  ensureInvoiceProductColumns(connection);
  const invoiceDate = requireIsoDate(invoiceDateInput, 'Data facturii');
  if (!Array.isArray(orders) || orders.length === 0 || orders.length > 500) {
    throw new Error('Lotul trebuie să conțină între 1 și 500 de facturi.');
  }

  return connection.transaction(() => {
    const hasIssuerSchema = Boolean(connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'billing_issuers'").get());
    if (hasIssuerSchema) {
      const resolveStore = connection.prepare(`SELECT s.id, c.issuer_id FROM stores s JOIN companies c ON c.id = s.company_id WHERE s.id = ? AND s.is_active = 1 AND c.is_active = 1`);
      const getIssuer = connection.prepare('SELECT * FROM billing_issuers WHERE id = ?');
      const prepared = orders.map((order) => {
        const storeId = requirePositiveInteger(order.storeId, 'Magazinul');
        const store = resolveStore.get(storeId) as { id: number; issuer_id: number | null } | undefined;
        if (!store?.issuer_id) throw new Error('Magazinul nu există sau compania sa nu are emitent.');
        const issuer = getIssuer.get(store.issuer_id) as BillingIssuerRow | undefined;
        if (!issuer || !isIssuerReady(issuer)) throw new Error('Emitentul companiei nu este activ și configurat complet.');
        return { storeId, issuer, ...validateInvoiceItems(order.items) };
      });
      const nextByIssuer = new Map<number, number>();
      const insertInvoice = connection.prepare("INSERT INTO invoices (store_id, invoice_number, invoice_date, total_amount, paid_amount, status) VALUES (?, ?, ?, ?, 0, 'unpaid')");
      const insertIdentity = connection.prepare('INSERT INTO invoice_identities (invoice_id, issuer_id, series, sequence_number, reference, issuer_snapshot_json) VALUES (?, ?, ?, ?, ?, ?)');
      const insertItem = connection.prepare('INSERT INTO invoice_items (invoice_id, product_name, product_name_ro, variant_label, unit, quantity, unit_price, total_price, external_product_id, finished_product_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT id FROM finished_products WHERE external_product_id = ? LIMIT 1))');
      const created: Array<{ invoiceId: number; invoiceNumber: string; totalAmount: number; issuerId: number; issuerSettings: ReturnType<typeof issuerSnapshot> }> = [];
      for (const row of prepared) {
        const sequence = nextByIssuer.get(row.issuer.id) ?? row.issuer.next_invoice_number;
        const reference = `${row.issuer.invoice_series}-${sequence}`;
        const invoiceId = Number(insertInvoice.run(row.storeId, reference, invoiceDate, row.totalAmount).lastInsertRowid);
        const snapshot = issuerSnapshot(row.issuer);
        insertIdentity.run(invoiceId, row.issuer.id, row.issuer.invoice_series, sequence, reference, JSON.stringify(snapshot));
        for (const item of row.items) insertItem.run(invoiceId, item.productName, item.name_ro, item.variant_label, item.unit, item.quantity, item.unitPrice, item.totalPrice, item.externalProductId, item.externalProductId);
        created.push({ invoiceId, invoiceNumber: reference, totalAmount: row.totalAmount, issuerId: row.issuer.id, issuerSettings: snapshot });
        nextByIssuer.set(row.issuer.id, sequence + 1);
      }
      for (const [issuerId, next] of nextByIssuer) {
        const original = prepared.find((row) => row.issuer.id === issuerId)!.issuer.next_invoice_number;
        if (connection.prepare('UPDATE billing_issuers SET next_invoice_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND next_invoice_number = ?').run(next, issuerId, original).changes !== 1) throw new Error('Contorul emitentului a fost modificat concurent.');
        connection.prepare(`INSERT INTO billing_audit_events (event_type, issuer_id, details) VALUES ('invoice_batch_issued', ?, ?)`)
          .run(issuerId, JSON.stringify({ count: created.filter((invoice) => invoice.issuerId === issuerId).length, firstSequence: original, nextSequence: next }));
      }
      return created;
    }

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
      INSERT INTO invoice_items (invoice_id, product_name, product_name_ro, variant_label, unit, quantity, unit_price, total_price, external_product_id, finished_product_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT id FROM finished_products WHERE external_product_id = ? LIMIT 1))
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
        insertItem.run(invoiceId, item.productName, item.name_ro, item.variant_label, item.unit, item.quantity, item.unitPrice, item.totalPrice, item.externalProductId, item.externalProductId);
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
  ensureInvoiceProductColumns(connection);
  const invoiceDate = requireIsoDate(invoiceDateInput, 'Data facturii');
  if (!Array.isArray(orders) || orders.length === 0 || orders.length > 500) {
    throw new Error('Lotul trebuie să conțină între 1 și 500 de facturi.');
  }
  return connection.transaction(() => {
    const hasIssuerSchema = Boolean(connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'billing_issuers'").get());
    if (hasIssuerSchema) {
      const existingWeek = connection.prepare(`SELECT invoice_id FROM invoice_import_batches WHERE source = 'vrbaker' AND store_external_id = ? AND period_start = ? AND period_end = ?`);
      const existingOrder = connection.prepare('SELECT external_order_id FROM invoice_source_orders WHERE external_order_id = ?');
      const resolveStore = connection.prepare(`
        SELECT s.id, c.issuer_id
        FROM stores s JOIN companies c ON c.id = s.company_id
        WHERE s.id = ? AND s.is_active = 1 AND c.is_active = 1
      `);
      const getIssuer = connection.prepare('SELECT * FROM billing_issuers WHERE id = ?');
      const insertInvoice = connection.prepare("INSERT INTO invoices (store_id, invoice_number, invoice_date, total_amount, paid_amount, status) VALUES (?, ?, ?, ?, 0, 'unpaid')");
      const insertIdentity = connection.prepare(`
        INSERT INTO invoice_identities (invoice_id, issuer_id, series, sequence_number, reference, issuer_snapshot_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const insertItem = connection.prepare('INSERT INTO invoice_items (invoice_id, product_name, product_name_ro, variant_label, unit, quantity, unit_price, total_price, external_product_id, finished_product_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT id FROM finished_products WHERE external_product_id = ? LIMIT 1))');
      const insertBatch = connection.prepare("INSERT INTO invoice_import_batches (invoice_id, source, store_external_id, period_start, period_end, source_fingerprint) VALUES (?, 'vrbaker', ?, ?, ?, ?)");
      const insertSource = connection.prepare('INSERT INTO invoice_source_orders (batch_id, external_order_id, external_updated_at) VALUES (?, ?, ?)');
      const prepared: Array<{
        order: WeeklyInvoiceInput;
        storeId: number;
        externalId: string;
        periodStart: string;
        periodEnd: string;
        issuer: BillingIssuerRow;
        items: ReturnType<typeof validateInvoiceItems>['items'];
        totalAmount: number;
      }> = [];
      const nextByIssuer = new Map<number, number>();

      for (const order of orders) {
        const storeId = requirePositiveInteger(order.storeId, 'Magazinul');
        const externalId = requireText(order.storeExternalId, 'ID-ul extern al magazinului', 64);
        const periodStart = requireIsoDate(order.periodStart, 'Începutul săptămânii');
        const periodEnd = requireIsoDate(order.periodEnd, 'Sfârșitul săptămânii');
        const store = resolveStore.get(storeId) as { id: number; issuer_id: number | null } | undefined;
        if (!store) throw new Error('Magazinul facturat nu există sau este inactiv.');
        if (!store.issuer_id) throw new Error('Compania magazinului nu are un emitent atribuit.');
        const issuer = getIssuer.get(store.issuer_id) as BillingIssuerRow | undefined;
        if (!issuer || !isIssuerReady(issuer)) throw new Error('Emitentul companiei nu este activ și configurat complet.');
        if (existingWeek.get(externalId, periodStart, periodEnd)) throw new Error('Există deja o factură pentru acest magazin și această săptămână.');
        if (!Array.isArray(order.sourceOrders) || order.sourceOrders.length === 0) throw new Error('Factura nu conține comenzi sursă.');
        for (const source of order.sourceOrders) if (existingOrder.get(source.id)) throw new Error('Una dintre comenzile selectate a fost deja facturată.');
        const validated = validateInvoiceItems(order.items);
        prepared.push({ order, storeId, externalId, periodStart, periodEnd, issuer, ...validated });
        if (!nextByIssuer.has(issuer.id)) nextByIssuer.set(issuer.id, issuer.next_invoice_number);
      }

      const created: Array<{
        invoiceId: number;
        invoiceNumber: string;
        invoiceSequence: number;
        totalAmount: number;
        storeExternalId: string;
        issuerId: number;
        issuerSettings: ReturnType<typeof issuerSnapshot>;
      }> = [];
      for (const row of prepared) {
        const sequence = nextByIssuer.get(row.issuer.id)!;
        if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error('Contorul emitentului nu este valid.');
        const reference = `${row.issuer.invoice_series}-${sequence}`;
        const snapshot = issuerSnapshot(row.issuer);
        const invoice = insertInvoice.run(row.storeId, reference, invoiceDate, row.totalAmount);
        const invoiceId = Number(invoice.lastInsertRowid);
        insertIdentity.run(invoiceId, row.issuer.id, row.issuer.invoice_series, sequence, reference, JSON.stringify(snapshot));
        for (const item of row.items) insertItem.run(invoiceId, item.productName, item.name_ro, item.variant_label, item.unit, item.quantity, item.unitPrice, item.totalPrice, item.externalProductId, item.externalProductId);
        const batchId = Number(insertBatch.run(invoiceId, row.externalId, row.periodStart, row.periodEnd, requireText(row.order.sourceFingerprint, 'Amprenta sursei', 128)).lastInsertRowid);
        for (const source of row.order.sourceOrders) insertSource.run(batchId, requireText(source.id, 'ID comandă', 64), requireText(source.updatedAt, 'Actualizarea comenzii', 100));
        created.push({ invoiceId, invoiceNumber: reference, invoiceSequence: sequence, totalAmount: row.totalAmount, storeExternalId: row.externalId, issuerId: row.issuer.id, issuerSettings: snapshot });
        nextByIssuer.set(row.issuer.id, sequence + 1);
      }
      const updateCounter = connection.prepare('UPDATE billing_issuers SET next_invoice_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND next_invoice_number = ?');
      for (const [issuerId, next] of nextByIssuer) {
        const original = prepared.find((row) => row.issuer.id === issuerId)!.issuer.next_invoice_number;
        if (updateCounter.run(next, issuerId, original).changes !== 1) throw new Error('Contorul emitentului a fost modificat concurent. Reîncearcă emiterea.');
        connection.prepare(`INSERT INTO billing_audit_events (event_type, issuer_id, details) VALUES ('weekly_invoice_batch_issued', ?, ?)`)
          .run(issuerId, JSON.stringify({ count: created.filter((invoice) => invoice.issuerId === issuerId).length, firstSequence: original, nextSequence: next }));
      }
      return created;
    }

    const setting = connection.prepare("SELECT value FROM app_settings WHERE key = 'invoice_start_number'").get() as { value: string } | undefined;
    let currentNumber = Number.parseInt(setting?.value || '1', 10);
    if (!Number.isSafeInteger(currentNumber) || currentNumber <= 0) throw new Error('Contorul de facturi nu este valid.');
    const storeExists = connection.prepare('SELECT id FROM stores WHERE id = ? AND is_active = 1');
    const existingWeek = connection.prepare(`SELECT invoice_id FROM invoice_import_batches WHERE source = 'vrbaker' AND store_external_id = ? AND period_start = ? AND period_end = ?`);
    const existingOrder = connection.prepare('SELECT external_order_id FROM invoice_source_orders WHERE external_order_id = ?');
    const insertInvoice = connection.prepare("INSERT INTO invoices (store_id, invoice_number, invoice_date, total_amount, paid_amount, status) VALUES (?, ?, ?, ?, 0, 'unpaid')");
    const insertItem = connection.prepare('INSERT INTO invoice_items (invoice_id, product_name, product_name_ro, variant_label, unit, quantity, unit_price, total_price, external_product_id, finished_product_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT id FROM finished_products WHERE external_product_id = ? LIMIT 1))');
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
      for (const item of items) insertItem.run(invoiceId, item.productName, item.name_ro, item.variant_label, item.unit, item.quantity, item.unitPrice, item.totalPrice, item.externalProductId, item.externalProductId);
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
  const hasIssuerSchema = Boolean(connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'billing_issuers'").get());
  if (hasIssuerSchema) return recordIssuerPaymentTransaction(connection, data);
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
  ensureInvoiceProductColumns(connection);
  const invoiceId = requirePositiveInteger(invoiceIdInput, 'Factura');
  const invoiceNumber = requireText(invoiceNumberInput, 'Numărul facturii', 100);
  const invoiceDate = requireIsoDate(invoiceDateInput, 'Data facturii');
  const { items, totalAmount } = validateInvoiceItems(itemsInput);

  return connection.transaction(() => {
    const imported = connection.prepare('SELECT 1 FROM invoice_import_batches WHERE invoice_id = ?').get(invoiceId);
    if (imported) {
      throw new Error('Factura importată din VR Baker nu poate fi modificată automat; diferențele se rezolvă manual.');
    }
    if (connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'credit_note_invoice_links'").get()) {
      const credited = connection.prepare(`SELECT 1 FROM credit_note_invoice_links link JOIN credit_notes cn ON cn.id = link.credit_note_id WHERE link.invoice_id = ? AND cn.status = 'issued' LIMIT 1`).get(invoiceId);
      const applied = connection.prepare('SELECT 1 FROM invoice_credit_applications WHERE invoice_id = ? AND reversed_at IS NULL LIMIT 1').get(invoiceId);
      if (credited || applied) throw new Error('Factura cu Credit Notes sau credit aplicat nu mai poate fi editată.');
    }
    const existing = connection.prepare(
      'SELECT paid_amount, status FROM invoices WHERE id = ?',
    ).get(invoiceId) as { paid_amount: number; status: string } | undefined;
    if (!existing) throw new Error('Factura nu există.');
    if (existing.status === 'cancelled') throw new Error('O factură anulată nu poate fi modificată.');
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
      INSERT INTO invoice_items (invoice_id, product_name, product_name_ro, variant_label, unit, quantity, unit_price, total_price, external_product_id, finished_product_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT id FROM finished_products WHERE external_product_id = ? LIMIT 1))
    `);
    for (const item of items) {
      insertItem.run(invoiceId, item.productName, item.name_ro, item.variant_label, item.unit, item.quantity, item.unitPrice, item.totalPrice, item.externalProductId, item.externalProductId);
    }
    return { invoiceId, totalAmount, paidAmount, status };
  })();
}

export function cancelInvoiceTransaction(connection: SqliteDatabase, invoiceIdInput: number, reasonInput: string) {
  const invoiceId = requirePositiveInteger(invoiceIdInput, 'Factura');
  const reason = requireText(reasonInput, 'Motivul anulării', 500);
  return connection.transaction(() => {
    const invoice = connection.prepare('SELECT paid_amount, status FROM invoices WHERE id = ?').get(invoiceId) as { paid_amount: number; status: string } | undefined;
    if (!invoice) throw new Error('Factura nu există.');
    if (invoice.status === 'cancelled') throw new Error('Factura este deja anulată.');
    const paymentCount = (connection.prepare('SELECT COUNT(*) AS count FROM payments WHERE invoice_id = ?').get(invoiceId) as { count: number }).count;
    if (requireFiniteNonNegative(invoice.paid_amount, 'Suma achitată a facturii') > 0.000001 || paymentCount > 0) {
      throw new Error('O factură cu plăți înregistrate nu poate fi anulată.');
    }
    if (connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'credit_note_invoice_links'").get()) {
      if (connection.prepare(`SELECT 1 FROM credit_note_invoice_links link JOIN credit_notes cn ON cn.id = link.credit_note_id WHERE link.invoice_id = ? AND cn.status = 'issued' LIMIT 1`).get(invoiceId)) {
        throw new Error('Factura are un Credit Note emis și nu poate fi anulată.');
      }
      if (connection.prepare('SELECT 1 FROM invoice_credit_applications WHERE invoice_id = ? AND reversed_at IS NULL LIMIT 1').get(invoiceId)) {
        throw new Error('Factura are credit aplicat și nu poate fi anulată.');
      }
    }
    const identity = connection.prepare('SELECT issuer_id FROM invoice_identities WHERE invoice_id = ?').get(invoiceId) as { issuer_id: number } | undefined;
    if (!identity) throw new Error('Identitatea emitentului facturii lipsește.');
    connection.prepare(`
      UPDATE invoices SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancellation_reason = ? WHERE id = ?
    `).run(reason, invoiceId);
    connection.prepare(`INSERT INTO billing_audit_events (event_type, issuer_id, invoice_id, details) VALUES ('invoice_cancelled', ?, ?, ?)`)
      .run(identity.issuer_id, invoiceId, JSON.stringify({ reason }));
    return true;
  })();
}

export function getBillingTestMode(connection: SqliteDatabase) {
  const row = connection.prepare("SELECT value FROM app_settings WHERE key = 'billing_test_mode'").get() as { value: string } | undefined;
  return row?.value === '1';
}

export function setBillingTestModeTransaction(connection: SqliteDatabase, enabledInput: boolean, confirmationInput: string) {
  const enabled = enabledInput === true;
  const expected = enabled ? 'MOD TEST' : 'INCEP LIVE';
  const confirmation = requireText(confirmationInput, 'Confirmarea modului de facturare', 50).toLocaleUpperCase('ro-RO');
  if (confirmation !== expected) throw new Error(`Pentru confirmare scrie exact: ${expected}`);
  return connection.transaction(() => {
    connection.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('billing_test_mode', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(enabled ? '1' : '0');
    connection.prepare("INSERT INTO billing_audit_events (event_type, details) VALUES ('billing_test_mode_changed', ?)")
      .run(JSON.stringify({ enabled }));
    return { enabled };
  })();
}

export function deleteInvoiceForTestingTransaction(connection: SqliteDatabase, invoiceIdInput: number, confirmationInput: string) {
  const invoiceId = requirePositiveInteger(invoiceIdInput, 'Factura');
  if (!getBillingTestMode(connection)) throw new Error('Ștergerea definitivă este disponibilă numai când Modul test facturare este activ.');

  return connection.transaction(() => {
    const invoice = connection.prepare(`
      SELECT i.id, i.invoice_number, i.paid_amount, i.pdf_path, s.company_id,
             ii.issuer_id, ii.series, ii.sequence_number, ii.reference
      FROM invoices i
      JOIN stores s ON s.id = i.store_id
      JOIN invoice_identities ii ON ii.invoice_id = i.id
      WHERE i.id = ?
    `).get(invoiceId) as {
      id: number; invoice_number: string; paid_amount: number; pdf_path: string | null; company_id: number;
      issuer_id: number; series: string; sequence_number: number | null; reference: string;
    } | undefined;
    if (!invoice) throw new Error('Factura nu există sau nu are identitate de emitent.');
    const expected = `STERGE ${invoice.reference}`.toLocaleUpperCase('ro-RO');
    const confirmation = requireText(confirmationInput, 'Confirmarea ștergerii', 150).toLocaleUpperCase('ro-RO');
    if (confirmation !== expected) throw new Error(`Pentru confirmare scrie exact: STERGE ${invoice.reference}`);

    const payments = Number((connection.prepare('SELECT COUNT(*) AS value FROM payments WHERE invoice_id = ?').get(invoiceId) as { value: number }).value);
    const creditNotes = Number((connection.prepare(`
      SELECT COUNT(*) AS value FROM credit_note_invoice_links link
      JOIN credit_notes cn ON cn.id = link.credit_note_id
      WHERE link.invoice_id = ?
    `).get(invoiceId) as { value: number }).value);
    const creditApplications = Number((connection.prepare('SELECT COUNT(*) AS value FROM invoice_credit_applications WHERE invoice_id = ?').get(invoiceId) as { value: number }).value);
    const replacements = Number((connection.prepare('SELECT COUNT(*) AS value FROM invoice_replacements WHERE cancelled_invoice_id = ? OR replacement_invoice_id = ?').get(invoiceId, invoiceId) as { value: number }).value);
    if (payments || creditNotes || creditApplications || replacements || Number(invoice.paid_amount) > EPSILON) {
      throw new Error('Factura are plăți, Credit Notes, credit aplicat sau legături de reemitere. Pentru ștergerea întregului scenariu de test restaurează copia de siguranță inițială.');
    }

    const laterIdentity = invoice.sequence_number === null ? true : Boolean(connection.prepare(`
      SELECT 1 FROM invoice_identities
      WHERE issuer_id = ? AND series = ? AND sequence_number > ? LIMIT 1
    `).get(invoice.issuer_id, invoice.series, invoice.sequence_number));
    const issuer = connection.prepare('SELECT next_invoice_number FROM billing_issuers WHERE id = ?').get(invoice.issuer_id) as { next_invoice_number: number } | undefined;
    const canRewind = invoice.sequence_number !== null && !laterIdentity && issuer?.next_invoice_number === invoice.sequence_number + 1;

    connection.prepare('UPDATE billing_audit_events SET invoice_id = NULL WHERE invoice_id = ?').run(invoiceId);
    connection.prepare('DELETE FROM invoice_import_batches WHERE invoice_id = ?').run(invoiceId);
    connection.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
    connection.prepare('DELETE FROM invoice_identities WHERE invoice_id = ?').run(invoiceId);
    if (connection.prepare('DELETE FROM invoices WHERE id = ?').run(invoiceId).changes !== 1) throw new Error('Factura de test nu a putut fi ștearsă.');
    if (canRewind) {
      connection.prepare('UPDATE billing_issuers SET next_invoice_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND next_invoice_number = ?')
        .run(invoice.sequence_number, invoice.issuer_id, issuer!.next_invoice_number);
    }
    connection.prepare("INSERT INTO billing_audit_events (event_type, issuer_id, company_id, details) VALUES ('test_invoice_deleted', ?, ?, ?)")
      .run(invoice.issuer_id, invoice.company_id, JSON.stringify({ reference: invoice.reference, testMode: true, counterRewound: canRewind, pdfPath: invoice.pdf_path }));
    return { reference: invoice.reference, counterRewound: canRewind, pdfPath: invoice.pdf_path };
  })();
}

export function updatePaymentTransaction(connection: SqliteDatabase, input: UpdatePaymentInput) {
  const paymentId = requirePositiveInteger(input.id, 'Încasarea');
  const amount = requireMoneyPositive(input.amount, 'Suma încasată');
  const method = requireText(input.method, 'Metoda de plată', 20);
  if (method !== 'cash' && method !== 'transfer') throw new Error('Metoda de plată trebuie să fie cash sau transfer bancar.');
  const bankName = method === 'transfer' ? requireText(input.bankName, 'Banca', 100) : null;
  if (bankName && bankName !== 'Barclays' && bankName !== 'Virgin') throw new Error('Banca trebuie să fie Barclays sau Virgin.');
  const reason = requireText(input.reason, 'Motivul modificării', 500);

  return connection.transaction(() => {
    const payment = connection.prepare(`
      SELECT id, company_id, invoice_id, issuer_id, amount, method, bank_name
      FROM payments WHERE id = ?
    `).get(paymentId) as {
      id: number; company_id: number | null; invoice_id: number | null; issuer_id: number | null;
      amount: number; method: string; bank_name: string | null;
    } | undefined;
    if (!payment || !payment.company_id || !payment.issuer_id) throw new Error('Încasarea nu există sau nu are companie și emitent asociate.');

    if (payment.invoice_id) {
      const hasCreditNote = connection.prepare(`
        SELECT 1 FROM credit_note_invoice_links link JOIN credit_notes cn ON cn.id = link.credit_note_id
        WHERE link.invoice_id = ? AND cn.status = 'issued' LIMIT 1
      `).get(payment.invoice_id);
      const hasAppliedCredit = connection.prepare('SELECT 1 FROM invoice_credit_applications WHERE invoice_id = ? AND reversed_at IS NULL LIMIT 1').get(payment.invoice_id);
      if (hasCreditNote || hasAppliedCredit) throw new Error('Încasarea unei facturi cu Credit Note sau credit aplicat nu poate fi modificată direct.');
      const otherPayments = Number((connection.prepare('SELECT COALESCE(SUM(amount), 0) AS value FROM payments WHERE invoice_id = ? AND id != ?').get(payment.invoice_id, paymentId) as { value: number }).value);
      const financials = getInvoiceFinancials(connection, payment.invoice_id);
      if (otherPayments + amount > financials.netAmount + EPSILON) throw new Error('Suma totală încasată nu poate depăși valoarea netă a facturii.');
      connection.prepare('UPDATE payments SET amount = ?, method = ?, bank_name = ? WHERE id = ?').run(amount, method, bankName, paymentId);
      connection.prepare('UPDATE invoices SET paid_amount = ? WHERE id = ?').run(otherPayments + amount, payment.invoice_id);
      syncInvoiceFinancialStatus(connection, payment.invoice_id);
    } else {
      const entry = connection.prepare(`
        SELECT id, original_amount, available_amount, status FROM company_credit_entries
        WHERE source_type = 'payment_overpayment' AND source_id = ?
      `).get(paymentId) as { id: number; original_amount: number; available_amount: number; status: string } | undefined;
      if (!entry || entry.status !== 'active') throw new Error('Creditul asociat acestei încasări nu poate fi recalculat în siguranță.');
      const consumed = Math.max(0, Number(entry.original_amount) - Number(entry.available_amount));
      if (amount < consumed - EPSILON) throw new Error(`Suma nu poate fi mai mică de £${consumed.toFixed(2)}, deoarece această parte a creditului a fost deja folosită.`);
      connection.prepare('UPDATE payments SET amount = ?, method = ?, bank_name = ? WHERE id = ?').run(amount, method, bankName, paymentId);
      connection.prepare('UPDATE company_credit_entries SET original_amount = ?, available_amount = ? WHERE id = ?')
        .run(amount, Math.max(0, amount - consumed), entry.id);
      syncCompanyCreditBalance(connection, payment.company_id, payment.issuer_id);
    }

    connection.prepare(`INSERT INTO billing_audit_events (event_type, issuer_id, company_id, invoice_id, details) VALUES ('payment_updated', ?, ?, ?, ?)`)
      .run(payment.issuer_id, payment.company_id, payment.invoice_id, JSON.stringify({
        paymentId,
        reason,
        before: { amount: payment.amount, method: payment.method, bankName: payment.bank_name },
        after: { amount, method, bankName },
      }));
    return { id: paymentId, amount, method, bankName };
  })();
}

export function reissueCancelledWeeklyInvoiceTransaction(connection: SqliteDatabase, invoiceIdInput: number, invoiceDateInput: string) {
  ensureInvoiceProductColumns(connection);
  const cancelledInvoiceId = requirePositiveInteger(invoiceIdInput, 'Factura anulată');
  const invoiceDate = requireIsoDate(invoiceDateInput, 'Data facturii');
  return connection.transaction(() => {
    const original = connection.prepare(`
      SELECT i.*, s.company_id, c.issuer_id
      FROM invoices i JOIN stores s ON s.id = i.store_id JOIN companies c ON c.id = s.company_id
      WHERE i.id = ?
    `).get(cancelledInvoiceId) as { id: number; store_id: number; total_amount: number; status: string; company_id: number; issuer_id: number | null } | undefined;
    if (!original || original.status !== 'cancelled') throw new Error('Poate fi reemisă numai o factură anulată.');
    if (connection.prepare('SELECT 1 FROM invoice_replacements WHERE cancelled_invoice_id = ?').get(cancelledInvoiceId)) {
      throw new Error('Factura anulată are deja o factură înlocuitoare.');
    }
    if (!connection.prepare('SELECT 1 FROM invoice_import_batches WHERE invoice_id = ?').get(cancelledInvoiceId)) {
      throw new Error('Reemiterea automată este disponibilă numai pentru facturile săptămânale VR Baker.');
    }
    if (!original.issuer_id) throw new Error('Compania nu are un emitent atribuit.');
    const issuer = connection.prepare('SELECT * FROM billing_issuers WHERE id = ?').get(original.issuer_id) as BillingIssuerRow | undefined;
    if (!issuer || !isIssuerReady(issuer)) throw new Error('Emitentul curent al companiei nu este configurat complet.');
    const sequence = issuer.next_invoice_number;
    if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error('Contorul emitentului nu este valid.');
    const reference = `${issuer.invoice_series}-${sequence}`;
    const invoice = connection.prepare(`
      INSERT INTO invoices (store_id, invoice_number, invoice_date, total_amount, paid_amount, status, notes)
      VALUES (?, ?, ?, ?, 0, 'unpaid', ?)
    `).run(original.store_id, reference, invoiceDate, original.total_amount, `Înlocuiește factura anulată #${cancelledInvoiceId}`);
    const replacementInvoiceId = Number(invoice.lastInsertRowid);
    const snapshot = issuerSnapshot(issuer);
    connection.prepare(`
      INSERT INTO invoice_identities (invoice_id, issuer_id, series, sequence_number, reference, issuer_snapshot_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(replacementInvoiceId, issuer.id, issuer.invoice_series, sequence, reference, JSON.stringify(snapshot));
    connection.prepare(`
      INSERT INTO invoice_items (invoice_id, product_name, product_name_ro, variant_label, unit, quantity, unit_price, total_price, external_product_id, finished_product_id)
      SELECT ?, product_name, product_name_ro, variant_label, unit, quantity, unit_price, total_price, external_product_id, finished_product_id
      FROM invoice_items WHERE invoice_id = ? ORDER BY id
    `).run(replacementInvoiceId, cancelledInvoiceId);
    connection.prepare('INSERT INTO invoice_replacements (cancelled_invoice_id, replacement_invoice_id) VALUES (?, ?)').run(cancelledInvoiceId, replacementInvoiceId);
    if (connection.prepare('UPDATE billing_issuers SET next_invoice_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND next_invoice_number = ?').run(sequence + 1, issuer.id, sequence).changes !== 1) {
      throw new Error('Contorul emitentului a fost modificat concurent.');
    }
    connection.prepare(`INSERT INTO billing_audit_events (event_type, issuer_id, company_id, invoice_id, details) VALUES ('invoice_reissued', ?, ?, ?, ?)`)
      .run(issuer.id, original.company_id, replacementInvoiceId, JSON.stringify({ cancelledInvoiceId }));
    return { invoiceId: replacementInvoiceId, invoiceNumber: reference, invoiceDate, issuerId: issuer.id, issuerSettings: snapshot };
  })();
}
