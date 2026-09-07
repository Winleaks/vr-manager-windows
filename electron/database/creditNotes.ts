import type Database from 'better-sqlite3';
import {
  optionalText,
  requireFinitePositive,
  requireIsoDate,
  requireMoneyPositive,
  requirePositiveInteger,
  requireText,
} from './businessValidation.ts';
import { isIssuerReady, issuerSnapshot, type BillingIssuerRow } from './billingIssuers.ts';

type SqliteDatabase = Database.Database;

const EPSILON = 0.005;

export interface CreateCreditNoteInput {
  issueDate: string;
  reason: string;
  backdateReason?: string;
  items: Array<{
    invoiceItemId: number;
    quantity: number;
    unitAmount: number;
    returnToStock?: boolean;
  }>;
}

export interface ApplyCompanyCreditInput {
  companyId: number;
  issuerId: number;
  invoiceId: number;
  amount: number;
  reason: string;
}

function columnExists(connection: SqliteDatabase, table: string, column: string) {
  return (connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function localIsoDate(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function customerSnapshot(row: {
  company_id: number;
  company_name: string;
  company_address: string | null;
  company_cui: string | null;
  company_reg_com: string | null;
  client_name: string;
}) {
  return {
    companyId: row.company_id,
    companyName: row.company_name,
    companyAddress: row.company_address || '',
    companyVatNumber: row.company_cui || '',
    companyRegistrationNumber: row.company_reg_com || '',
    clientName: row.client_name,
  };
}

export function ensureCreditNoteSchema(connection: SqliteDatabase) {
  if (!columnExists(connection, 'billing_issuers', 'credit_note_series')) {
    connection.exec('ALTER TABLE billing_issuers ADD COLUMN credit_note_series TEXT COLLATE NOCASE;');
  }
  if (!columnExists(connection, 'billing_issuers', 'next_credit_note_number')) {
    connection.exec('ALTER TABLE billing_issuers ADD COLUMN next_credit_note_number INTEGER NOT NULL DEFAULT 1;');
  }
  if (!columnExists(connection, 'billing_issuers', 'credit_note_sequence_confirmed')) {
    connection.exec('ALTER TABLE billing_issuers ADD COLUMN credit_note_sequence_confirmed INTEGER NOT NULL DEFAULT 0;');
  }
  if (!columnExists(connection, 'invoice_items', 'external_product_id')) {
    connection.exec('ALTER TABLE invoice_items ADD COLUMN external_product_id TEXT;');
  }
  if (!columnExists(connection, 'invoice_items', 'finished_product_id')) {
    connection.exec('ALTER TABLE invoice_items ADD COLUMN finished_product_id INTEGER;');
  }

  connection.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_issuer_credit_note_series
      ON billing_issuers(credit_note_series COLLATE NOCASE)
      WHERE credit_note_series IS NOT NULL AND credit_note_series != '';

    CREATE TABLE IF NOT EXISTS credit_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      issuer_id INTEGER NOT NULL,
      reference TEXT NOT NULL UNIQUE COLLATE NOCASE,
      series TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      issue_date DATE NOT NULL,
      reason TEXT NOT NULL,
      backdate_reason TEXT,
      issuer_snapshot_json TEXT NOT NULL,
      customer_snapshot_json TEXT NOT NULL,
      net_amount REAL NOT NULL CHECK(net_amount > 0),
      vat_amount REAL NOT NULL DEFAULT 0 CHECK(vat_amount >= 0),
      total_amount REAL NOT NULL CHECK(total_amount > 0),
      status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued', 'cancelled')),
      pdf_path TEXT,
      pdf_status TEXT NOT NULL DEFAULT 'pending' CHECK(pdf_status IN ('pending', 'ready', 'error')),
      cloud_status TEXT NOT NULL DEFAULT 'pending' CHECK(cloud_status IN ('pending', 'ready', 'error')),
      sent_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      cancelled_at DATETIME,
      cancellation_reason TEXT,
      FOREIGN KEY(company_id) REFERENCES companies(id),
      FOREIGN KEY(issuer_id) REFERENCES billing_issuers(id),
      UNIQUE(issuer_id, series, sequence_number)
    );

    CREATE TABLE IF NOT EXISTS credit_note_invoice_links (
      credit_note_id INTEGER NOT NULL,
      invoice_id INTEGER NOT NULL,
      credited_net REAL NOT NULL CHECK(credited_net > 0),
      credited_vat REAL NOT NULL DEFAULT 0 CHECK(credited_vat >= 0),
      credited_total REAL NOT NULL CHECK(credited_total > 0),
      PRIMARY KEY(credit_note_id, invoice_id),
      FOREIGN KEY(credit_note_id) REFERENCES credit_notes(id),
      FOREIGN KEY(invoice_id) REFERENCES invoices(id)
    );

    CREATE TABLE IF NOT EXISTS credit_note_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credit_note_id INTEGER NOT NULL,
      source_invoice_id INTEGER NOT NULL,
      source_invoice_item_id INTEGER NOT NULL,
      store_name TEXT NOT NULL,
      product_name TEXT NOT NULL,
      product_name_ro TEXT,
      variant_label TEXT,
      unit TEXT,
      quantity REAL NOT NULL CHECK(quantity > 0),
      unit_amount REAL NOT NULL CHECK(unit_amount > 0),
      net_amount REAL NOT NULL CHECK(net_amount > 0),
      vat_rate REAL NOT NULL DEFAULT 0,
      vat_amount REAL NOT NULL DEFAULT 0 CHECK(vat_amount >= 0),
      total_amount REAL NOT NULL CHECK(total_amount > 0),
      product_order INTEGER,
      external_product_id TEXT,
      finished_product_id INTEGER,
      return_to_stock INTEGER NOT NULL DEFAULT 0 CHECK(return_to_stock IN (0, 1)),
      FOREIGN KEY(credit_note_id) REFERENCES credit_notes(id),
      FOREIGN KEY(source_invoice_id) REFERENCES invoices(id),
      FOREIGN KEY(source_invoice_item_id) REFERENCES invoice_items(id),
      FOREIGN KEY(finished_product_id) REFERENCES finished_products(id)
    );

    CREATE TABLE IF NOT EXISTS company_credit_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      issuer_id INTEGER NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('legacy', 'payment_overpayment', 'credit_note')),
      source_id INTEGER,
      original_amount REAL NOT NULL CHECK(original_amount >= 0),
      available_amount REAL NOT NULL CHECK(available_amount >= 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'reversed')),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reversed_at DATETIME,
      reversal_reason TEXT,
      FOREIGN KEY(company_id) REFERENCES companies(id),
      FOREIGN KEY(issuer_id) REFERENCES billing_issuers(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_entry_source
      ON company_credit_entries(source_type, source_id)
      WHERE source_id IS NOT NULL AND source_type IN ('payment_overpayment', 'credit_note');

    CREATE TABLE IF NOT EXISTS invoice_credit_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credit_entry_id INTEGER NOT NULL,
      invoice_id INTEGER NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      reason TEXT NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reversed_at DATETIME,
      reversal_reason TEXT,
      FOREIGN KEY(credit_entry_id) REFERENCES company_credit_entries(id),
      FOREIGN KEY(invoice_id) REFERENCES invoices(id)
    );

    CREATE INDEX IF NOT EXISTS idx_credit_notes_company_issuer ON credit_notes(company_id, issuer_id, issue_date);
    CREATE INDEX IF NOT EXISTS idx_credit_note_items_source ON credit_note_items(source_invoice_item_id);
    CREATE INDEX IF NOT EXISTS idx_credit_links_invoice ON credit_note_invoice_links(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_credit_entries_scope ON company_credit_entries(company_id, issuer_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_credit_applications_invoice ON invoice_credit_applications(invoice_id, reversed_at);
  `);

  if (!columnExists(connection, 'credit_note_items', 'product_order')) {
    connection.exec('ALTER TABLE credit_note_items ADD COLUMN product_order INTEGER;');
  }

  connection.prepare(`UPDATE billing_issuers SET credit_note_series = CASE code WHEN 'goodness' THEN 'CN-TGB' WHEN 'vatra' THEN 'CN-VATRA' ELSE 'CN-' || UPPER(code) END WHERE credit_note_series IS NULL OR credit_note_series = ''`).run();

  const defaultIssuer = connection.prepare('SELECT id FROM billing_issuers WHERE is_default = 1').get() as { id: number } | undefined;
  if (defaultIssuer) {
    const migrated = connection.prepare("SELECT value FROM app_settings WHERE key = 'credit_ledger_migrated_v13'").get();
    if (!migrated) {
      const balances = connection.prepare('SELECT company_id, issuer_id, balance FROM company_issuer_credits WHERE balance > 0.005').all() as Array<{ company_id: number; issuer_id: number; balance: number }>;
      const insert = connection.prepare("INSERT INTO company_credit_entries (company_id, issuer_id, source_type, original_amount, available_amount) VALUES (?, ?, 'legacy', ?, ?)");
      for (const row of balances) insert.run(row.company_id, row.issuer_id || defaultIssuer.id, row.balance, row.balance);
      connection.prepare("INSERT INTO app_settings (key, value) VALUES ('credit_ledger_migrated_v13', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
    }
  }
}

function creditApplied(connection: SqliteDatabase, invoiceId: number) {
  return Number((connection.prepare('SELECT COALESCE(SUM(amount), 0) AS value FROM invoice_credit_applications WHERE invoice_id = ? AND reversed_at IS NULL').get(invoiceId) as { value: number }).value || 0);
}

function creditedTotal(connection: SqliteDatabase, invoiceId: number) {
  return Number((connection.prepare(`
    SELECT COALESCE(SUM(link.credited_total), 0) AS value
    FROM credit_note_invoice_links link JOIN credit_notes cn ON cn.id = link.credit_note_id
    WHERE link.invoice_id = ? AND cn.status = 'issued'
  `).get(invoiceId) as { value: number }).value || 0);
}

export function getInvoiceFinancials(connection: SqliteDatabase, invoiceIdInput: number) {
  const invoiceId = requirePositiveInteger(invoiceIdInput, 'Factura');
  const row = connection.prepare('SELECT total_amount, paid_amount, status FROM invoices WHERE id = ?').get(invoiceId) as { total_amount: number; paid_amount: number; status: string } | undefined;
  if (!row) throw new Error('Factura nu există.');
  const grossAmount = roundMoney(row.total_amount);
  const creditedAmount = roundMoney(creditedTotal(connection, invoiceId));
  const netAmount = roundMoney(Math.max(0, grossAmount - creditedAmount));
  const cashPaid = roundMoney(row.paid_amount);
  const appliedCredit = roundMoney(creditApplied(connection, invoiceId));
  const outstanding = roundMoney(Math.max(0, netAmount - cashPaid - appliedCredit));
  return { grossAmount, creditedAmount, netAmount, cashPaid, appliedCredit, outstanding, isCancelled: row.status === 'cancelled' };
}

export function syncInvoiceFinancialStatus(connection: SqliteDatabase, invoiceId: number) {
  const financials = getInvoiceFinancials(connection, invoiceId);
  if (financials.isCancelled) return financials;
  const status = financials.netAmount <= EPSILON && financials.creditedAmount > EPSILON
    ? 'credited'
    : financials.outstanding <= EPSILON
      ? 'paid'
      : financials.cashPaid + financials.appliedCredit > EPSILON || financials.creditedAmount > EPSILON
        ? 'partial'
        : 'unpaid';
  connection.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, invoiceId);
  return { ...financials, status };
}

export function syncCompanyCreditBalance(connection: SqliteDatabase, companyIdInput: number, issuerIdInput: number) {
  const companyId = requirePositiveInteger(companyIdInput, 'Compania');
  const issuerId = requirePositiveInteger(issuerIdInput, 'Emitentul');
  const balance = roundMoney(Number((connection.prepare(`
    SELECT COALESCE(SUM(available_amount), 0) AS value FROM company_credit_entries
    WHERE company_id = ? AND issuer_id = ? AND status = 'active'
  `).get(companyId, issuerId) as { value: number }).value || 0));
  connection.prepare(`
    INSERT INTO company_issuer_credits (company_id, issuer_id, balance, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(company_id, issuer_id) DO UPDATE SET balance = excluded.balance, updated_at = CURRENT_TIMESTAMP
  `).run(companyId, issuerId, balance);
  const aggregate = roundMoney(Number((connection.prepare('SELECT COALESCE(SUM(balance), 0) AS value FROM company_issuer_credits WHERE company_id = ?').get(companyId) as { value: number }).value || 0));
  connection.prepare('UPDATE companies SET credit_balance = ? WHERE id = ?').run(aggregate, companyId);
  return balance;
}

export function addPaymentCreditEntry(connection: SqliteDatabase, companyId: number, issuerId: number, paymentId: number, amount: number) {
  const rounded = roundMoney(amount);
  if (rounded <= EPSILON) return null;
  const result = connection.prepare(`
    INSERT INTO company_credit_entries (company_id, issuer_id, source_type, source_id, original_amount, available_amount)
    VALUES (?, ?, 'payment_overpayment', ?, ?, ?)
  `).run(companyId, issuerId, paymentId, rounded, rounded);
  syncCompanyCreditBalance(connection, companyId, issuerId);
  return Number(result.lastInsertRowid);
}

function resolveFinishedProduct(connection: SqliteDatabase, row: { finished_product_id: number | null; external_product_id: string | null; product_name: string; product_name_ro: string | null }) {
  if (row.finished_product_id) {
    const exact = connection.prepare('SELECT id FROM finished_products WHERE id = ?').get(row.finished_product_id) as { id: number } | undefined;
    if (exact) return exact.id;
  }
  if (row.external_product_id) {
    const matches = connection.prepare('SELECT id FROM finished_products WHERE external_product_id = ?').all(row.external_product_id) as Array<{ id: number }>;
    if (matches.length === 1) return matches[0].id;
  }
  const matches = connection.prepare(`
    SELECT id FROM finished_products
    WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) OR (? IS NOT NULL AND LOWER(TRIM(name_ro)) = LOWER(TRIM(?)))
  `).all(row.product_name, row.product_name_ro, row.product_name_ro) as Array<{ id: number }>;
  return matches.length === 1 ? matches[0].id : null;
}

export function getCreditNoteDraft(connection: SqliteDatabase, invoiceIdsInput?: unknown) {
  let invoiceIds: number[] = [];
  if (invoiceIdsInput !== undefined) {
    if (!Array.isArray(invoiceIdsInput) || invoiceIdsInput.length > 100) throw new Error('Selecția facturilor este invalidă.');
    invoiceIds = [...new Set(invoiceIdsInput.map((id) => requirePositiveInteger(id, 'Factura')))];
  }
  const conditions = ["i.status != 'cancelled'"];
  const params: number[] = [];
  if (invoiceIds.length) {
    conditions.push(`i.id IN (${invoiceIds.map(() => '?').join(',')})`);
    params.push(...invoiceIds);
  }
  const invoices = connection.prepare(`
    SELECT i.id, i.invoice_number, i.invoice_date, i.total_amount, i.paid_amount, i.status,
           s.name AS store_name, s.company_id, c.name AS company_name,
           ii.issuer_id, bi.legal_name AS issuer_name, bi.code AS issuer_code
    FROM invoices i JOIN stores s ON s.id = i.store_id JOIN companies c ON c.id = s.company_id
    JOIN invoice_identities ii ON ii.invoice_id = i.id JOIN billing_issuers bi ON bi.id = ii.issuer_id
    WHERE ${conditions.join(' AND ')} ORDER BY i.invoice_date, i.id
  `).all(...params) as any[];
  return invoices.map((invoice) => {
    const financials = getInvoiceFinancials(connection, invoice.id);
    const items = (connection.prepare(`
      SELECT item.*,
        COALESCE((SELECT SUM(cni.quantity) FROM credit_note_items cni JOIN credit_notes cn ON cn.id = cni.credit_note_id WHERE cni.source_invoice_item_id = item.id AND cn.status = 'issued'), 0) AS credited_quantity,
        COALESCE((SELECT SUM(cni.total_amount) FROM credit_note_items cni JOIN credit_notes cn ON cn.id = cni.credit_note_id WHERE cni.source_invoice_item_id = item.id AND cn.status = 'issued'), 0) AS credited_value
      FROM invoice_items item WHERE item.invoice_id = ?
      ORDER BY CASE WHEN item.product_order IS NULL THEN 1 ELSE 0 END, item.product_order, item.id
    `).all(invoice.id) as any[]).map((item) => {
      const finishedProductId = resolveFinishedProduct(connection, item);
      return {
        id: item.id,
        productName: item.product_name,
        nameRo: item.product_name_ro,
        variantLabel: item.variant_label,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        totalPrice: item.total_price,
        remainingQuantity: Math.max(0, item.quantity - item.credited_quantity),
        remainingValue: roundMoney(Math.max(0, item.total_price - item.credited_value)),
        canReturnToStock: Boolean(finishedProductId),
        finishedProductId,
      };
    });
    return { ...invoice, ...financials, items };
  }).filter((invoice) => invoice.creditedAmount < invoice.grossAmount - EPSILON);
}

function releaseAppliedCredit(connection: SqliteDatabase, invoiceId: number, amount: number, reason: string) {
  let remaining = roundMoney(amount);
  const rows = connection.prepare(`
    SELECT app.id, app.credit_entry_id, app.amount, entry.company_id, entry.issuer_id
    FROM invoice_credit_applications app JOIN company_credit_entries entry ON entry.id = app.credit_entry_id
    WHERE app.invoice_id = ? AND app.reversed_at IS NULL ORDER BY app.applied_at DESC, app.id DESC
  `).all(invoiceId) as Array<{ id: number; credit_entry_id: number; amount: number; company_id: number; issuer_id: number }>;
  for (const row of rows) {
    if (remaining <= EPSILON) break;
    const released = Math.min(remaining, row.amount);
    if (released < row.amount - EPSILON) {
      connection.prepare('UPDATE invoice_credit_applications SET amount = ? WHERE id = ?').run(roundMoney(row.amount - released), row.id);
    } else {
      connection.prepare('UPDATE invoice_credit_applications SET reversed_at = CURRENT_TIMESTAMP, reversal_reason = ? WHERE id = ?').run(reason, row.id);
    }
    connection.prepare('UPDATE company_credit_entries SET available_amount = available_amount + ? WHERE id = ? AND status = \'active\'').run(released, row.credit_entry_id);
    syncCompanyCreditBalance(connection, row.company_id, row.issuer_id);
    remaining = roundMoney(remaining - released);
  }
  return remaining;
}

export function createCreditNoteTransaction(connection: SqliteDatabase, input: CreateCreditNoteInput) {
  const issueDate = requireIsoDate(input.issueDate, 'Data Credit Note-ului');
  const reason = requireText(input.reason, 'Motivul Credit Note-ului', 1000);
  const today = localIsoDate();
  if (issueDate > today) throw new Error('Data Credit Note-ului nu poate fi în viitor.');
  const backdateReason = issueDate < today ? requireText(input.backdateReason, 'Motivul antedatării', 1000) : optionalText(input.backdateReason, 'Motivul antedatării', 1000);
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 500) throw new Error('Credit Note-ul trebuie să conțină între 1 și 500 de poziții.');
  const duplicateIds = new Set<number>();
  const selected = input.items.map((item) => {
    const invoiceItemId = requirePositiveInteger(item.invoiceItemId, 'Poziția facturii');
    if (duplicateIds.has(invoiceItemId)) throw new Error('Aceeași poziție de factură a fost selectată de două ori.');
    duplicateIds.add(invoiceItemId);
    return {
      invoiceItemId,
      quantity: requireFinitePositive(item.quantity, 'Cantitatea creditată'),
      unitAmount: requireMoneyPositive(item.unitAmount, 'Valoarea unitară creditată'),
      returnToStock: item.returnToStock === true,
    };
  });

  return connection.transaction(() => {
    const getSource = connection.prepare(`
      SELECT item.id AS source_item_id, item.invoice_id, item.product_name, item.product_name_ro,
             item.variant_label, item.unit, item.quantity, item.unit_price, item.total_price,
             item.external_product_id, item.finished_product_id, item.product_order,
             i.invoice_date, i.invoice_number, i.status AS invoice_status,
             s.name AS store_name, s.company_id, c.name AS company_name, c.address AS company_address,
             c.cui AS company_cui, c.reg_com AS company_reg_com, cl.name AS client_name,
             ii.issuer_id
      FROM invoice_items item JOIN invoices i ON i.id = item.invoice_id
      JOIN stores s ON s.id = i.store_id JOIN companies c ON c.id = s.company_id
      JOIN clients cl ON cl.id = c.client_id JOIN invoice_identities ii ON ii.invoice_id = i.id
      JOIN billing_issuers bi ON bi.id = ii.issuer_id WHERE item.id = ?
    `);
    const rows = selected.map((selection) => ({ selection, source: getSource.get(selection.invoiceItemId) as any }));
    if (rows.some((row) => !row.source)) throw new Error('Una dintre pozițiile facturilor nu mai există.');
    const first = rows[0].source;
    if (rows.some((row) => row.source.company_id !== first.company_id || row.source.issuer_id !== first.issuer_id)) {
      throw new Error('Credit Note-ul poate reuni numai facturi ale aceleiași companii și aceluiași emitent.');
    }
    if (rows.some((row) => row.source.invoice_status === 'cancelled')) throw new Error('Facturile anulate nu pot fi creditate.');
    const latestInvoiceDate = rows.reduce((latest, row) => row.source.invoice_date > latest ? row.source.invoice_date : latest, '');
    if (issueDate < latestInvoiceDate) throw new Error('Data Credit Note-ului nu poate fi înaintea celei mai recente facturi sursă.');
    const issuer = connection.prepare('SELECT * FROM billing_issuers WHERE id = ?').get(first.issuer_id) as BillingIssuerRow & { credit_note_series: string | null; next_credit_note_number: number; credit_note_sequence_confirmed: number };
    if (!issuer || !isIssuerReady(issuer)) throw new Error('Emitentul facturilor nu este activ și configurat complet.');
    if (!issuer?.credit_note_sequence_confirmed || !issuer.credit_note_series || !Number.isSafeInteger(issuer.next_credit_note_number) || issuer.next_credit_note_number <= 0) {
      throw new Error('Confirmă seria și următorul număr Credit Note în Setări Facturare.');
    }

    const prepared = rows.map(({ selection, source }) => {
      if (selection.quantity > source.quantity + EPSILON) throw new Error(`Cantitatea creditată pentru ${source.product_name} depășește cantitatea facturată.`);
      if (selection.unitAmount > source.unit_price + EPSILON) throw new Error(`Valoarea unitară creditată pentru ${source.product_name} depășește prețul facturat.`);
      const used = connection.prepare(`
        SELECT COALESCE(SUM(cni.quantity), 0) AS quantity, COALESCE(SUM(cni.total_amount), 0) AS value
        FROM credit_note_items cni JOIN credit_notes cn ON cn.id = cni.credit_note_id
        WHERE cni.source_invoice_item_id = ? AND cn.status = 'issued'
      `).get(source.source_item_id) as { quantity: number; value: number };
      if (used.quantity + selection.quantity > source.quantity + EPSILON) throw new Error(`Cantitatea rămasă pentru ${source.product_name} este insuficientă.`);
      const total = roundMoney(selection.quantity * selection.unitAmount);
      if (used.value + total > source.total_price + EPSILON) throw new Error(`Valoarea rămasă pentru ${source.product_name} este insuficientă.`);
      const finishedProductId = resolveFinishedProduct(connection, source);
      if (selection.returnToStock && !finishedProductId) throw new Error(`Produsul ${source.product_name} nu este mapat neechivoc în stoc; folosește o ajustare manuală.`);
      return { selection, source, total, finishedProductId };
    });
    const totalAmount = roundMoney(prepared.reduce((sum, row) => sum + row.total, 0));
    if (totalAmount <= EPSILON) throw new Error('Totalul Credit Note-ului trebuie să fie mai mare decât zero.');
    const sequence = issuer.next_credit_note_number;
    const reference = `${issuer.credit_note_series}-${sequence}`;
    const creditNote = connection.prepare(`
      INSERT INTO credit_notes (company_id, issuer_id, reference, series, sequence_number, issue_date, reason, backdate_reason, issuer_snapshot_json, customer_snapshot_json, net_amount, vat_amount, total_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(first.company_id, first.issuer_id, reference, issuer.credit_note_series, sequence, issueDate, reason, backdateReason, JSON.stringify(issuerSnapshot(issuer)), JSON.stringify(customerSnapshot(first)), totalAmount, totalAmount);
    const creditNoteId = Number(creditNote.lastInsertRowid);
    const insertItem = connection.prepare(`
      INSERT INTO credit_note_items (credit_note_id, source_invoice_id, source_invoice_item_id, store_name, product_name, product_name_ro, variant_label, unit, quantity, unit_amount, net_amount, vat_rate, vat_amount, total_amount, product_order, external_product_id, finished_product_id, return_to_stock)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
    `);
    const byInvoice = new Map<number, number>();
    for (const row of prepared) {
      insertItem.run(creditNoteId, row.source.invoice_id, row.source.source_item_id, row.source.store_name, row.source.product_name, row.source.product_name_ro, row.source.variant_label, row.source.unit, row.selection.quantity, row.selection.unitAmount, row.total, row.total, row.source.product_order, row.source.external_product_id, row.finishedProductId, row.selection.returnToStock ? 1 : 0);
      byInvoice.set(row.source.invoice_id, roundMoney((byInvoice.get(row.source.invoice_id) || 0) + row.total));
      if (row.selection.returnToStock) {
        const stock = connection.prepare('SELECT current_stock FROM finished_products WHERE id = ?').get(row.finishedProductId) as { current_stock: number };
        const before = Number(stock.current_stock);
        const after = before + row.selection.quantity;
        connection.prepare('UPDATE finished_products SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(after, row.finishedProductId);
        connection.prepare(`INSERT INTO finished_product_movements (finished_product_id, movement_type, quantity, stock_before, stock_after, reference_type, reference_id, notes, created_by) VALUES (?, 'credit_note_return', ?, ?, ?, 'credit_note', ?, ?, 'system')`)
          .run(row.finishedProductId, row.selection.quantity, before, after, creditNoteId, `Retur stoc ${reference}`);
      }
    }
    const insertLink = connection.prepare('INSERT INTO credit_note_invoice_links (credit_note_id, invoice_id, credited_net, credited_vat, credited_total) VALUES (?, ?, ?, 0, ?)');
    for (const [invoiceId, amount] of byInvoice) insertLink.run(creditNoteId, invoiceId, amount, amount);
    if (connection.prepare('UPDATE billing_issuers SET next_credit_note_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND next_credit_note_number = ?').run(sequence + 1, issuer.id, sequence).changes !== 1) {
      throw new Error('Contorul Credit Note a fost modificat concurent. Reîncearcă emiterea.');
    }

    let generatedCredit = 0;
    for (const invoiceId of byInvoice.keys()) {
      const beforeApplied = creditApplied(connection, invoiceId);
      const beforeCashExcess = Math.max(0, Number((connection.prepare('SELECT paid_amount FROM invoices WHERE id = ?').get(invoiceId) as { paid_amount: number }).paid_amount) - (getInvoiceFinancials(connection, invoiceId).netAmount + (byInvoice.get(invoiceId) || 0)));
      const financials = getInvoiceFinancials(connection, invoiceId);
      const overSettled = Math.max(0, financials.cashPaid + beforeApplied - financials.netAmount);
      if (overSettled > EPSILON && beforeApplied > EPSILON) releaseAppliedCredit(connection, invoiceId, Math.min(overSettled, beforeApplied), `Eliberare automată la emiterea ${reference}`);
      const after = getInvoiceFinancials(connection, invoiceId);
      const cashExcess = Math.max(0, after.cashPaid - after.netAmount);
      generatedCredit = roundMoney(generatedCredit + Math.max(0, cashExcess - beforeCashExcess));
      syncInvoiceFinancialStatus(connection, invoiceId);
    }
    if (generatedCredit > EPSILON) {
      connection.prepare(`INSERT INTO company_credit_entries (company_id, issuer_id, source_type, source_id, original_amount, available_amount) VALUES (?, ?, 'credit_note', ?, ?, ?)`)
        .run(first.company_id, first.issuer_id, creditNoteId, generatedCredit, generatedCredit);
    }
    syncCompanyCreditBalance(connection, first.company_id, first.issuer_id);
    connection.prepare(`INSERT INTO billing_audit_events (event_type, issuer_id, company_id, details) VALUES ('credit_note_issued', ?, ?, ?)`)
      .run(first.issuer_id, first.company_id, JSON.stringify({ creditNoteId, reference, invoiceIds: [...byInvoice.keys()], totalAmount, issueDate, backdateReason }));
    return { creditNoteId, reference, totalAmount, companyId: first.company_id, issuerId: first.issuer_id };
  })();
}

export function getCreditNotes(connection: SqliteDatabase, filters: any = {}) {
  const conditions: string[] = [];
  const params: any[] = [];
  if (filters.issuerId !== undefined) { conditions.push('cn.issuer_id = ?'); params.push(requirePositiveInteger(filters.issuerId, 'Emitentul')); }
  if (filters.companyId !== undefined) { conditions.push('cn.company_id = ?'); params.push(requirePositiveInteger(filters.companyId, 'Compania')); }
  if (filters.status) {
    const status = requireText(filters.status, 'Statusul', 20);
    if (status !== 'issued' && status !== 'cancelled') throw new Error('Statusul Credit Note nu este valid.');
    conditions.push('cn.status = ?'); params.push(status);
  }
  if (filters.startDate) { conditions.push('cn.issue_date >= ?'); params.push(requireIsoDate(filters.startDate, 'Data de început')); }
  if (filters.endDate) { conditions.push('cn.issue_date <= ?'); params.push(requireIsoDate(filters.endDate, 'Data de sfârșit')); }
  const rows = connection.prepare(`
    SELECT cn.*, c.name AS company_name, bi.legal_name AS issuer_name, bi.code AS issuer_code, bi.color AS issuer_color,
      (SELECT GROUP_CONCAT(i.invoice_number, ', ') FROM credit_note_invoice_links link JOIN invoices i ON i.id = link.invoice_id WHERE link.credit_note_id = cn.id) AS invoice_references
    FROM credit_notes cn JOIN companies c ON c.id = cn.company_id JOIN billing_issuers bi ON bi.id = cn.issuer_id
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY cn.issue_date DESC, cn.sequence_number DESC, cn.id DESC
  `).all(...params) as any[];
  return rows;
}

export function getCreditNote(connection: SqliteDatabase, creditNoteIdInput: number) {
  const creditNoteId = requirePositiveInteger(creditNoteIdInput, 'Credit Note-ul');
  const note = connection.prepare(`SELECT cn.*, c.name AS company_name, bi.legal_name AS issuer_name, bi.code AS issuer_code, bi.color AS issuer_color FROM credit_notes cn JOIN companies c ON c.id = cn.company_id JOIN billing_issuers bi ON bi.id = cn.issuer_id WHERE cn.id = ?`).get(creditNoteId) as any;
  if (!note) throw new Error('Credit Note-ul nu există.');
  const invoices = connection.prepare(`SELECT i.id, i.invoice_number, i.invoice_date, link.credited_total FROM credit_note_invoice_links link JOIN invoices i ON i.id = link.invoice_id WHERE link.credit_note_id = ? ORDER BY i.invoice_date, i.id`).all(creditNoteId);
  const items = connection.prepare(`
    SELECT * FROM credit_note_items WHERE credit_note_id = ?
    ORDER BY source_invoice_id, CASE WHEN product_order IS NULL THEN 1 ELSE 0 END, product_order, id
  `).all(creditNoteId);
  return { ...note, issuerSnapshot: JSON.parse(note.issuer_snapshot_json), customerSnapshot: JSON.parse(note.customer_snapshot_json), invoices, items };
}

export function applyCompanyCreditTransaction(connection: SqliteDatabase, input: ApplyCompanyCreditInput) {
  const companyId = requirePositiveInteger(input.companyId, 'Compania');
  const issuerId = requirePositiveInteger(input.issuerId, 'Emitentul');
  const invoiceId = requirePositiveInteger(input.invoiceId, 'Factura');
  const requested = requireMoneyPositive(input.amount, 'Creditul aplicat');
  const reason = requireText(input.reason, 'Motivul aplicării', 500);
  return connection.transaction(() => {
    const scope = connection.prepare(`SELECT s.company_id, ii.issuer_id, i.status FROM invoices i JOIN stores s ON s.id = i.store_id JOIN invoice_identities ii ON ii.invoice_id = i.id WHERE i.id = ?`).get(invoiceId) as { company_id: number; issuer_id: number; status: string } | undefined;
    if (!scope || scope.status === 'cancelled') throw new Error('Factura nu există sau este anulată.');
    if (scope.company_id !== companyId || scope.issuer_id !== issuerId) throw new Error('Creditul poate fi aplicat numai aceleiași companii și aceluiași emitent.');
    const financials = getInvoiceFinancials(connection, invoiceId);
    if (requested > financials.outstanding + EPSILON) throw new Error('Creditul depășește restul de plată al facturii.');
    const entries = connection.prepare(`SELECT id, available_amount FROM company_credit_entries WHERE company_id = ? AND issuer_id = ? AND status = 'active' AND available_amount > 0.005 ORDER BY created_at, id`).all(companyId, issuerId) as Array<{ id: number; available_amount: number }>;
    const available = roundMoney(entries.reduce((sum, row) => sum + row.available_amount, 0));
    if (requested > available + EPSILON) throw new Error('Creditul disponibil este insuficient.');
    let remaining = requested;
    const applications: number[] = [];
    for (const entry of entries) {
      if (remaining <= EPSILON) break;
      const amount = roundMoney(Math.min(remaining, entry.available_amount));
      const result = connection.prepare('INSERT INTO invoice_credit_applications (credit_entry_id, invoice_id, amount, reason) VALUES (?, ?, ?, ?)').run(entry.id, invoiceId, amount, reason);
      connection.prepare('UPDATE company_credit_entries SET available_amount = available_amount - ? WHERE id = ?').run(amount, entry.id);
      applications.push(Number(result.lastInsertRowid));
      remaining = roundMoney(remaining - amount);
    }
    syncCompanyCreditBalance(connection, companyId, issuerId);
    syncInvoiceFinancialStatus(connection, invoiceId);
    connection.prepare(`INSERT INTO billing_audit_events (event_type, issuer_id, company_id, invoice_id, details) VALUES ('company_credit_applied', ?, ?, ?, ?)`).run(issuerId, companyId, invoiceId, JSON.stringify({ amount: requested, reason, applications }));
    return { applications, amount: requested };
  })();
}

export function reverseCreditApplicationTransaction(connection: SqliteDatabase, applicationIdInput: number, reasonInput: string) {
  const applicationId = requirePositiveInteger(applicationIdInput, 'Aplicarea creditului');
  const reason = requireText(reasonInput, 'Motivul reversării', 500);
  return connection.transaction(() => {
    const row = connection.prepare(`SELECT app.*, entry.company_id, entry.issuer_id, entry.status AS entry_status FROM invoice_credit_applications app JOIN company_credit_entries entry ON entry.id = app.credit_entry_id WHERE app.id = ?`).get(applicationId) as any;
    if (!row || row.reversed_at) throw new Error('Aplicarea creditului nu există sau este deja reversată.');
    if (row.entry_status !== 'active') throw new Error('Sursa creditului nu mai este activă.');
    connection.prepare('UPDATE invoice_credit_applications SET reversed_at = CURRENT_TIMESTAMP, reversal_reason = ? WHERE id = ?').run(reason, applicationId);
    connection.prepare('UPDATE company_credit_entries SET available_amount = available_amount + ? WHERE id = ?').run(row.amount, row.credit_entry_id);
    syncCompanyCreditBalance(connection, row.company_id, row.issuer_id);
    syncInvoiceFinancialStatus(connection, row.invoice_id);
    connection.prepare(`INSERT INTO billing_audit_events (event_type, issuer_id, company_id, invoice_id, details) VALUES ('company_credit_application_reversed', ?, ?, ?, ?)`).run(row.issuer_id, row.company_id, row.invoice_id, JSON.stringify({ applicationId, amount: row.amount, reason }));
    return true;
  })();
}

export function cancelCreditNoteTransaction(connection: SqliteDatabase, creditNoteIdInput: number, reasonInput: string, acknowledgeAccountingRisk: boolean) {
  const creditNoteId = requirePositiveInteger(creditNoteIdInput, 'Credit Note-ul');
  const reason = requireText(reasonInput, 'Motivul anulării', 1000);
  if (acknowledgeAccountingRisk !== true) throw new Error('Confirmă avertismentul contabil înainte de anulare.');
  return connection.transaction(() => {
    const note = connection.prepare('SELECT * FROM credit_notes WHERE id = ?').get(creditNoteId) as any;
    if (!note || note.status !== 'issued') throw new Error('Credit Note-ul nu există sau este deja anulat.');
    const entry = connection.prepare("SELECT * FROM company_credit_entries WHERE source_type = 'credit_note' AND source_id = ? AND status = 'active'").get(creditNoteId) as any;
    if (entry) {
      const applications = connection.prepare('SELECT * FROM invoice_credit_applications WHERE credit_entry_id = ? AND reversed_at IS NULL').all(entry.id) as any[];
      for (const application of applications) {
        connection.prepare('UPDATE invoice_credit_applications SET reversed_at = CURRENT_TIMESTAMP, reversal_reason = ? WHERE id = ?').run(`Anulare în cascadă ${note.reference}: ${reason}`, application.id);
        syncInvoiceFinancialStatus(connection, application.invoice_id);
      }
      connection.prepare("UPDATE company_credit_entries SET available_amount = 0, status = 'reversed', reversed_at = CURRENT_TIMESTAMP, reversal_reason = ? WHERE id = ?").run(reason, entry.id);
    }
    const returned = connection.prepare('SELECT finished_product_id, quantity FROM credit_note_items WHERE credit_note_id = ? AND return_to_stock = 1').all(creditNoteId) as Array<{ finished_product_id: number; quantity: number }>;
    for (const item of returned) {
      const stock = connection.prepare('SELECT current_stock FROM finished_products WHERE id = ?').get(item.finished_product_id) as { current_stock: number } | undefined;
      if (!stock) throw new Error('Produsul returnat nu mai există în stoc.');
      const before = Number(stock.current_stock);
      const after = before - item.quantity;
      connection.prepare('UPDATE finished_products SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(after, item.finished_product_id);
      connection.prepare(`INSERT INTO finished_product_movements (finished_product_id, movement_type, quantity, stock_before, stock_after, reference_type, reference_id, notes, created_by) VALUES (?, 'credit_note_return_reversal', ?, ?, ?, 'credit_note_cancellation', ?, ?, 'system')`)
        .run(item.finished_product_id, -item.quantity, before, after, creditNoteId, `Anulare ${note.reference}`);
    }
    connection.prepare("UPDATE credit_notes SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancellation_reason = ? WHERE id = ?").run(reason, creditNoteId);
    const invoices = connection.prepare('SELECT invoice_id FROM credit_note_invoice_links WHERE credit_note_id = ?').all(creditNoteId) as Array<{ invoice_id: number }>;
    for (const invoice of invoices) syncInvoiceFinancialStatus(connection, invoice.invoice_id);
    syncCompanyCreditBalance(connection, note.company_id, note.issuer_id);
    connection.prepare(`INSERT INTO billing_audit_events (event_type, issuer_id, company_id, details) VALUES ('credit_note_cancelled', ?, ?, ?)`).run(note.issuer_id, note.company_id, JSON.stringify({ creditNoteId, reference: note.reference, reason, accountingRiskAcknowledged: true }));
    return true;
  })();
}

export function getCompanyCreditLedger(connection: SqliteDatabase, companyIdInput: number, issuerIdInput?: number) {
  const companyId = requirePositiveInteger(companyIdInput, 'Compania');
  const issuerId = issuerIdInput === undefined ? undefined : requirePositiveInteger(issuerIdInput, 'Emitentul');
  const entries = connection.prepare(`
    SELECT entry.*, bi.legal_name AS issuer_name, bi.code AS issuer_code,
      (SELECT COALESCE(SUM(app.amount), 0) FROM invoice_credit_applications app WHERE app.credit_entry_id = entry.id AND app.reversed_at IS NULL) AS applied_amount
    FROM company_credit_entries entry JOIN billing_issuers bi ON bi.id = entry.issuer_id
    WHERE entry.company_id = ? AND (? IS NULL OR entry.issuer_id = ?) ORDER BY entry.created_at DESC, entry.id DESC
  `).all(companyId, issuerId ?? null, issuerId ?? null);
  const applications = connection.prepare(`
    SELECT app.*, entry.issuer_id, i.invoice_number FROM invoice_credit_applications app
    JOIN company_credit_entries entry ON entry.id = app.credit_entry_id JOIN invoices i ON i.id = app.invoice_id
    WHERE entry.company_id = ? AND (? IS NULL OR entry.issuer_id = ?) ORDER BY app.applied_at DESC, app.id DESC
  `).all(companyId, issuerId ?? null, issuerId ?? null);
  return { entries, applications };
}
