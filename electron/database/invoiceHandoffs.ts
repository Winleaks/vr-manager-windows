import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { isIssuerReady, issuerSnapshot, type BillingIssuerRow } from './billingIssuers.ts';
import type { ProtectedInvoice, ProtectedRegistryVault } from '../protectedRegistry/types.ts';

/** Opaque operation identity only. Source IDs/references and history stay encrypted. */
export function installInvoiceHandoffs(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS invoice_handoffs (
    operation_id TEXT PRIMARY KEY, invoice_id INTEGER NOT NULL UNIQUE REFERENCES invoices(id),
    payload_hash TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('prepared','ready')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS billing_merged_revisions (
      company_id INTEGER PRIMARY KEY, vault_revision INTEGER NOT NULL, normal_revision INTEGER NOT NULL, revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invoice_handoff_payments (
      payment_id INTEGER PRIMARY KEY REFERENCES payments(id), immutable INTEGER NOT NULL DEFAULT 1);
  `);
}
const cents = (n: number) => {
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(Math.round(n * 100))) throw Error('Valoare financiară invalidă.');
  return Math.round(n * 100);
};
function payload(vault: ProtectedRegistryVault, source: ProtectedInvoice) {
  const transfer = source.transfer;
  if (!transfer) throw Error('Transfer nepregătit.');
  const payments = transfer.paymentIds.map(id => {
    const payment = vault.payments.find(row => row.id === id);
    if (!payment) throw Error('Încasarea originală nu mai există.');
    return { amount: payment.amount, date: payment.paymentDate, method: payment.method, old: true };
  });
  payments.push({ amount: transfer.request.amount, date: transfer.request.paymentDate, method: 'card', old: false });
  return { companyId: source.companyId, storeId: source.storeId, storeExternalId: source.storeExternalId, issuerCode: source.issuerCode,
    invoiceDate: transfer.invoiceDate, total: source.totalAmount, items: source.items.map(item => ({ name: item.productName, nameRo: item.productNameRo, unit: item.unit,
      quantity: item.quantity, price: item.unitPrice, total: item.totalPrice, externalId: item.externalProductId, productOrder: item.productOrder })),
    payments, cardReference: transfer.request.cardReference, ...(transfer.request.bankName === undefined ? {} : { bankName: transfer.request.bankName }) };
}
export function prepareInvoiceHandoff(db: Database.Database, vault: ProtectedRegistryVault, source: ProtectedInvoice) {
  const data = payload(vault, source);
  const hash = createHash('sha256').update(JSON.stringify([source.id, data])).digest('hex');
  return db.transaction(() => {
    const prior = db.prepare('SELECT h.*,i.invoice_number FROM invoice_handoffs h JOIN invoices i ON i.id=h.invoice_id WHERE operation_id=?').get(source.transfer!.operationId) as {invoice_id:number;invoice_number:string;payload_hash:string}|undefined;
    if (prior) {
      if (prior.payload_hash !== hash) throw Error('Datele transferului diferă de operațiunea salvată.');
      return { invoiceId: prior.invoice_id, invoiceNumber: prior.invoice_number };
    }
    if (source.transfer!.state === 'committed') throw Error('Jurnalul local al transferului lipsește. Restaurează copia Writer corespunzătoare; nu reemite factura.');
    const store = db.prepare('SELECT s.company_id,s.supabase_store_id,c.client_id,c.supabase_company_id FROM stores s JOIN companies c ON c.id=s.company_id WHERE s.id=? AND s.is_active=1 AND c.is_active=1').get(data.storeId) as {company_id:number;supabase_store_id:string|null;client_id:number;supabase_company_id:string|null}|undefined;
    if (!store || store.company_id !== data.companyId || (data.storeExternalId && store.supabase_store_id !== data.storeExternalId)) throw Error('Asocierea magazinului s-a schimbat.');
    if ((store.supabase_company_id ? `vrbaker:${store.supabase_company_id}` : `local:${store.company_id}`) !== source.companyKey) throw Error('Asocierea companiei s-a schimbat.');
    const issuer = db.prepare('SELECT * FROM billing_issuers WHERE code=?').get(data.issuerCode) as BillingIssuerRow|undefined;
    if (!issuer || !isIssuerReady(issuer)) throw Error('Emitentul original nu este configurat complet.');
    if (!data.items.length || data.items.reduce((sum, item) => sum + cents(item.total), 0) !== cents(data.total)) throw Error('Totalul pozițiilor nu corespunde facturii.');
    for (const item of data.items) if (!Number.isFinite(item.quantity) || item.quantity <= 0 || cents(item.quantity * item.price) !== cents(item.total)) throw Error('O poziție a facturii necesită verificare.');
    if (data.payments.reduce((sum, row) => sum + cents(row.amount), 0) > cents(data.total)) throw Error('Încasările depășesc factura.');
    const number = `${issuer.invoice_series}-${issuer.next_invoice_number}`;
    // Inert until the encrypted source commit is confirmed. No PDF job yet.
    const invoiceId = Number(db.prepare("INSERT INTO invoices(store_id,invoice_number,invoice_date,total_amount,paid_amount,status) VALUES(?,?,?,?,0,'cancelled')").run(data.storeId, number, data.invoiceDate, data.total).lastInsertRowid);
    db.prepare('INSERT INTO invoice_identities(invoice_id,issuer_id,series,sequence_number,reference,issuer_snapshot_json) VALUES(?,?,?,?,?,?)')
      .run(invoiceId, issuer.id, issuer.invoice_series, issuer.next_invoice_number, number, JSON.stringify(issuerSnapshot(issuer)));
    for (const item of data.items) db.prepare(`INSERT INTO invoice_items(invoice_id,product_name,product_name_ro,unit,quantity,unit_price,total_price,external_product_id,product_order,finished_product_id)
      VALUES(?,?,?,?,?,?,?,?,?,(SELECT id FROM finished_products WHERE external_product_id=? LIMIT 1))`).run(invoiceId,item.name,item.nameRo,item.unit,item.quantity,item.price,item.total,item.externalId,item.productOrder,item.externalId);
    if (db.prepare('UPDATE billing_issuers SET next_invoice_number=next_invoice_number+1 WHERE id=? AND next_invoice_number=?').run(issuer.id,issuer.next_invoice_number).changes !== 1) throw Error('Numerotarea s-a modificat concurent.');
    db.prepare("INSERT INTO invoice_handoffs(operation_id,invoice_id,payload_hash,state) VALUES(?,?,?,'prepared')").run(source.transfer!.operationId,invoiceId,hash);
    return { invoiceId, invoiceNumber: number };
  })();
}
export function activateInvoiceHandoff(db: Database.Database, vault: ProtectedRegistryVault, source: ProtectedInvoice) {
  if (source.transfer?.state !== 'committed' || !source.transfer.target) throw Error('Sursa nu a confirmat transferul.');
  const target = prepareInvoiceHandoff(db,vault,source);
  if (JSON.stringify(target) !== JSON.stringify(source.transfer.target)) throw Error('Destinația transferului nu corespunde.');
  const data = payload(vault,source);
  return db.transaction(() => {
    const journal = db.prepare('SELECT state FROM invoice_handoffs WHERE operation_id=?').get(source.transfer!.operationId) as {state:string};
    if (journal.state === 'ready') return target;
    const identity = db.prepare('SELECT issuer_id FROM invoice_identities WHERE invoice_id=?').get(target.invoiceId) as {issuer_id:number};
    const company = db.prepare('SELECT client_id FROM companies WHERE id=?').get(data.companyId) as {client_id:number};
    for (const row of data.payments) {
      const id = Number(db.prepare('INSERT INTO payments(client_id,company_id,invoice_id,issuer_id,amount,payment_date,method,notes,bank_name) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(company.client_id,data.companyId,target.invoiceId,identity.issuer_id,row.amount,row.date,row.method,row.old ? null : data.cardReference,row.old ? null : data.bankName ?? null).lastInsertRowid);
      // Previously reconciled cash allocations must not be edited as new cash.
      if (row.old) db.prepare('INSERT INTO invoice_handoff_payments(payment_id) VALUES(?)').run(id);
    }
    const paid = data.payments.reduce((sum,row)=>sum+cents(row.amount),0);
    db.prepare("UPDATE invoice_handoffs SET state='ready' WHERE operation_id=?").run(source.transfer!.operationId);
    db.prepare('UPDATE invoices SET paid_amount=?,status=? WHERE id=?').run(paid/100,paid===cents(data.total)?'paid':'partial',target.invoiceId);
    return target;
  })();
}
