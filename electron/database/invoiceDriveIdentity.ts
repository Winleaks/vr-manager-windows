import type Database from 'better-sqlite3';

// Transport identity survives document invalidation; it is not a claim that the
// PDF is current. Only invoices.drive_file_id is eligible for publication.
export function installInvoiceDriveIdentity(db: Database.Database) {
  db.exec(`CREATE TABLE invoice_drive_identity (
    invoice_id INTEGER PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE,
    file_id TEXT, company_id INTEGER NOT NULL, store_id INTEGER NOT NULL,
    external_company_id TEXT, cleanup TEXT NOT NULL DEFAULT '[]',
    verified_name TEXT, verified_parent TEXT, verified_checksum TEXT, verified_size INTEGER,
    cleanup_attempts INTEGER NOT NULL DEFAULT 0, cleanup_retry_at INTEGER NOT NULL DEFAULT 0, cleanup_error TEXT
  );
  INSERT INTO invoice_drive_identity(invoice_id,file_id,company_id,store_id,external_company_id)
    SELECT i.id,i.drive_file_id,s.company_id,s.id,c.supabase_company_id
    FROM invoices i JOIN stores s ON s.id=i.store_id JOIN companies c ON c.id=s.company_id
    WHERE i.drive_file_id IS NOT NULL;`);
}

export function invoiceCopyCleanupError(db:Database.Database) {
  return (db.prepare("SELECT cleanup_error FROM invoice_drive_identity WHERE cleanup_error IS NOT NULL LIMIT 1").get() as {cleanup_error:string}|undefined)?.cleanup_error || null;
}
export function retryInvoiceCopyCleanup(db:Database.Database) {
  db.prepare('UPDATE invoice_drive_identity SET cleanup_attempts=0,cleanup_retry_at=0,cleanup_error=NULL WHERE cleanup_error IS NOT NULL').run();
}
