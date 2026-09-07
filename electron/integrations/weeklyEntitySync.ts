import { EntityAssociationConflict } from '../database/entitySync.ts';
import type { VrBakerOrder, VrBakerCompany, VrBakerStore } from './vrBakerApiClient.ts';

// The weekly export is partial: it can detect a conflict, but can never authorize
// moving history or infer deletions. Only the full, confirmed repair can do that.
export async function synchronizeWeeklySnapshot<T extends {orders: VrBakerOrder[]}>(deps: {
  fetchSnapshot: () => Promise<T>;
  synchronize: (companies: VrBakerCompany[], stores: VrBakerStore[]) => unknown;
  assertCurrent: () => void;
  repair: () => Promise<unknown>;
  allowRepair: boolean;
}) {
  const load = async () => {
    deps.assertCurrent();
    const snapshot = await deps.fetchSnapshot();
    deps.assertCurrent();
    const stores = [...new Map(snapshot.orders.map(order=>[order.store.id,order.store])).values()];
    const companies = [...new Map(stores.flatMap(store=>store.company ? [[store.company.id,store.company] as const] : [])).values()];
    deps.synchronize(companies,stores);
    return snapshot;
  };
  try { return await load(); }
  catch (error) {
    if (!deps.allowRepair || !(error instanceof EntityAssociationConflict)) throw error;
    deps.assertCurrent();
    await deps.repair();
    // One retry only, and a fresh weekly export. Cancellation, financial conflicts
    // and unresolved associations remain explicit errors; never issue an invoice.
    return load();
  }
}
