import type Database from 'better-sqlite3';
import {
  optionalText,
  requirePositiveInteger,
  requireText,
} from './businessValidation.ts';

type SqliteDatabase = Database.Database;

export interface BillingIssuerRow {
  id: number;
  code: string;
  legal_name: string;
  address: string | null;
  company_number: string | null;
  vat_registered: number;
  vat_number: string | null;
  bank_name_1: string | null;
  account_number_1: string | null;
  sort_code_1: string | null;
  bank_name_2: string | null;
  account_number_2: string | null;
  sort_code_2: string | null;
  footer: string | null;
  invoice_series: string | null;
  next_invoice_number: number;
  credit_note_series?: string | null;
  next_credit_note_number?: number;
  credit_note_sequence_confirmed?: number;
  color: string;
  alternate_row_color: string;
  alternate_row_opacity: number;
  is_default: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface BillingIssuerSnapshot {
  issuerId: number;
  code: string;
  issuerName: string;
  issuerAddress: string;
  issuerCrn: string;
  issuerVat: string;
  vatRegistered: boolean;
  invoiceBankName1: string;
  invoiceAccountNumber: string;
  invoiceSortCode: string;
  invoiceBankName2: string;
  invoiceAccountNumber2: string;
  invoiceSortCode2: string;
  invoiceFooter: string;
  invoiceColor: string;
  invoiceAlternateRowColor: string;
  invoiceAlternateRowOpacity: number;
  invoiceSeries: string;
}

export interface UpdateBillingIssuerInput {
  id: number;
  legalName: string;
  address?: string;
  companyNumber?: string;
  vatRegistered: boolean;
  vatNumber?: string;
  bankName1?: string;
  accountNumber1?: string;
  sortCode1?: string;
  bankName2?: string;
  accountNumber2?: string;
  sortCode2?: string;
  footer?: string;
  invoiceSeries?: string;
  nextInvoiceNumber: number;
  color?: string;
  alternateRowColor?: string;
  alternateRowOpacity?: number;
  isActive: boolean;
  counterChangeReason?: string;
  creditNoteSeries?: string;
  nextCreditNoteNumber?: number;
  confirmCreditNoteSequence?: boolean;
  creditNoteCounterChangeReason?: string;
}

function columnExists(connection: SqliteDatabase, table: string, column: string) {
  return (connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);
}

function setting(connection: SqliteDatabase, key: string, fallback = '') {
  const row = connection.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

function positiveInteger(value: unknown, fallback = 1) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizedLegacySeries(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.slice(0, 20) || 'FACT';
}

function legacyInvoiceSequence(value: unknown, series: string) {
  const text = String(value ?? '').trim();
  if (/^\d+$/.test(text)) return positiveInteger(text, 0) || null;
  const escapedSeries = series.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const seriesMatch = text.match(new RegExp(`^${escapedSeries}[-\\s#]*(\\d+)$`, 'i'));
  if (seriesMatch) return positiveInteger(seriesMatch[1], 0) || null;
  const trailingMatch = text.match(/(?:^|[-\s#])(\d+)$/);
  return trailingMatch ? positiveInteger(trailingMatch[1], 0) || null : null;
}

function normalizedColor(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toUpperCase() : fallback;
}

export function normalizeInvoiceSeries(value: unknown) {
  const series = requireText(value, 'Seria facturii', 20).trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(series)) {
    throw new Error('Seria poate conține numai litere mari, cifre și cratimă.');
  }
  return series;
}

export function issuerSnapshot(row: BillingIssuerRow): BillingIssuerSnapshot {
  return {
    issuerId: row.id,
    code: row.code,
    issuerName: row.legal_name,
    issuerAddress: row.address || '',
    issuerCrn: row.company_number || '',
    issuerVat: row.vat_number || '',
    vatRegistered: row.vat_registered === 1,
    invoiceBankName1: row.bank_name_1 || '',
    invoiceAccountNumber: row.account_number_1 || '',
    invoiceSortCode: row.sort_code_1 || '',
    invoiceBankName2: row.bank_name_2 || '',
    invoiceAccountNumber2: row.account_number_2 || '',
    invoiceSortCode2: row.sort_code_2 || '',
    invoiceFooter: row.footer || '',
    invoiceColor: row.color || '#4F46E5',
    invoiceAlternateRowColor: row.alternate_row_color || row.color || '#4F46E5',
    invoiceAlternateRowOpacity: Number.isFinite(row.alternate_row_opacity) ? row.alternate_row_opacity : 5,
    invoiceSeries: row.invoice_series || '',
  };
}

export function isIssuerReady(row: BillingIssuerRow) {
  return Boolean(
    row.is_active === 1
    && row.legal_name?.trim()
    && row.address?.trim()
    && row.company_number?.trim()
    && row.invoice_series?.trim()
    && Number.isSafeInteger(row.next_invoice_number)
    && row.next_invoice_number > 0
    && row.bank_name_1?.trim()
    && row.account_number_1?.trim()
    && row.sort_code_1?.trim()
    && (row.vat_registered !== 1 || row.vat_number?.trim()),
  );
}

export function ensureBillingIssuerSchema(connection: SqliteDatabase) {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS billing_issuers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      legal_name TEXT NOT NULL,
      address TEXT,
      company_number TEXT,
      vat_registered INTEGER NOT NULL DEFAULT 0 CHECK(vat_registered IN (0, 1)),
      vat_number TEXT,
      bank_name_1 TEXT,
      account_number_1 TEXT,
      sort_code_1 TEXT,
      bank_name_2 TEXT,
      account_number_2 TEXT,
      sort_code_2 TEXT,
      footer TEXT,
      invoice_series TEXT COLLATE NOCASE,
      next_invoice_number INTEGER NOT NULL DEFAULT 1 CHECK(next_invoice_number > 0),
      color TEXT NOT NULL DEFAULT '#4F46E5',
      alternate_row_color TEXT NOT NULL DEFAULT '#4F46E5',
      alternate_row_opacity INTEGER NOT NULL DEFAULT 5 CHECK(alternate_row_opacity BETWEEN 0 AND 30),
      is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
      is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0, 1)),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_issuer_series
      ON billing_issuers(invoice_series COLLATE NOCASE) WHERE invoice_series IS NOT NULL AND invoice_series != '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_single_default
      ON billing_issuers(is_default) WHERE is_default = 1;

    CREATE TABLE IF NOT EXISTS invoice_identities (
      invoice_id INTEGER PRIMARY KEY,
      issuer_id INTEGER NOT NULL,
      series TEXT NOT NULL,
      sequence_number INTEGER,
      reference TEXT NOT NULL UNIQUE COLLATE NOCASE,
      issuer_snapshot_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(invoice_id) REFERENCES invoices(id),
      FOREIGN KEY(issuer_id) REFERENCES billing_issuers(id),
      UNIQUE(issuer_id, series, sequence_number)
    );
    CREATE INDEX IF NOT EXISTS idx_invoice_identities_issuer ON invoice_identities(issuer_id, sequence_number);

    CREATE TABLE IF NOT EXISTS company_issuer_credits (
      company_id INTEGER NOT NULL,
      issuer_id INTEGER NOT NULL,
      balance REAL NOT NULL DEFAULT 0 CHECK(balance >= 0),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(company_id, issuer_id),
      FOREIGN KEY(company_id) REFERENCES companies(id),
      FOREIGN KEY(issuer_id) REFERENCES billing_issuers(id)
    );

    CREATE TABLE IF NOT EXISTS invoice_replacements (
      cancelled_invoice_id INTEGER PRIMARY KEY,
      replacement_invoice_id INTEGER NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(cancelled_invoice_id) REFERENCES invoices(id),
      FOREIGN KEY(replacement_invoice_id) REFERENCES invoices(id)
    );

    CREATE TABLE IF NOT EXISTS billing_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      issuer_id INTEGER,
      company_id INTEGER,
      invoice_id INTEGER,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(issuer_id) REFERENCES billing_issuers(id),
      FOREIGN KEY(company_id) REFERENCES companies(id),
      FOREIGN KEY(invoice_id) REFERENCES invoices(id)
    );
    CREATE INDEX IF NOT EXISTS idx_billing_audit_created ON billing_audit_events(created_at);
  `);

  if (!columnExists(connection, 'companies', 'issuer_id')) connection.exec('ALTER TABLE companies ADD COLUMN issuer_id INTEGER;');
  if (!columnExists(connection, 'payments', 'issuer_id')) connection.exec('ALTER TABLE payments ADD COLUMN issuer_id INTEGER;');
  if (!columnExists(connection, 'invoices', 'cancelled_at')) connection.exec('ALTER TABLE invoices ADD COLUMN cancelled_at DATETIME;');
  if (!columnExists(connection, 'invoices', 'cancellation_reason')) connection.exec('ALTER TABLE invoices ADD COLUMN cancellation_reason TEXT;');
  // Kept additive here as well so isolated billing operations remain safe while
  // databases move from issuer migration v12 to Credit Notes migration v13.
  if (!columnExists(connection, 'invoice_items', 'external_product_id')) connection.exec('ALTER TABLE invoice_items ADD COLUMN external_product_id TEXT;');
  if (!columnExists(connection, 'invoice_items', 'finished_product_id')) connection.exec('ALTER TABLE invoice_items ADD COLUMN finished_product_id INTEGER;');

  const existingGoodness = connection.prepare("SELECT id FROM billing_issuers WHERE code = 'goodness'").get() as { id: number } | undefined;
  if (!existingGoodness) {
    const legacySeries = normalizedLegacySeries(setting(connection, 'invoice_series', 'FACT'));
    const configuredNext = positiveInteger(setting(connection, 'invoice_start_number', '1'));
    const maxLegacy = (connection.prepare('SELECT invoice_number FROM invoices').all() as Array<{ invoice_number: string }>)
      .reduce((maximum, invoice) => Math.max(maximum, legacyInvoiceSequence(invoice.invoice_number, legacySeries) || 0), 0);
    connection.prepare(`
      INSERT INTO billing_issuers (
        code, legal_name, address, company_number, vat_registered, vat_number,
        bank_name_1, account_number_1, sort_code_1, bank_name_2, account_number_2, sort_code_2,
        footer, invoice_series, next_invoice_number, color, alternate_row_color,
        alternate_row_opacity, is_default, is_active
      ) VALUES ('goodness', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)
    `).run(
      setting(connection, 'issuer_name', 'THE GOODNESS BAKER LTD') || 'THE GOODNESS BAKER LTD',
      setting(connection, 'issuer_address'),
      setting(connection, 'issuer_crn'),
      setting(connection, 'issuer_vat'),
      setting(connection, 'invoice_bank_name_1', setting(connection, 'invoice_bank_name')),
      setting(connection, 'invoice_account_number'),
      setting(connection, 'invoice_sort_code'),
      setting(connection, 'invoice_bank_name_2'),
      setting(connection, 'invoice_account_number_2'),
      setting(connection, 'invoice_sort_code_2'),
      setting(connection, 'invoice_footer'),
      legacySeries,
      Math.max(configuredNext, maxLegacy + 1),
      normalizedColor(setting(connection, 'invoice_color'), '#4F46E5'),
      normalizedColor(setting(connection, 'invoice_alternate_row_color'), '#4F46E5'),
      Math.max(0, Math.min(30, Number(setting(connection, 'invoice_alternate_row_opacity', '5')) || 5)),
    );
  }

  connection.prepare(`
    INSERT OR IGNORE INTO billing_issuers (
      code, legal_name, vat_registered, next_invoice_number, color,
      alternate_row_color, alternate_row_opacity, is_default, is_active
    ) VALUES ('vatra', 'VATRA ROMANEASCA LTD', 0, 1, '#B45309', '#B45309', 5, 0, 0)
  `).run();

  const defaultIssuer = connection.prepare('SELECT * FROM billing_issuers WHERE is_default = 1').get() as BillingIssuerRow;
  connection.prepare('UPDATE companies SET issuer_id = ? WHERE issuer_id IS NULL').run(defaultIssuer.id);

  const snapshotJson = JSON.stringify(issuerSnapshot(defaultIssuer));
  const historicalInvoices = connection.prepare(`
    SELECT i.id, i.invoice_number
    FROM invoices i LEFT JOIN invoice_identities ii ON ii.invoice_id = i.id
    WHERE ii.invoice_id IS NULL
    ORDER BY i.id
  `).all() as Array<{ id: number; invoice_number: string }>;
  const insertIdentity = connection.prepare(`
    INSERT INTO invoice_identities (invoice_id, issuer_id, series, sequence_number, reference, issuer_snapshot_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const usedSequences = new Set((connection.prepare(`
    SELECT sequence_number FROM invoice_identities
    WHERE issuer_id = ? AND series = ? COLLATE NOCASE AND sequence_number IS NOT NULL
  `).all(defaultIssuer.id, defaultIssuer.invoice_series || 'FACT') as Array<{ sequence_number: number }>).map((row) => row.sequence_number));
  for (const invoice of historicalInvoices) {
    const series = defaultIssuer.invoice_series || 'FACT';
    const candidateSequence = legacyInvoiceSequence(invoice.invoice_number, series);
    const sequence = candidateSequence && !usedSequences.has(candidateSequence) ? candidateSequence : null;
    if (sequence) usedSequences.add(sequence);
    const baseReference = invoice.invoice_number.toUpperCase().startsWith(`${series.toUpperCase()}-`)
      ? invoice.invoice_number
      : `${series}-${invoice.invoice_number}`;
    let reference = baseReference;
    let suffix = 1;
    while (connection.prepare('SELECT 1 FROM invoice_identities WHERE reference = ? COLLATE NOCASE').get(reference)) {
      suffix += 1;
      reference = `${baseReference}-LEGACY-${suffix}`;
    }
    insertIdentity.run(invoice.id, defaultIssuer.id, defaultIssuer.invoice_series || 'FACT', sequence, reference, snapshotJson);
  }

  connection.prepare(`
    UPDATE payments
    SET issuer_id = COALESCE(
      (SELECT issuer_id FROM invoice_identities WHERE invoice_id = payments.invoice_id),
      ?
    )
    WHERE issuer_id IS NULL
  `).run(defaultIssuer.id);
  connection.prepare(`
    INSERT OR IGNORE INTO company_issuer_credits (company_id, issuer_id, balance)
    SELECT id, ?, MAX(0, COALESCE(credit_balance, 0)) FROM companies
  `).run(defaultIssuer.id);
  connection.prepare(`
    INSERT INTO app_settings (key, value) VALUES ('billing_issuers_migrated_v1', '1')
    ON CONFLICT(key) DO UPDATE SET value = '1'
  `).run();
}

export function getBillingIssuers(connection: SqliteDatabase) {
  return (connection.prepare('SELECT * FROM billing_issuers ORDER BY is_default DESC, legal_name').all() as BillingIssuerRow[])
    .map((row) => ({ ...row, isReady: isIssuerReady(row), settings: issuerSnapshot(row) }));
}

export function getBillingIssuer(connection: SqliteDatabase, issuerId: number) {
  return connection.prepare('SELECT * FROM billing_issuers WHERE id = ?').get(requirePositiveInteger(issuerId, 'Emitentul')) as BillingIssuerRow | undefined;
}

export function updateBillingIssuer(connection: SqliteDatabase, input: UpdateBillingIssuerInput) {
  const issuerId = requirePositiveInteger(input.id, 'Emitentul');
  const existing = getBillingIssuer(connection, issuerId);
  if (!existing) throw new Error('Emitentul nu există.');
  if (existing.code === 'goodness' && !input.vatRegistered) throw new Error('THE GOODNESS BAKER LTD trebuie păstrată ca societate VAT registered.');
  if (existing.code === 'vatra' && input.vatRegistered) throw new Error('VATRA ROMANEASCA LTD este configurată ca societate non-VAT.');
  if (existing.is_default === 1 && !input.isActive) throw new Error('Emitentul implicit nu poate fi dezactivat.');
  const legalName = requireText(input.legalName, 'Denumirea juridică', 200);
  const address = optionalText(input.address, 'Adresa emitentului', 500);
  const companyNumber = optionalText(input.companyNumber, 'Company Registration Number', 100);
  const vatNumber = optionalText(input.vatNumber, 'VAT Number', 100);
  const bankName1 = optionalText(input.bankName1, 'Banca principală', 200);
  const accountNumber1 = optionalText(input.accountNumber1, 'Numărul contului principal', 100);
  const sortCode1 = optionalText(input.sortCode1, 'Sort Code principal', 50);
  const series = input.invoiceSeries?.trim() ? normalizeInvoiceSeries(input.invoiceSeries) : null;
  const nextNumber = requirePositiveInteger(input.nextInvoiceNumber, 'Următorul număr de factură');
  const issued = connection.prepare('SELECT COUNT(*) AS count, MAX(sequence_number) AS maximum FROM invoice_identities WHERE issuer_id = ?').get(issuerId) as { count: number; maximum: number | null };
  const minimumNext = (issued.maximum || 0) + 1;
  if (nextNumber < minimumNext) throw new Error(`Următorul număr nu poate fi mai mic decât ${minimumNext}.`);
  if (issued.count > 0 && series !== existing.invoice_series) throw new Error('Seria unui emitent cu facturi emise nu poate fi modificată.');
  if (issued.count > 0 && nextNumber > existing.next_invoice_number) {
    requireText(input.counterChangeReason, 'Motivul modificării contorului', 500);
  }
  if (input.isActive) {
    if (!address || !companyNumber || !series || !bankName1 || !accountNumber1 || !sortCode1) {
      throw new Error('Pentru activare completează adresa, CRN, seria și contul bancar principal.');
    }
    if (input.vatRegistered && !vatNumber) throw new Error('VAT Number este obligatoriu pentru un emitent VAT registered.');
  }
  const color = normalizedColor(input.color, existing.color || '#4F46E5');
  const alternate = normalizedColor(input.alternateRowColor, color);
  const opacity = Math.max(0, Math.min(30, Number(input.alternateRowOpacity ?? existing.alternate_row_opacity ?? 5)));

  return connection.transaction(() => {
    connection.prepare(`
      UPDATE billing_issuers SET
        legal_name = ?, address = ?, company_number = ?, vat_registered = ?, vat_number = ?,
        bank_name_1 = ?, account_number_1 = ?, sort_code_1 = ?, bank_name_2 = ?,
        account_number_2 = ?, sort_code_2 = ?, footer = ?, invoice_series = ?,
        next_invoice_number = ?, color = ?, alternate_row_color = ?, alternate_row_opacity = ?,
        is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      legalName, address, companyNumber, input.vatRegistered ? 1 : 0, input.vatRegistered ? vatNumber : null,
      bankName1, accountNumber1, sortCode1,
      optionalText(input.bankName2, 'Banca secundară', 200),
      optionalText(input.accountNumber2, 'Numărul contului secundar', 100),
      optionalText(input.sortCode2, 'Sort Code secundar', 50),
      optionalText(input.footer, 'Footerul facturii', 2000),
      series, nextNumber, color, alternate, opacity, input.isActive ? 1 : 0, issuerId,
    );
    if (columnExists(connection, 'billing_issuers', 'credit_note_series')) {
      const currentSeries = existing.credit_note_series || (existing.code === 'goodness' ? 'CN-TGB' : existing.code === 'vatra' ? 'CN-VATRA' : `CN-${existing.code.toUpperCase()}`);
      const creditNoteSeries = normalizeInvoiceSeries(input.creditNoteSeries?.trim() || currentSeries);
      const nextCreditNoteNumber = requirePositiveInteger(input.nextCreditNoteNumber ?? existing.next_credit_note_number ?? 1, 'Următorul număr Credit Note');
      const issuedCreditNotes = connection.prepare('SELECT COUNT(*) AS count, MAX(sequence_number) AS maximum FROM credit_notes WHERE issuer_id = ?').get(issuerId) as { count: number; maximum: number | null };
      const minimumCreditNoteNumber = (issuedCreditNotes.maximum || 0) + 1;
      if (nextCreditNoteNumber < minimumCreditNoteNumber) throw new Error(`Următorul număr Credit Note nu poate fi mai mic decât ${minimumCreditNoteNumber}.`);
      if (issuedCreditNotes.count > 0 && creditNoteSeries !== existing.credit_note_series) throw new Error('Seria Credit Note nu mai poate fi schimbată după prima emitere.');
      if (issuedCreditNotes.count > 0 && nextCreditNoteNumber > (existing.next_credit_note_number || 1)) {
        requireText(input.creditNoteCounterChangeReason, 'Motivul modificării contorului Credit Note', 500);
      }
      const confirmed = input.confirmCreditNoteSequence === undefined
        ? (existing.credit_note_sequence_confirmed || 0)
        : input.confirmCreditNoteSequence ? 1 : 0;
      connection.prepare(`
        UPDATE billing_issuers SET credit_note_series = ?, next_credit_note_number = ?,
          credit_note_sequence_confirmed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(creditNoteSeries, nextCreditNoteNumber, confirmed, issuerId);
      if (creditNoteSeries !== existing.credit_note_series || nextCreditNoteNumber !== existing.next_credit_note_number || confirmed !== existing.credit_note_sequence_confirmed) {
        connection.prepare(`INSERT INTO billing_audit_events (event_type, issuer_id, details) VALUES ('credit_note_numbering_updated', ?, ?)`)
          .run(issuerId, JSON.stringify({ series: creditNoteSeries, nextNumber: nextCreditNoteNumber, confirmed: Boolean(confirmed), reason: input.creditNoteCounterChangeReason?.trim() || null }));
      }
    }
    connection.prepare(`
      INSERT INTO billing_audit_events (event_type, issuer_id, details) VALUES ('issuer_updated', ?, ?)
    `).run(issuerId, JSON.stringify({ counterChanged: nextNumber !== existing.next_invoice_number, reason: input.counterChangeReason?.trim() || null }));
    return getBillingIssuers(connection).find((issuer) => issuer.id === issuerId);
  })();
}

export function assignCompanyIssuer(connection: SqliteDatabase, companyIdInput: number, issuerIdInput: number) {
  const companyId = requirePositiveInteger(companyIdInput, 'Compania');
  const issuerId = requirePositiveInteger(issuerIdInput, 'Emitentul');
  const issuer = getBillingIssuer(connection, issuerId);
  if (!issuer || !isIssuerReady(issuer)) throw new Error('Emitentul selectat nu este activ și configurat complet.');
  const company = connection.prepare('SELECT id, issuer_id FROM companies WHERE id = ? AND is_active = 1').get(companyId) as { id: number; issuer_id: number | null } | undefined;
  if (!company) throw new Error('Compania nu există sau este inactivă.');
  return connection.transaction(() => {
    connection.prepare('UPDATE companies SET issuer_id = ? WHERE id = ?').run(issuerId, companyId);
    connection.prepare('INSERT OR IGNORE INTO company_issuer_credits (company_id, issuer_id, balance) VALUES (?, ?, 0)').run(companyId, issuerId);
    connection.prepare(`INSERT INTO billing_audit_events (event_type, issuer_id, company_id, details) VALUES ('company_issuer_assigned', ?, ?, ?)`)
      .run(issuerId, companyId, JSON.stringify({ previousIssuerId: company.issuer_id }));
    return true;
  })();
}

export function invoiceSettingsFromIdentity(row: { issuer_snapshot_json?: string | null }) {
  if (!row.issuer_snapshot_json) return null;
  try { return JSON.parse(row.issuer_snapshot_json) as BillingIssuerSnapshot; } catch { return null; }
}
