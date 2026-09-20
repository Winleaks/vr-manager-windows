import type Database from 'better-sqlite3';

// Explicitly approved replication metadata only; never contains vault documents,
// assignment keys, names, balances or the protected register's encryption key.
export function installNormalBillingVisibility(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS normal_billing_visibility (
    company_id INTEGER PRIMARY KEY REFERENCES companies(id), hidden INTEGER NOT NULL CHECK(hidden IN (0,1)));
    CREATE TABLE IF NOT EXISTS normal_billing_visibility_state (
      id INTEGER PRIMARY KEY CHECK(id=1), ready INTEGER NOT NULL CHECK(ready IN (0,1)));
    INSERT OR IGNORE INTO normal_billing_visibility_state(id,ready) VALUES(1,0);`);
}

export function normalBillingVisibilityReady(db: Database.Database): boolean {
  return (db.prepare('SELECT ready FROM normal_billing_visibility_state WHERE id=1').get() as { ready: number } | undefined)?.ready === 1;
}

export function invalidateNormalBillingVisibility(db: Database.Database) {
  db.prepare('UPDATE normal_billing_visibility_state SET ready=0 WHERE id=1').run();
}

export function replaceNormalBillingVisibility(db: Database.Database, hiddenIds: number[]) {
  if (hiddenIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw Error('Companie invalidă pentru vizibilitatea facturării.');
  db.transaction(() => {
    db.prepare('DELETE FROM normal_billing_visibility').run();
    const insert = db.prepare('INSERT INTO normal_billing_visibility(company_id,hidden) VALUES(?,1)');
    for (const id of new Set(hiddenIds)) insert.run(id);
    db.prepare('UPDATE normal_billing_visibility_state SET ready=1 WHERE id=1').run();
  })();
}

export function assertNormalBillingVisibilityReady(db: Database.Database) {
  if (!normalBillingVisibilityReady(db)) throw Error('Vizibilitatea facturării nu este încă verificată. Pe Writer verifică legătura cu Drive; pe Viewer sincronizează baza de date actualizată de Writer.');
}

// A read-only projection: every nested query and aggregate sees the same scope.
// No TEMP views, connection mutation or historical row updates. Internal writes
// and protected assignment management keep the authoritative raw connection.
const scope = `companies AS (SELECT c.* FROM main.companies c WHERE NOT EXISTS
  (SELECT 1 FROM main.normal_billing_visibility v WHERE v.company_id=c.id AND v.hidden=1)),
  clients AS (SELECT cl.* FROM main.clients cl WHERE NOT EXISTS (SELECT 1 FROM main.companies c WHERE c.client_id=cl.id)
    OR EXISTS (SELECT 1 FROM companies c WHERE c.client_id=cl.id)),
  stores AS (SELECT * FROM main.stores WHERE company_id IN (SELECT id FROM companies)),
  invoices AS (SELECT * FROM main.invoices WHERE store_id IN (SELECT id FROM stores)),
  invoice_items AS (SELECT * FROM main.invoice_items WHERE invoice_id IN (SELECT id FROM invoices)),
  invoice_identities AS (SELECT * FROM main.invoice_identities WHERE invoice_id IN (SELECT id FROM invoices)),
  invoice_drive_identity AS (SELECT * FROM main.invoice_drive_identity WHERE invoice_id IN (SELECT id FROM invoices)),
  invoice_replacements AS (SELECT * FROM main.invoice_replacements WHERE cancelled_invoice_id IN (SELECT id FROM invoices) AND replacement_invoice_id IN (SELECT id FROM invoices)),
  payments AS (SELECT * FROM main.payments WHERE company_id IN (SELECT id FROM companies)),
  credit_notes AS (SELECT * FROM main.credit_notes WHERE company_id IN (SELECT id FROM companies)),
  credit_note_items AS (SELECT * FROM main.credit_note_items WHERE credit_note_id IN (SELECT id FROM credit_notes)),
  credit_note_invoice_links AS (SELECT * FROM main.credit_note_invoice_links WHERE credit_note_id IN (SELECT id FROM credit_notes) AND invoice_id IN (SELECT id FROM invoices)),
  company_issuer_credits AS (SELECT * FROM main.company_issuer_credits WHERE company_id IN (SELECT id FROM companies)),
  company_credit_entries AS (SELECT * FROM main.company_credit_entries WHERE company_id IN (SELECT id FROM companies)),
  invoice_credit_applications AS (SELECT * FROM main.invoice_credit_applications WHERE invoice_id IN (SELECT id FROM invoices)),
  document_sync_queue AS (SELECT * FROM main.document_sync_queue WHERE
    (kind='invoice' AND document_id IN (SELECT id FROM invoices)) OR
    (kind='credit_note' AND document_id IN (SELECT id FROM credit_notes)))`;

export function normalBillingReadDatabase(db: Database.Database): Database.Database {
  return { prepare(sql: string) {
    assertNormalBillingVisibilityReady(db);
    if (!/^\s*SELECT\b/i.test(sql)) throw Error('Proiecția facturării acceptă numai citiri SELECT.');
    const statement = db.prepare(`WITH ${scope} ${sql}`);
    if (!statement.readonly) throw Error('Scriere interzisă în proiecția facturării.');
    return statement;
  } } as Database.Database;
}
