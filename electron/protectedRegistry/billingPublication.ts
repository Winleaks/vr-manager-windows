import type Database from 'better-sqlite3';
import { invoicePaymentTerms, type InvoicePaymentTerms } from '../../src/shared/invoicePaymentTerms.ts';
import { moneyInPence } from '../database/billingPublication.ts';
import type { ProtectedInvoice, ProtectedRegistryVault } from './types.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const MAX_PLATFORM_REVISION = 9_007_199_254_740_991;
const PROTECTED_ID_DIGITS = 14;
const CLIENT_DOCUMENT_REVISION_OFFSET = 2000;

export interface ProtectedBillingDelivery {
  source_id: string;
  company_id: string;
  revision: number;
  credit: number;
  invoices: Array<InvoicePaymentTerms & {
    id: string;
    store_id: string;
    number: string;
    date: string;
    total: number;
    paid: number;
    credited: number;
    applied_credit: number;
    outstanding: number;
    cancelled: boolean;
    drive_file_id: string | null;
  }>;
  deleted: string[];
}

export interface BillingPublicationClient {
  request<T = unknown>(action: string, payload?: unknown, idempotencyKey?: string): Promise<T>;
}

function externalCompanyId(companyKey: string) {
  const prefix = 'vrbaker:';
  if (!companyKey.startsWith(prefix)) return null;
  const id = companyKey.slice(prefix.length);
  return UUID.test(id) ? id.toLowerCase() : null;
}

export function protectedBillingInvoiceId(invoice: Pick<ProtectedInvoice, 'series' | 'sequenceNumber'>) {
  if (!Number.isSafeInteger(invoice.sequenceNumber) || invoice.sequenceNumber < 1) {
    throw new Error('Numărul facturii din registrul separat este invalid.');
  }
  const sequence = String(invoice.sequenceNumber);
  if (sequence.length > PROTECTED_ID_DIGITS) throw new Error('Numărul facturii depășește limita de publicare.');
  const prefix = invoice.series === 'TGBL' ? '8' : invoice.series === 'VRL' ? '9' : null;
  if (!prefix) throw new Error('Seria facturii din registrul separat este invalidă.');
  return `${prefix}${sequence.padStart(PROTECTED_ID_DIGITS, '0')}`;
}

export function protectedBillingRevision(vault: Pick<ProtectedRegistryVault, 'revision' | 'updatedAt'>) {
  const updatedAt = Date.parse(vault.updatedAt);
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 1 || !Number.isSafeInteger(vault.revision) || vault.revision < 0) {
    throw new Error('Versiunea registrului separat este invalidă.');
  }
  // Wall-clock milliseconds create a namespace far above legacy SQLite queue
  // revisions. The extra offset keeps the client-document snapshot newer than
  // the metadata-only snapshot published by v0.1.119 for the same vault.
  const revision = updatedAt * 1000 + CLIENT_DOCUMENT_REVISION_OFFSET + (vault.revision % 1000);
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > MAX_PLATFORM_REVISION) {
    throw new Error('Versiunea registrului separat depășește limita platformei.');
  }
  return revision;
}

function appliedCredit(vault: ProtectedRegistryVault, invoiceId: string) {
  return vault.creditApplications
    .filter((entry) => entry.invoiceId === invoiceId && !entry.reversedAt && !entry.testEntry)
    .reduce((total, entry) => total + entry.amount, 0);
}

function normalInvoiceTombstones(db: Database.Database, companyId: number) {
  const ids = new Set<string>();
  for (const row of db.prepare(`
    SELECT CAST(i.id AS TEXT) AS id
    FROM invoices i JOIN stores s ON s.id=i.store_id
    WHERE s.company_id=?
  `).all(companyId) as Array<{ id: string }>) ids.add(row.id);
  for (const row of db.prepare('SELECT invoice_id AS id FROM billing_publication_deleted WHERE company_id=?').all(companyId) as Array<{ id: string }>) ids.add(row.id);
  return [...ids].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

export function prepareProtectedBillingDeliveries(
  db: Database.Database,
  vault: ProtectedRegistryVault,
  documentFileIds: ReadonlyMap<string, string> = new Map(),
): ProtectedBillingDelivery[] {
  if (vault.mode !== 'live') return [];
  const identity = db.prepare('SELECT source_id FROM billing_publication_identity WHERE id=1').get() as { source_id: string } | undefined;
  if (!identity || !UUID.test(identity.source_id)) throw new Error('Identitatea Writer pentru publicare este invalidă.');
  const revision = protectedBillingRevision(vault);
  const deliveries: ProtectedBillingDelivery[] = [];

  for (const assignment of [...vault.assignments].sort((a, b) => a.companyKey.localeCompare(b.companyKey))) {
    const companyExternalId = externalCompanyId(assignment.companyKey);
    if (!companyExternalId) continue; // A local-only company has no client account in VR Baker.
    const companies = db.prepare('SELECT id FROM companies WHERE supabase_company_id=? COLLATE NOCASE').all(companyExternalId) as Array<{ id: number }>;
    if (companies.length !== 1) throw new Error('Compania registrului separat nu are o asociere VR Baker unică.');
    const localCompanyId = companies[0].id;
    const invoices = vault.invoices
      .filter((invoice) => invoice.companyKey === assignment.companyKey && !invoice.testDocument)
      .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.reference.localeCompare(b.reference, 'en', { numeric: true }))
      .map((invoice) => {
        if (!invoice.storeExternalId || !UUID.test(invoice.storeExternalId)) throw new Error('O factură din registrul separat nu are magazin VR Baker valid.');
        const store = db.prepare('SELECT COUNT(*) AS count FROM stores WHERE company_id=? AND supabase_store_id=? COLLATE NOCASE').get(localCompanyId, invoice.storeExternalId) as { count: number };
        if (store.count !== 1) throw new Error('Magazinul unei facturi din registrul separat nu mai este asociat companiei în VR Baker.');
        const total = moneyInPence(invoice.totalAmount);
        const paid = moneyInPence(invoice.paidAmount);
        const credited = moneyInPence(invoice.creditedAmount);
        const applied = moneyInPence(appliedCredit(vault, invoice.id));
        if (paid > total || credited > total || applied > total) throw new Error('Decontarea unei facturi din registrul separat este invalidă.');
        const cancelled = invoice.status === 'cancelled';
        const documentFileId = cancelled ? null : documentFileIds.get(invoice.id) || null;
        if (documentFileId && !DRIVE_FILE_ID.test(documentFileId)) throw new Error('Identitatea PDF-ului pentru portal este invalidă.');
        return {
          id: protectedBillingInvoiceId(invoice),
          store_id: invoice.storeExternalId,
          number: invoice.reference,
          date: invoice.invoiceDate,
          ...invoicePaymentTerms(invoice.invoiceDate,invoice.periodStart,invoice.periodEnd,invoice.sourceOrderIds.length>0),
          total,
          paid,
          credited,
          applied_credit: applied,
          outstanding: cancelled ? 0 : Math.max(0, total - paid - credited - applied),
          cancelled,
          // The portal copy lives in the existing client-download tree. The
          // authoritative PDF under Duplicat remains untouched and private.
          drive_file_id: documentFileId,
        };
      });
    const credit = moneyInPence(vault.creditEntries
      .filter((entry) => entry.companyKey === assignment.companyKey && !entry.testEntry)
      .reduce((total, entry) => total + entry.availableAmount, 0));
    deliveries.push({
      source_id: identity.source_id,
      company_id: companyExternalId,
      revision,
      credit,
      invoices,
      deleted: normalInvoiceTombstones(db, localCompanyId),
    });
  }
  return deliveries;
}

export async function publishProtectedBillingVault(
  db: Database.Database,
  vault: ProtectedRegistryVault,
  client: BillingPublicationClient,
  documentFileIds: ReadonlyMap<string, string> = new Map(),
) {
  const deliveries = prepareProtectedBillingDeliveries(db, vault, documentFileIds);
  if (!deliveries.length) return { published: 0, skipped: true };
  const control = await client.request<{ sync_enabled: boolean; protocol_version?: number }>('billing.status');
  if (!control.sync_enabled) return { published: 0, skipped: true };
  if (control.protocol_version !== 2) throw new Error('Platforma necesită actualizarea protocolului financiar.');
  let published = 0;
  for (const data of deliveries) {
    const parts = Math.max(1, Math.ceil(Math.max(data.invoices.length, data.deleted.length) / 50));
    for (let part = 0; part < parts; part++) {
      await client.request('billing.stage', {
        ...data,
        invoices: data.invoices.slice(part * 50, (part + 1) * 50),
        deleted: data.deleted.slice(part * 50, (part + 1) * 50),
        part,
        parts,
      }, `${data.source_id}:protected:${data.company_id}:${data.revision}:part:${part}`);
    }
    await client.request('billing.commit', {
      source_id: data.source_id,
      company_id: data.company_id,
      revision: data.revision,
    }, `${data.source_id}:protected:${data.company_id}:${data.revision}:commit`);
    published++;
  }
  return { published, skipped: false };
}

export function queueNormalPublicationAfterProtected(db: Database.Database, vault: ProtectedRegistryVault, companyKey: string) {
  const companyExternalId = externalCompanyId(companyKey);
  if (!companyExternalId) return;
  const company = db.prepare('SELECT id FROM companies WHERE supabase_company_id=? COLLATE NOCASE').get(companyExternalId) as { id: number } | undefined;
  if (!company) return;
  const insertDeleted = db.prepare('INSERT OR IGNORE INTO billing_publication_deleted(company_id,invoice_id) VALUES(?,?)');
  for (const invoice of vault.invoices.filter((row) => row.companyKey === companyKey && !row.testDocument)) {
    insertDeleted.run(company.id, protectedBillingInvoiceId(invoice));
  }
  const nextRevision = protectedBillingRevision(vault) + 1;
  db.prepare(`
    UPDATE billing_publication_queue
    SET revision=MAX(revision,?), retry_at=0, last_error=NULL
    WHERE company_id=?
  `).run(nextRevision, company.id);
}
