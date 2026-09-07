import type Database from 'better-sqlite3';
import type { VrBakerCompany, VrBakerStore } from '../integrations/vrBakerApiClient.ts';

export const externalEntityId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function installEntitySyncState(db: Database.Database) {
  for (const table of ['companies', 'stores']) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN vrbaker_missing INTEGER NOT NULL DEFAULT 0 CHECK(vrbaker_missing IN (0,1))`);
  }
  // Platform login/order availability is not the local billing enablement flag.
  db.exec('ALTER TABLE stores ADD COLUMN platform_active INTEGER CHECK(platform_active IN (0,1))');
}

export function assertEntitySyncSafe(db: Database.Database, companies: VrBakerCompany[], stores: VrBakerStore[], complete = true) {
  const ids = new Set(companies.map(row => row.id.toLowerCase()));
  if ((complete && (!companies.length || !stores.length)) || ids.size !== companies.length || new Set(stores.map(row => row.id.toLowerCase())).size !== stores.length ||
      companies.some(row => !externalEntityId.test(row.id)) || stores.some(row => !externalEntityId.test(row.id) || (complete && typeof row.platformActive !== 'boolean') || (row.company && !ids.has(row.company.id.toLowerCase())))) {
    throw new Error('Exportul de entități nu este complet sau conține asocieri invalide. Datele locale au fost păstrate.');
  }
  for (const [table, column] of [['clients','supabase_client_id'], ['companies','supabase_company_id'], ['stores','supabase_store_id']]) {
    const duplicates = db.prepare(`SELECT ${column} FROM ${table} WHERE ${column} IS NOT NULL GROUP BY lower(${column}) HAVING COUNT(*)>1`).all();
    if (duplicates.length) throw new Error('Există ID-uri VR Baker asociate mai multor înregistrări locale. Este necesară verificarea duplicatelor înainte de sincronizare.');
  }
  for (const store of stores) {
    const local = db.prepare(`SELECT c.supabase_company_id AS company_external_id FROM stores s JOIN companies c ON c.id=s.company_id
      WHERE s.supabase_store_id=? COLLATE NOCASE AND EXISTS(SELECT 1 FROM invoices i WHERE i.store_id=s.id)`).get(store.id) as {company_external_id:string|null}|undefined;
    if (local && (local.company_external_id || '').toLowerCase() !== (store.company?.id || 'vrbaker-unassigned-company').toLowerCase()) {
      throw new Error(`Magazinul „${store.name}” are facturi locale și o altă asociere în platformă. Istoricul nu a fost mutat; verifică asocierea înainte de sincronizare.`);
    }
  }
}

// Caller wraps upserts + reconciliation in a single transaction after a counted,
// complete API export. Never infer removal from an ordinary partial list.
export function reconcileEntityPresence(db: Database.Database, companies: VrBakerCompany[], stores: VrBakerStore[]) {
  const companyIds = new Set(companies.map(row => row.id.toLowerCase()));
  const storeIds = new Set(stores.map(row => row.id.toLowerCase()));
  let missingCompanies=0, missingStores=0;
  for (const row of db.prepare('SELECT id,supabase_company_id FROM companies').all() as any[]) {
    if (!externalEntityId.test(row.supabase_company_id || '')) continue;
    const missing = !companyIds.has(row.supabase_company_id.toLowerCase());
    db.prepare('UPDATE companies SET vrbaker_missing=? WHERE id=?').run(Number(missing),row.id);
    if (missing) missingCompanies++;
  }
  for (const row of db.prepare('SELECT id,supabase_store_id FROM stores').all() as any[]) {
    if (!externalEntityId.test(row.supabase_store_id || '')) continue;
    const missing = !storeIds.has(row.supabase_store_id.toLowerCase());
    db.prepare('UPDATE stores SET vrbaker_missing=? WHERE id=?').run(Number(missing),row.id);
    if (missing) missingStores++;
  }
  for (const store of stores) {
    db.prepare('UPDATE stores SET platform_active=? WHERE supabase_store_id=? COLLATE NOCASE').run(Number(store.platformActive),store.id);
  }
  return {missingCompanies,missingStores,inactiveStores:stores.filter(row=>row.platformActive===false).length};
}

export function flagPossibleCompanyDuplicates<T extends {name:string}>(companies: T[]) {
  const key = (name:string) => name.trim().replace(/\s+/g,' ').toLocaleLowerCase('en-GB');
  const counts = new Map<string,number>();
  for (const row of companies) counts.set(key(row.name),(counts.get(key(row.name)) || 0)+1);
  return companies.map(row=>({...row,possible_duplicate:(counts.get(key(row.name)) || 0)>1}));
}
