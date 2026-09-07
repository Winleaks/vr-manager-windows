import type Database from 'better-sqlite3';
import { applyLegacyEntityRepair, planLegacyEntityRepair, type EntitySnapshot, type LegacyRepairPlan } from '../database/legacyEntityRepair.ts';

export async function synchronizeEntitiesWithRepair<T>(deps: {
  connection: Database.Database;
  assertCurrent: () => void;
  fetchSnapshot: () => Promise<EntitySnapshot>;
  confirm: (plan: LegacyRepairPlan) => Promise<boolean>;
  backup: () => Promise<string>;
  synchronize: (snapshot: EntitySnapshot) => T;
}) {
  deps.assertCurrent();
  let snapshot = await deps.fetchSnapshot();
  deps.assertCurrent();
  const plan = planLegacyEntityRepair(deps.connection,snapshot);
  let backupPath = '';
  if (plan.moves.length) {
    if (!await deps.confirm(plan)) throw new Error('Sincronizarea a fost anulată. Istoricul local nu a fost modificat.');
    deps.assertCurrent();
    // Never apply a plan backed up before approval or restore a supplied old DB.
    backupPath = await deps.backup();
    deps.assertCurrent();
    snapshot = await deps.fetchSnapshot();
    deps.assertCurrent();
  }
  return deps.connection.transaction(()=>{
    const repair = plan.moves.length ? applyLegacyEntityRepair(deps.connection,snapshot,plan,backupPath) : {repairedStores:0,repairedInvoices:0};
    const result = deps.synchronize(snapshot);
    return {...result,...repair};
  })();
}
