import type Database from 'better-sqlite3';
import { invoicePaymentTerms } from '../../src/shared/invoicePaymentTerms.ts';
export function readInvoicePaymentTerms(db: Database.Database, id: number, issued: string) {
  const replacements=!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='invoice_replacements'").get();
  const period=db.prepare(replacements ? `WITH RECURSIVE lineage(id) AS (
    SELECT ? UNION SELECT r.cancelled_invoice_id FROM invoice_replacements r JOIN lineage l ON r.replacement_invoice_id=l.id
  ) SELECT b.period_start,b.period_end FROM invoice_import_batches b JOIN lineage l ON l.id=b.invoice_id ORDER BY b.id DESC LIMIT 1`
    : 'SELECT period_start,period_end FROM invoice_import_batches WHERE invoice_id=?').get(id) as {period_start:string;period_end:string}|undefined;
  return invoicePaymentTerms(issued,period?.period_start,period?.period_end,!!period);
}
/** Upgrade v24 installations without replacing prepared financial publications or PDFs. */
export function installSameDayInvoicePaymentTerms(db: Database.Database) {
  db.exec(`
    DROP TRIGGER invoice_terms_insert;
    DROP TRIGGER invoice_terms_date;
    CREATE TRIGGER invoice_terms_insert AFTER INSERT ON invoices BEGIN
      UPDATE invoices SET due_date=date(NEW.invoice_date),due_basis='manual' WHERE id=NEW.id;
    END;
    CREATE TRIGGER invoice_terms_date AFTER UPDATE OF invoice_date ON invoices BEGIN
      UPDATE invoices SET due_date=CASE WHEN due_basis='manual' THEN date(NEW.invoice_date) ELSE due_date END WHERE id=NEW.id;
    END;
    UPDATE invoices SET due_date=date(invoice_date) WHERE due_basis='manual' AND due_date IS NOT date(invoice_date);
  `);
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='invoice_replacements'").get()) db.exec(`
    DROP TRIGGER invoice_terms_replacement;
    CREATE TRIGGER invoice_terms_replacement AFTER INSERT ON invoice_replacements BEGIN
      UPDATE invoices SET
        due_date=(SELECT CASE WHEN old.due_basis='manual' THEN date(invoices.invoice_date) ELSE old.due_date END FROM invoices old WHERE old.id=NEW.cancelled_invoice_id),
        due_basis=(SELECT due_basis FROM invoices WHERE id=NEW.cancelled_invoice_id)
      WHERE id=NEW.replacement_invoice_id;
    END;
  `);
}
/** Prepared deliveries remain immutable across upgrades and response-loss retries. */
export function installInvoicePaymentTerms(db: Database.Database) {
  db.exec(`
    ALTER TABLE invoices ADD COLUMN due_date DATE;
    ALTER TABLE invoices ADD COLUMN due_basis TEXT NOT NULL DEFAULT 'review' CHECK(due_basis IN ('weekly','manual','review'));
    UPDATE invoices SET due_date=date(invoice_date,'+4 days'),due_basis='manual'
      WHERE NOT EXISTS(SELECT 1 FROM invoice_import_batches b WHERE b.invoice_id=invoices.id);
    UPDATE invoices SET due_date=(SELECT date(period_end,'weekday 0','+4 days') FROM invoice_import_batches b WHERE b.invoice_id=invoices.id),due_basis='weekly'
      WHERE EXISTS(SELECT 1 FROM invoice_import_batches b WHERE b.invoice_id=invoices.id AND b.period_start<=b.period_end AND date(b.period_end) IS NOT NULL);
    CREATE TRIGGER invoice_terms_insert AFTER INSERT ON invoices BEGIN
      UPDATE invoices SET due_date=date(NEW.invoice_date,'+4 days'),due_basis='manual' WHERE id=NEW.id;
    END;
    CREATE TRIGGER invoice_terms_date AFTER UPDATE OF invoice_date ON invoices BEGIN
      UPDATE invoices SET due_date=CASE WHEN due_basis='manual' THEN date(NEW.invoice_date,'+4 days') ELSE due_date END WHERE id=NEW.id;
    END;
    CREATE TRIGGER invoice_terms_period_insert AFTER INSERT ON invoice_import_batches BEGIN
      UPDATE invoices SET due_date=CASE WHEN date(NEW.period_start) IS NOT NULL AND date(NEW.period_end) IS NOT NULL AND NEW.period_start<=NEW.period_end THEN date(NEW.period_end,'weekday 0','+4 days') ELSE NULL END,due_basis=CASE WHEN date(NEW.period_start) IS NOT NULL AND date(NEW.period_end) IS NOT NULL AND NEW.period_start<=NEW.period_end THEN 'weekly' ELSE 'review' END WHERE id=NEW.invoice_id;
    END;
    CREATE TRIGGER invoice_terms_period_update AFTER UPDATE OF period_start,period_end ON invoice_import_batches BEGIN
      UPDATE invoices SET due_date=CASE WHEN date(NEW.period_start) IS NOT NULL AND date(NEW.period_end) IS NOT NULL AND NEW.period_start<=NEW.period_end THEN date(NEW.period_end,'weekday 0','+4 days') ELSE NULL END,due_basis=CASE WHEN date(NEW.period_start) IS NOT NULL AND date(NEW.period_end) IS NOT NULL AND NEW.period_start<=NEW.period_end THEN 'weekly' ELSE 'review' END WHERE id=NEW.invoice_id;
    END;
    CREATE TRIGGER invoice_terms_publication AFTER UPDATE OF due_date,due_basis ON invoices BEGIN
      UPDATE billing_publication_queue SET revision=revision+1,retry_at=0 WHERE company_id=(SELECT company_id FROM stores WHERE id=NEW.store_id);
    END;
    UPDATE billing_publication_queue SET revision=revision+1,retry_at=0;
  `);
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='invoice_replacements'").get()) db.exec(`
    CREATE TRIGGER invoice_terms_replacement AFTER INSERT ON invoice_replacements BEGIN
      UPDATE invoices SET
        due_date=(SELECT CASE WHEN old.due_basis='manual' THEN date(invoices.invoice_date,'+4 days') ELSE old.due_date END FROM invoices old WHERE old.id=NEW.cancelled_invoice_id),
        due_basis=(SELECT due_basis FROM invoices WHERE id=NEW.cancelled_invoice_id)
      WHERE id=NEW.replacement_invoice_id;
    END;
    CREATE TRIGGER invoice_terms_descendants AFTER UPDATE OF due_date,due_basis ON invoices
    WHEN NEW.due_basis<>'manual' AND (NEW.due_date IS NOT OLD.due_date OR NEW.due_basis<>OLD.due_basis)
    BEGIN
      UPDATE invoices SET due_date=NEW.due_date,due_basis=NEW.due_basis WHERE id IN (
        WITH RECURSIVE descendants(id) AS (
          SELECT replacement_invoice_id FROM invoice_replacements WHERE cancelled_invoice_id=NEW.id
          UNION SELECT r.replacement_invoice_id FROM invoice_replacements r JOIN descendants d ON r.cancelled_invoice_id=d.id
        ) SELECT id FROM descendants
      );
    END;
  `);
  const update=db.prepare('UPDATE invoices SET due_date=?,due_basis=? WHERE id=?');
  for(const invoice of db.prepare('SELECT id,invoice_date FROM invoices').all() as {id:number;invoice_date:string}[]) {
    const terms=readInvoicePaymentTerms(db,invoice.id,invoice.invoice_date);
    update.run(terms.due_date,terms.due_basis,invoice.id);
  }
}
