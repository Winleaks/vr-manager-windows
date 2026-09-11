import type Database from 'better-sqlite3';
import { requireIsoDate, requirePositiveInteger } from './businessValidation.ts';
import { getInvoiceFinancials } from './creditNotes.ts';

export function reportPeriod(from: string, to: string) {
  const start = requireIsoDate(from, 'De la');
  const end = requireIsoDate(to, 'Până la');
  if (start > end) throw new Error('Perioada este inversată.');
  return { start, end };
}
const cents = (value: number) => Math.round(value * 100);

export function paymentReport(db: Database.Database, from: string, to: string) {
  const { start, end } = reportPeriod(from, to);
  return db.prepare(`SELECT p.*, c.name AS company_name, s.name AS store_name,
    i.invoice_number, bi.legal_name AS issuer_name,
    (SELECT GROUP_CONCAT(name, ' ') FROM stores WHERE company_id = c.id) AS company_stores
    FROM payments p JOIN companies c ON c.id = p.company_id
    LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN stores s ON s.id = i.store_id
    LEFT JOIN billing_issuers bi ON bi.id = p.issuer_id
    WHERE p.payment_date BETWEEN ? AND ? ORDER BY p.payment_date DESC, c.name, p.id DESC`).all(start, end);
}

export function outstandingReport(db: Database.Database, companyId: number, issuerId: number) {
  requirePositiveInteger(companyId, 'Compania'); requirePositiveInteger(issuerId, 'Emitentul');
  const invoices = db.prepare(`SELECT i.id, i.invoice_number, i.invoice_date, s.name AS store_name
    FROM invoices i JOIN stores s ON s.id = i.store_id JOIN invoice_identities ii ON ii.invoice_id = i.id
    WHERE s.company_id = ? AND ii.issuer_id = ? AND i.status != 'cancelled'
    ORDER BY i.invoice_date, i.id`).all(companyId, issuerId) as Array<{ id: number; invoice_number: string; invoice_date: string; store_name: string }>;
  const rows = invoices.map(row => ({ ...row, ...getInvoiceFinancials(db, row.id) })).filter(row => row.outstanding > 0.005);
  return { rows, total: rows.reduce((sum, row) => sum + cents(row.outstanding), 0) / 100 };
}

export function statementReport(db: Database.Database, companyId: number, issuerId: number, from: string, to: string) {
  requirePositiveInteger(companyId, 'Compania'); requirePositiveInteger(issuerId, 'Emitentul');
  const { start, end } = reportPeriod(from, to);
  const company = db.prepare('SELECT id, name, address FROM companies WHERE id = ?').get(companyId) as {id:number; name:string; address:string} | undefined;
  const issuer = db.prepare('SELECT id, legal_name FROM billing_issuers WHERE id = ?').get(issuerId) as {id:number; legal_name:string} | undefined;
  if (!company || !issuer) throw new Error('Compania sau emitentul nu există.');
  const entries = db.prepare(`
    SELECT i.invoice_date AS date, 'Invoice' AS kind, i.invoice_number AS reference, i.total_amount AS debit, 0 AS credit, i.id,
      s.name AS store_name
    FROM invoices i JOIN stores s ON s.id = i.store_id JOIN invoice_identities ii ON ii.invoice_id = i.id
    WHERE s.company_id = @companyId AND ii.issuer_id = @issuerId AND i.status != 'cancelled' AND i.invoice_date <= @end
    UNION ALL SELECT issue_date, 'Credit Note', reference, 0, total_amount, id, '' FROM credit_notes
    WHERE company_id = @companyId AND issuer_id = @issuerId AND status = 'issued' AND issue_date <= @end
    UNION ALL SELECT p.payment_date, 'Payment', COALESCE(i.invoice_number, 'Advance') || ' / ' || p.method || COALESCE(' / ' || p.bank_name, ''), 0, p.amount, p.id, COALESCE(s.name, '')
    FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN stores s ON s.id = i.store_id
    WHERE p.company_id = @companyId AND p.issuer_id = @issuerId AND p.payment_date <= @end
    ORDER BY date, kind, id`).all({ companyId, issuerId, end }) as Array<{date:string; kind:string; reference:string; debit:number; credit:number; id:number; store_name:string}>;
  const legacyCredit = Number((db.prepare(`SELECT COALESCE(SUM(original_amount),0) AS value FROM company_credit_entries
    WHERE company_id=? AND issuer_id=? AND source_type='legacy' AND status='active'`).get(companyId,issuerId) as {value:number}).value);
  let balance = 0 - cents(legacyCredit);
  for (const row of entries.filter(row => row.date < start)) balance += cents(row.debit) - cents(row.credit);
  const opening = balance / 100;
  const rows = entries.filter(row => row.date >= start).map(row => {
    balance += cents(row.debit) - cents(row.credit);
    return { ...row, balance: balance / 100 };
  });
  return { company, issuer, from: start, to: end, opening, closing: balance / 100, rows, legacyCredit };
}

export function weeklyBillingStats(db: Database.Database, issuerId: number | undefined, from: string, to: string) {
  const { start, end } = reportPeriod(from, to);
  if (issuerId !== undefined) requirePositiveInteger(issuerId, 'Emitentul');
  const id = issuerId ?? null;
  const scalar = (sql: string) => Number((db.prepare(sql).get(start, end, id, id) as { value:number }).value);
  const invoices = db.prepare(`SELECT i.id FROM invoices i JOIN invoice_identities ii ON ii.invoice_id=i.id
    WHERE i.status != 'cancelled' AND (? IS NULL OR ii.issuer_id=?)`).all(id, id) as Array<{id:number}>;
  return {
    totalInvoiced: scalar(`SELECT COALESCE(SUM(i.total_amount),0) AS value FROM invoices i JOIN invoice_identities ii ON ii.invoice_id=i.id WHERE i.invoice_date BETWEEN ? AND ? AND (? IS NULL OR ii.issuer_id=?) AND i.status!='cancelled'`),
    totalPaid: scalar(`SELECT COALESCE(SUM(amount),0) AS value FROM payments WHERE payment_date BETWEEN ? AND ? AND (? IS NULL OR issuer_id=?)`),
    totalCredited: scalar(`SELECT COALESCE(SUM(total_amount),0) AS value FROM credit_notes WHERE issue_date BETWEEN ? AND ? AND (? IS NULL OR issuer_id=?) AND status='issued'`),
    totalUnpaid: invoices.reduce((sum,row) => sum + cents(getInvoiceFinancials(db,row.id).outstanding),0)/100,
  };
}
