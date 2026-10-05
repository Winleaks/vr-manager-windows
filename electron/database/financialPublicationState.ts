import type Database from 'better-sqlite3';
import { retiredLegacyCompanyIds } from './legacyEntityRepair.ts';
import { normalBillingReadDatabase } from './normalBillingVisibility.ts';
export function pendingFinancialCompanyCount(db: Database.Database) {
  const retired=retiredLegacyCompanyIds(db);
  return (normalBillingReadDatabase(db).prepare(`SELECT q.company_id FROM billing_publication_queue q JOIN companies c ON c.id=q.company_id
    WHERE q.revision>q.published_revision AND c.vrbaker_missing=0`).all() as {company_id:number}[]).filter(r=>!retired.has(r.company_id)).length;
}
