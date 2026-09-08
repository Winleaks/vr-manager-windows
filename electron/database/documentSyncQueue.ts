import type Database from 'better-sqlite3';

export type DocumentKind = 'invoice' | 'credit_note';
export type DocumentUploadResult = { success: boolean; error?: string; retryable?: boolean };
type Job = { kind: DocumentKind; document_id: number; generation: number; attempts: number };

export function installDocumentSyncQueue(db: Database.Database) {
  db.exec(`
    CREATE TABLE document_sync_queue (
      kind TEXT NOT NULL CHECK(kind IN ('invoice','credit_note')), document_id INTEGER NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','blocked')),
      attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0, last_error TEXT, verified_at INTEGER,
      PRIMARY KEY(kind,document_id)
    );
    CREATE INDEX document_sync_due ON document_sync_queue(state,retry_at);
    INSERT INTO document_sync_queue(kind,document_id) SELECT 'invoice',id FROM invoices WHERE status!='cancelled' AND drive_file_id IS NULL;
    INSERT INTO document_sync_queue(kind,document_id) SELECT 'credit_note',id FROM credit_notes WHERE cloud_status!='ready';
    CREATE TRIGGER document_invoice_insert AFTER INSERT ON invoices WHEN NEW.status!='cancelled' BEGIN
      INSERT INTO document_sync_queue(kind,document_id) VALUES('invoice',NEW.id);
    END;
    CREATE TRIGGER document_invoice_change AFTER UPDATE OF document_revision,status ON invoices BEGIN
      INSERT INTO document_sync_queue(kind,document_id) SELECT 'invoice',NEW.id WHERE NEW.status!='cancelled'
      ON CONFLICT(kind,document_id) DO UPDATE SET generation=generation+1,state='pending',attempts=0,retry_at=0,last_error=NULL,verified_at=NULL;
      DELETE FROM document_sync_queue WHERE kind='invoice' AND document_id=NEW.id AND NEW.status='cancelled';
    END;
    CREATE TRIGGER document_invoice_delete AFTER DELETE ON invoices BEGIN
      DELETE FROM document_sync_queue WHERE kind='invoice' AND document_id=OLD.id;
    END;
    CREATE TRIGGER document_credit_insert AFTER INSERT ON credit_notes BEGIN
      INSERT INTO document_sync_queue(kind,document_id) VALUES('credit_note',NEW.id);
    END;
    CREATE TRIGGER document_credit_change AFTER UPDATE OF status ON credit_notes BEGIN
      INSERT INTO document_sync_queue(kind,document_id) VALUES('credit_note',NEW.id)
      ON CONFLICT(kind,document_id) DO UPDATE SET generation=generation+1,state='pending',attempts=0,retry_at=0,last_error=NULL,verified_at=NULL;
    END;
    CREATE TRIGGER document_credit_delete AFTER DELETE ON credit_notes BEGIN
      DELETE FROM document_sync_queue WHERE kind='credit_note' AND document_id=OLD.id;
    END;
  `);
}

export function dueDocuments(db: Database.Database, now = Date.now()) {
  return db.prepare("SELECT kind,document_id,generation,attempts FROM document_sync_queue WHERE state='pending' AND retry_at<=? ORDER BY retry_at,kind,document_id LIMIT 10").all(now) as Job[];
}

export function queueInvoiceDocument(db: Database.Database, id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Factura este invalidă.');
  db.prepare(`INSERT INTO document_sync_queue(kind,document_id) SELECT 'invoice',id FROM invoices WHERE id=? AND status!='cancelled'
    ON CONFLICT(kind,document_id) DO UPDATE SET generation=generation+1,state='pending',attempts=0,retry_at=0,last_error=NULL,verified_at=NULL`).run(id);
}

export function documentSyncStatus(db: Database.Database) {
  const totals = db.prepare("SELECT COUNT(*) AS pending, COALESCE(SUM(state='blocked'),0) AS blocked FROM document_sync_queue WHERE state!='ready'").get() as { pending: number; blocked: number };
  const items = db.prepare(`SELECT q.kind,q.document_id,q.state,q.attempts,q.last_error,
    CASE WHEN q.kind='invoice' THEN i.invoice_number ELSE c.reference END AS reference
    FROM document_sync_queue q LEFT JOIN invoices i ON q.kind='invoice' AND i.id=q.document_id
    LEFT JOIN credit_notes c ON q.kind='credit_note' AND c.id=q.document_id
    WHERE q.state!='ready' ORDER BY q.state,q.retry_at,q.document_id LIMIT 10`).all() as Array<{
      kind: DocumentKind; document_id: number; state: string; attempts: number; last_error: string | null; reference: string;
    }>;
  return { ...totals, items };
}

export function retryDocumentSync(db: Database.Database) {
  // Invalidate in-flight acknowledgements, too. A manual retry cannot clear a
  // newer edit or mark a previous generation as confirmed.
  db.prepare("UPDATE document_sync_queue SET generation=generation+1,state='pending',attempts=0,retry_at=0,last_error=NULL WHERE state!='ready'").run();
}

export async function trackDocumentUpload<T extends DocumentUploadResult>(
  db: Database.Database, kind: DocumentKind, id: number, current: () => boolean, upload: () => Promise<T>,
): Promise<T | DocumentUploadResult> {
  if (!current()) return { success: false, error: 'Doar Writer poate sincroniza documentele.' };
  if (!Number.isSafeInteger(id) || id <= 0 || !['invoice','credit_note'].includes(kind)) throw new Error('Document invalid.');
  const exists = kind === 'invoice'
    ? db.prepare("SELECT id FROM invoices WHERE id=? AND status!='cancelled'").get(id)
    : db.prepare('SELECT id FROM credit_notes WHERE id=?').get(id);
  if (!exists) return { success: false, error: 'Documentul nu mai este disponibil.', retryable: false };
  db.prepare('INSERT OR IGNORE INTO document_sync_queue(kind,document_id) VALUES(?,?)').run(kind,id);
  const job = db.prepare('SELECT generation,attempts FROM document_sync_queue WHERE kind=? AND document_id=?').get(kind,id) as Job;
  db.prepare("UPDATE document_sync_queue SET state='pending',verified_at=NULL WHERE kind=? AND document_id=?").run(kind,id);
  let result: T | DocumentUploadResult;
  try { result = await upload(); }
  catch { result = { success: false, error: 'Documentul nu a fost confirmat în Drive. Reîncercarea este păstrată.', retryable: true }; }
  if (!current()) return { success: false, error: 'Calculatorul Writer sau baza de date s-a schimbat.' };
  const attempts = job.attempts + 1;
  const blocked = result.retryable === false || attempts >= 8;
  const delay = Math.min(900_000, 30_000 * 2 ** Math.min(attempts - 1, 5)) + Math.floor(Math.random() * 5000);
  const changed = db.prepare(`UPDATE document_sync_queue SET state=?,attempts=?,retry_at=?,last_error=?,verified_at=?
    WHERE kind=? AND document_id=? AND generation=?`).run(
      result.success ? 'ready' : blocked ? 'blocked' : 'pending', result.success ? 0 : attempts,
      result.success ? 0 : Date.now() + delay, result.success ? null : (result.error || 'Drive nu a confirmat PDF-ul.').slice(0,400),
      result.success ? Date.now() : null, kind,id,job.generation,
    );
  if (!changed.changes) return { success: false, error: 'Documentul s-a modificat; versiunea nouă rămâne în așteptare.', retryable: true };
  return result;
}
