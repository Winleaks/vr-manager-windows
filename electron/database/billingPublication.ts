import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

// Triggers participate in the caller's transaction, including rollback and deletes.
export function installBillingPublication(db: Database.Database) {
  db.exec(`
    ALTER TABLE invoices ADD COLUMN drive_file_id TEXT;
    ALTER TABLE invoices ADD COLUMN document_revision INTEGER NOT NULL DEFAULT 1;
    CREATE TABLE billing_publication_identity (id INTEGER PRIMARY KEY CHECK(id=1), source_id TEXT NOT NULL);
    CREATE TABLE billing_publication_queue (
      company_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1,
      published_revision INTEGER NOT NULL DEFAULT 0, last_error TEXT, retry_at INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE billing_publication_delivery (
      company_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL
    );
    CREATE TABLE billing_publication_deleted (company_id INTEGER NOT NULL, invoice_id TEXT NOT NULL,
      PRIMARY KEY(company_id, invoice_id));
    INSERT INTO billing_publication_queue(company_id) SELECT id FROM companies;
    CREATE TRIGGER billing_company_insert AFTER INSERT ON companies BEGIN
      INSERT OR IGNORE INTO billing_publication_queue(company_id) VALUES(NEW.id);
    END;
    CREATE TRIGGER billing_company_update AFTER UPDATE OF credit_balance, supabase_company_id ON companies BEGIN
      INSERT INTO billing_publication_queue(company_id) VALUES(NEW.id)
      ON CONFLICT(company_id) DO UPDATE SET revision=revision+1, retry_at=0;
    END;
    CREATE TRIGGER billing_store_update AFTER UPDATE OF company_id, supabase_store_id, name ON stores BEGIN
      UPDATE billing_publication_queue SET revision=revision+1, retry_at=0 WHERE company_id IN (OLD.company_id, NEW.company_id);
    END;
    CREATE TRIGGER billing_invoice_insert AFTER INSERT ON invoices BEGIN
      UPDATE billing_publication_queue SET revision=revision+1, retry_at=0 WHERE company_id=(SELECT company_id FROM stores WHERE id=NEW.store_id);
    END;
    CREATE TRIGGER billing_invoice_update AFTER UPDATE OF total_amount, paid_amount, invoice_number, invoice_date, store_id, drive_file_id ON invoices BEGIN
      UPDATE billing_publication_queue SET revision=revision+1, retry_at=0 WHERE company_id IN (SELECT company_id FROM stores WHERE id IN (OLD.store_id, NEW.store_id));
    END;
    CREATE TRIGGER billing_invoice_document AFTER UPDATE OF total_amount, invoice_number, invoice_date, store_id ON invoices BEGIN
      UPDATE invoices SET drive_file_id=NULL, document_revision=document_revision+1 WHERE id=NEW.id;
    END;
    CREATE TRIGGER billing_item_update AFTER UPDATE ON invoice_items BEGIN
      UPDATE invoices SET drive_file_id=NULL, document_revision=document_revision+1 WHERE id IN (OLD.invoice_id, NEW.invoice_id);
    END;
    CREATE TRIGGER billing_item_insert AFTER INSERT ON invoice_items BEGIN
      UPDATE invoices SET drive_file_id=NULL, document_revision=document_revision+1 WHERE id=NEW.invoice_id;
    END;
    CREATE TRIGGER billing_item_delete AFTER DELETE ON invoice_items BEGIN
      UPDATE invoices SET drive_file_id=NULL, document_revision=document_revision+1 WHERE id=OLD.invoice_id;
    END;
    CREATE TRIGGER billing_invoice_delete BEFORE DELETE ON invoices BEGIN
      INSERT OR IGNORE INTO billing_publication_deleted(company_id,invoice_id)
        SELECT company_id, CAST(OLD.id AS TEXT) FROM stores WHERE id=OLD.store_id;
      UPDATE billing_publication_queue SET revision=revision+1, retry_at=0 WHERE company_id=(SELECT company_id FROM stores WHERE id=OLD.store_id);
    END;
  `);
  db.prepare("INSERT INTO billing_publication_identity VALUES(1,?)").run(
    randomUUID(),
  );
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function moneyInPence(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1e9) {
    throw new Error("Suma financiară este invalidă.");
  }
  return Math.round(value * 100);
}
export function prepareBillingDelivery(
  db: Database.Database,
  companyId: number,
) {
  return db.transaction(() => {
    const existing = db.prepare(
      "SELECT payload FROM billing_publication_delivery WHERE company_id=?",
    ).get(companyId) as { payload: string } | undefined;
    if (existing) return JSON.parse(existing.payload);
    const company = db.prepare("SELECT * FROM companies WHERE id=?").get(
      companyId,
    ) as any;
    if (!company || !uuid.test(company.supabase_company_id || "")) {
      throw new Error("Compania nu are o asociere VR Baker validă.");
    }
    const duplicates = db.prepare(
      "SELECT COUNT(*) AS n FROM companies WHERE supabase_company_id=?",
    ).get(company.supabase_company_id) as { n: number };
    if (duplicates.n !== 1) {
      throw new Error(
        "Asociere de companie duplicată; sincronizarea este blocată.",
      );
    }
    const rows = db.prepare(
      `SELECT i.*, s.supabase_store_id, s.name AS store_name FROM invoices i JOIN stores s ON s.id=i.store_id WHERE s.company_id=? ORDER BY i.id`,
    ).all(companyId) as any[];
    const invoices = rows.map((i) => {
      if (!uuid.test(i.supabase_store_id || "")) {
        throw new Error(
          "O factură are un magazin fără asociere VR Baker validă.",
        );
      }
      const total = moneyInPence(i.total_amount),
        paid = moneyInPence(i.paid_amount);
      if (paid > total) {
        throw new Error("Factura are o sumă achitată peste total.");
      }
      return {
        id: String(i.id),
        store_id: i.supabase_store_id,
        number: i.invoice_number,
        date: i.invoice_date,
        total,
        paid,
        drive_file_id: i.drive_file_id || null,
      };
    });
    const { revision } = db.prepare(
      "SELECT revision FROM billing_publication_queue WHERE company_id=?",
    ).get(companyId) as { revision: number };
    const { source_id } = db.prepare(
      "SELECT source_id FROM billing_publication_identity WHERE id=1",
    ).get() as { source_id: string };
    const deleted = (db.prepare(
      "SELECT invoice_id FROM billing_publication_deleted WHERE company_id=?",
    ).all(companyId) as { invoice_id: string }[]).map((i) => i.invoice_id);
    const payload = {
      source_id,
      company_id: company.supabase_company_id,
      revision,
      credit: moneyInPence(company.credit_balance || 0),
      invoices,
      deleted,
    };
    db.prepare("INSERT INTO billing_publication_delivery VALUES(?,?,?)").run(
      companyId,
      revision,
      JSON.stringify(payload),
    );
    return payload;
  })();
}
export function acknowledgeBillingDelivery(
  db: Database.Database,
  companyId: number,
  revision: number,
) {
  db.transaction(() => {
    db.prepare(
      "UPDATE billing_publication_queue SET published_revision=?, last_error=NULL, attempts=0, retry_at=0 WHERE company_id=?",
    ).run(revision, companyId);
    db.prepare(
      "DELETE FROM billing_publication_delivery WHERE company_id=? AND revision=?",
    ).run(companyId, revision);
    // Tombstones are retained: replaying them is harmless and they survive restored snapshots.
  })();
}
