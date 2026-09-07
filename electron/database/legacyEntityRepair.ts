import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { assertEntitySnapshotIdentifiers, externalEntityId } from './entitySync.ts';
import type { VrBakerCompany, VrBakerStore, VrBakerStoreMerge } from '../integrations/vrBakerApiClient.ts';

export interface LegacyRepairMove {
  storeId: number; storeExternalId: string; storeName: string;
  fromCompanyId: number; toCompanyId: number; toCompanyExternalId: string; toCompanyName: string;
  invoices: { id: number; invoice_number: string }[];
  toStoreId?: number; toStoreExternalId?: string; toStoreName?: string;
}
export interface LegacyRepairPlan { fingerprint: string; moves: LegacyRepairMove[] }
export interface EntitySnapshot { companies: VrBakerCompany[]; stores: VrBakerStore[]; merges?: VrBakerStoreMerge[] }

function companyHasFinancialHistory(db: Database.Database, companyId: number) {
  return Boolean(db.prepare(`SELECT 1 WHERE
    EXISTS(SELECT 1 FROM invoices i JOIN stores s ON s.id=i.store_id WHERE s.company_id=?) OR
    EXISTS(SELECT 1 FROM payments WHERE company_id=?) OR
    EXISTS(SELECT 1 FROM credit_notes WHERE company_id=?) OR
    EXISTS(SELECT 1 FROM company_credit_entries WHERE company_id=?) OR
    EXISTS(SELECT 1 FROM company_issuer_credits WHERE company_id=? AND balance<>0) OR
    EXISTS(SELECT 1 FROM companies WHERE id=? AND credit_balance<>0)
  `).get(companyId, companyId, companyId, companyId, companyId, companyId));
}

// Old virtual_<store UUID> shells are not legal companies. Keep their rows and
// history, but do not repeatedly publish an empty shell already superseded by
// the same exact store identity under a real, uniquely mapped company.
export function retiredLegacyCompanyIds(db: Database.Database): Set<number> {
  const result = new Set<number>();
  const companies = db.prepare("SELECT id,supabase_company_id FROM companies WHERE supabase_company_id LIKE 'virtual_%'").all() as {id:number;supabase_company_id:string}[];
  for (const company of companies) {
    const externalStoreId = company.supabase_company_id.slice('virtual_'.length);
    if (!externalEntityId.test(externalStoreId) || companyHasFinancialHistory(db, company.id)) continue;
    const mapped = db.prepare(`SELECT c.id,c.supabase_company_id,c.vrbaker_missing FROM stores s JOIN companies c ON c.id=s.company_id
      WHERE s.supabase_store_id=? COLLATE NOCASE AND s.vrbaker_missing=0`).all(externalStoreId) as {id:number;supabase_company_id:string;vrbaker_missing:number}[];
    if (mapped.length !== 1 || mapped[0].id === company.id || mapped[0].vrbaker_missing || !externalEntityId.test(mapped[0].supabase_company_id || '')) continue;
    if ((db.prepare('SELECT count(*) n FROM companies WHERE supabase_company_id=? COLLATE NOCASE').get(mapped[0].supabase_company_id) as {n:number}).n !== 1) continue;
    result.add(company.id);
  }
  return result;
}

export function planLegacyEntityRepair(db: Database.Database, snapshot: EntitySnapshot): LegacyRepairPlan {
  assertEntitySnapshotIdentifiers(db, snapshot.companies, snapshot.stores, true);
  const moves: LegacyRepairMove[] = [];
  const evidence: unknown[] = [];
  const aliases = new Map<string, VrBakerStore>();
  for (const merge of snapshot.merges ?? []) {
    const remote = snapshot.stores.find(s=>s.id.toLowerCase()===merge.storeId.toLowerCase());
    if (!externalEntityId.test(merge.oldStoreId) || !externalEntityId.test(merge.storeId) || !remote?.company ||
      aliases.has(merge.oldStoreId.toLowerCase()) || snapshot.stores.some(s=>s.id.toLowerCase()===merge.oldStoreId.toLowerCase())) {
      throw new Error('Lista unirilor de magazine nu este validă.');
    }
    aliases.set(merge.oldStoreId.toLowerCase(),remote);
  }
  const candidates = [...snapshot.stores.map(remote=>({remote,sourceId:remote.id,merged:false})),
    ...[...aliases].map(([sourceId,remote])=>({remote,sourceId,merged:true}))].sort((a,b)=>a.sourceId.localeCompare(b.sourceId));
  for (const {remote,sourceId,merged} of candidates) {
    // No fallback by name/address. Unassociated stores, including deliberately
    // unresolved lookalikes, are untouched. Never change a real company owner.
    if (!remote.company) continue;
    const local = db.prepare(`SELECT s.*,c.supabase_company_id FROM stores s JOIN companies c ON c.id=s.company_id
      WHERE s.supabase_store_id=? COLLATE NOCASE`).get(sourceId) as any;
    if (!local || local.supabase_company_id !== 'vrbaker-unassigned-company') continue;
    const mergeTarget = merged ? db.prepare('SELECT * FROM stores WHERE supabase_store_id=? COLLATE NOCASE').get(remote.id) as any : null;
    if (merged && !mergeTarget) throw new Error('Magazinul păstrat trebuie sincronizat înainte de unire.');
    const target = db.prepare('SELECT * FROM companies WHERE supabase_company_id=? COLLATE NOCASE AND vrbaker_missing=0').get(remote.company.id) as any;
    if (!target) continue; // First sync creates new legal company records; never guess a local target.
    const sourceCompany = db.prepare('SELECT * FROM companies WHERE id=?').get(local.company_id) as any;
    if (merged && mergeTarget.company_id !== target.id) throw new Error('Compania magazinului păstrat nu corespunde.');
    const invoices = db.prepare('SELECT * FROM invoices WHERE store_id=? ORDER BY id').all(local.id) as any[];
    const batches = merged ? db.prepare('SELECT * FROM invoice_import_batches WHERE store_external_id=? COLLATE NOCASE ORDER BY id').all(sourceId) as any[] : [];
    if (merged && !invoices.length && !batches.length) continue;
    for (const batch of batches) {
      if (!invoices.some(i=>i.id===batch.invoice_id) || db.prepare(`SELECT 1 FROM invoice_import_batches WHERE store_external_id=? COLLATE NOCASE
        AND source=? AND period_start=? AND period_end=?`).get(remote.id,batch.source,batch.period_start,batch.period_end)) {
        throw new Error('Perioada magazinului unit are deja o factură sau o legătură diferită. Istoricul a fost păstrat.');
      }
    }
    const blocked = db.prepare(`SELECT 1 WHERE
      EXISTS(SELECT 1 FROM payments WHERE company_id=? OR invoice_id IN(SELECT id FROM invoices WHERE store_id=?)) OR
      EXISTS(SELECT 1 FROM credit_notes WHERE company_id=?) OR
      EXISTS(SELECT 1 FROM company_credit_entries WHERE company_id=?) OR
      EXISTS(SELECT 1 FROM company_issuer_credits WHERE company_id=? AND balance<>0) OR
      EXISTS(SELECT 1 FROM invoice_credit_applications WHERE invoice_id IN(SELECT id FROM invoices WHERE store_id=?)) OR
      EXISTS(SELECT 1 FROM credit_note_invoice_links WHERE invoice_id IN(SELECT id FROM invoices WHERE store_id=?)) OR
      EXISTS(SELECT 1 FROM billing_publication_queue WHERE company_id=? AND published_revision>0)
    `).get(local.company_id,local.id,local.company_id,local.company_id,local.company_id,local.id,local.id,local.company_id);
    if (blocked || sourceCompany.credit_balance || invoices.some(i => i.paid_amount !== 0 || i.status !== 'unpaid')) {
      throw new Error(`Magazinul „${local.name}” necesită verificarea plăților/creditelor înainte de repararea asocierii. Nu s-au mutat facturi.`);
    }
    moves.push({storeId:local.id,storeExternalId:sourceId,storeName:local.name,fromCompanyId:local.company_id,
      toCompanyId:target.id,toCompanyExternalId:remote.company.id,toCompanyName:remote.company.name,
      ...(merged ? {toStoreId:mergeTarget.id,toStoreExternalId:remote.id,toStoreName:remote.name} : {}),
      invoices:invoices.map(i=>({id:i.id,invoice_number:i.invoice_number}))});
    evidence.push({local,sourceCompany,target,invoices,remoteCompany:remote.company,mergeTarget,batches});
  }
  return { moves, fingerprint:createHash('sha256').update(JSON.stringify(evidence)).digest('hex') };
}

// Caller must obtain explicit approval, create a verified snapshot, re-fetch the
// full remote export, and hold its transaction through the subsequent entity sync.
export function applyLegacyEntityRepair(db: Database.Database, snapshot: EntitySnapshot, approved: LegacyRepairPlan, backupPath: string) {
  if (!backupPath || !db.inTransaction) throw new Error('Repararea necesită backup verificat și tranzacție.');
  const fresh = planLegacyEntityRepair(db,snapshot);
  if (fresh.fingerprint !== approved.fingerprint) throw new Error('Datele s-au schimbat după confirmare. Reia sincronizarea și verifică noua listă.');
  for (const move of fresh.moves) {
    if (move.toStoreId) {
      db.prepare('UPDATE invoices SET store_id=?,pdf_path=NULL WHERE store_id=?').run(move.toStoreId,move.storeId);
      db.prepare('UPDATE invoice_import_batches SET store_external_id=? WHERE store_external_id=? COLLATE NOCASE').run(move.toStoreExternalId,move.storeExternalId);
      // Keep the old row as a tombstone, never delete local business history.
      db.prepare('UPDATE stores SET vrbaker_missing=1 WHERE id=?').run(move.storeId);
    } else {
      const changed = db.prepare('UPDATE stores SET company_id=? WHERE id=? AND company_id=? AND supabase_store_id=? COLLATE NOCASE')
        .run(move.toCompanyId,move.storeId,move.fromCompanyId,move.storeExternalId);
      if (changed.changes !== 1) throw new Error('Asocierea magazinului s-a schimbat.');
      // New customer identity requires regenerated PDFs, not reuse of old bytes.
      // Physical files remain intact. Invoice numbers, items, amounts and issuer
      // snapshots are not changed; pending async uploads fail their revision guard.
      db.prepare('UPDATE invoices SET document_revision=document_revision+1,drive_file_id=NULL,pdf_path=NULL WHERE store_id=?').run(move.storeId);
    }
    db.prepare("INSERT INTO billing_audit_events(event_type,company_id,details) VALUES('legacy_store_company_repaired',?,?)")
      .run(move.toCompanyId,JSON.stringify({...move,backupPath}));
  }
  return {repairedStores:fresh.moves.length,repairedInvoices:fresh.moves.reduce((n,m)=>n+m.invoices.length,0)};
}
