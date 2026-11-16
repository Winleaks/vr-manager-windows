import type Database from 'better-sqlite3';
import { retiredLegacyCompanyIds } from './legacyEntityRepair.ts';
import { normalBillingReadDatabase } from './normalBillingVisibility.ts';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type PublicationState = 'pending' | 'temporary_error' | 'association_required';
export function publicationMetadata(db: Database.Database, id: number): {blockedRevision?:number; lastConfirmedAt?:number; rateLimitUntil?:number; reason?:string} {
  const row=db.prepare('SELECT value FROM app_settings WHERE key=?').get(`billing_publication_state:${id}`) as {value:string}|undefined;
  try{return row?JSON.parse(row.value):{};}catch{return {};}
}
export function savePublicationMetadata(db: Database.Database,id:number,value:ReturnType<typeof publicationMetadata>) {
  db.prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(`billing_publication_state:${id}`,JSON.stringify(value));
}
export function financialPublicationQueue(db: Database.Database, now=Date.now()) {
  const visible=normalBillingReadDatabase(db), retired=retiredLegacyCompanyIds(db);
  const exists=(table:string,condition:string,id:number)=>!!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table)&&!!db.prepare(`SELECT 1 FROM ${table} WHERE ${condition} LIMIT 1`).get(id);
  const rows=visible.prepare(`SELECT q.*,c.name,c.supabase_company_id FROM billing_publication_queue q JOIN companies c ON c.id=q.company_id WHERE q.revision>q.published_revision AND c.vrbaker_missing=0 ORDER BY q.company_id`).all() as Array<{company_id:number;name:string;supabase_company_id:string;revision:number;published_revision:number;retry_at:number;attempts:number;last_error:string|null}>;
  return rows.filter(row=>!retired.has(row.company_id)).flatMap(row=>{
    const id=row.company_id;
    if(row.supabase_company_id==='vrbaker-unassigned-company' && row.published_revision===0 &&
      !exists('invoices','store_id IN (SELECT id FROM stores WHERE company_id=?)',id)&&!exists('payments','company_id=?',id)&&
      !exists('credit_notes','company_id=?',id)&&!exists('company_credit_entries','company_id=?',id)&&
      !exists('company_issuer_credits','company_id=? AND balance<>0',id)&&!exists('companies','id=? AND credit_balance<>0',id)&&
      !exists('billing_publication_deleted','company_id=?',id)&&!exists('billing_publication_delivery','company_id=?',id)) return [];
    const stores=visible.prepare(`SELECT DISTINCT s.id,s.name,s.supabase_store_id FROM stores s JOIN invoices i ON i.store_id=s.id WHERE s.company_id=?`).all(id) as {id:number;name:string;supabase_store_id:string}[];
    let reason: string|null=null;
    if(!uuid.test(row.supabase_company_id||'')) reason='Compania nu are o asociere VR Baker validă.';
    else if((db.prepare('SELECT COUNT(*) n FROM companies WHERE supabase_company_id=? COLLATE NOCASE').get(row.supabase_company_id) as {n:number}).n!==1) reason='Asociere de companie duplicată; corectează asocierea.';
    else if(stores.some(s=>!uuid.test(s.supabase_store_id||''))) reason='O factură are un magazin fără asociere VR Baker validă.';
    const meta=publicationMetadata(db,id);
    if(!reason&&meta.blockedRevision===row.revision) reason=meta.reason||'Asocierea sau configurația necesită corectare.';
    const state:PublicationState=reason?'association_required':row.last_error?'temporary_error':'pending';
    return [{...row,state,reason:reason||row.last_error,stores:reason?stores.map(s=>({id:s.id,name:s.name})):[],lastConfirmedAt:meta.lastConfirmedAt??null,nextAttemptAt:state==='association_required'?null:Math.max(row.retry_at,meta.rateLimitUntil||0,now),rateLimitUntil:meta.rateLimitUntil||0}];
  });
}
export function pendingFinancialCompanyCount(db: Database.Database) {return financialPublicationQueue(db).length;}
export function publicationRetryDelay(attempts:number,retryAfterMs=0) {
  return Math.max([2000,5000,15000,30000,60000][Math.min(Math.max(0,attempts),4)], Number.isFinite(retryAfterMs)?retryAfterMs:0);
}

export function lastFinancialConfirmation(db: Database.Database) {
  const rows=normalBillingReadDatabase(db).prepare('SELECT id FROM companies').all() as {id:number}[];
  return rows.reduce<number|null>((latest,row)=>{const time=publicationMetadata(db,row.id).lastConfirmedAt;return time&&(!latest||time>latest)?time:latest;},null);
}
