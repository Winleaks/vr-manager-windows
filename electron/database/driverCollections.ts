import type Database from 'better-sqlite3';
import { requireIsoDate, requirePositiveInteger } from './businessValidation.ts';
import type { DriverCollectionsReport } from '../../src/shared/driverCollections.ts';

const londonDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Latest acknowledged values, not the sum of import/correction ledger movements. */
export function driverCollectionsReport(db: Database.Database, startInput: unknown, endInput: unknown, driverInput: unknown): DriverCollectionsReport {
  const startDate = requireIsoDate(startInput, 'De la');
  const endDate = requireIsoDate(endInput, 'Până la');
  const driverId = requirePositiveInteger(driverInput, 'Șoferul');
  if (endDate < startDate) throw Error('Intervalul de date este invalid.');
  if (!db.prepare('SELECT 1 FROM drivers WHERE id=?').get(driverId)) throw Error('Șoferul nu există.');
  const lower = Date.parse(startDate + 'T00:00:00Z') - 86400000;
  const upper = Date.parse(endDate + 'T00:00:00Z') + 86400000;
  type Receipt = { root_id: string; store_id: number | null; store_name: string | null; amount_pence: number; recorded_at_ms: number };
  const rows = db.prepare(`SELECT r.root_id,r.store_id,s.name AS store_name,r.amount_pence,r.recorded_at_ms
    FROM driver_cash_receipts r LEFT JOIN stores s ON s.id=r.store_id
    WHERE r.driver_id=? AND r.recorded_at_ms BETWEEN ? AND ?`).all(driverId, lower, upper) as Receipt[];
  // Explicitly reconciled manual receipts have no second financial receipt row.
  // Use one latest acknowledged revision per root, never also count its cash entry.
  const manual = db.prepare(`SELECT o.root_id,s.id AS store_id,s.name AS store_name,
      json_extract(o.request,'$.amount_pence') AS amount_pence,
      coalesce(json_extract(o.request,'$.collected_at_ms'),json_extract(o.request,'$.recorded_at_ms')) AS recorded_at_ms
    FROM driver_cash_operations o
    JOIN drivers d ON d.supabase_driver_id=json_extract(o.request,'$.driver_id')
    LEFT JOIN stores s ON s.supabase_store_id=json_extract(o.request,'$.store_id')
    WHERE d.id=? AND o.state='PROCESSED' AND json_extract(o.result,'$.disposition')='recorded_manually'
      AND NOT EXISTS(SELECT 1 FROM driver_cash_receipts r WHERE r.root_id=o.root_id)
      AND NOT EXISTS(SELECT 1 FROM driver_cash_operations n WHERE n.root_id=o.root_id AND n.state='PROCESSED'
        AND json_extract(n.request,'$.revision')>json_extract(o.request,'$.revision'))`).all(driverId) as Receipt[];
  // Office receipts already exist in Daily Cash. Read them; never create a
  // financial movement to make a report complete. Linked import movements are
  // excluded, and acknowledged manual allocations consume only their share.
  const office = db.prepare(`SELECT t.id,d.date,round(t.amount*100) AS amount_pence,
      coalesce((SELECT sum(json_extract(o.request,'$.amount_pence'))
        FROM driver_cash_reviews v JOIN driver_cash_operations o USING(operation_id)
        WHERE v.reference=cast(t.id AS TEXT) AND v.decision='manual'
          AND o.state='PROCESSED' AND json_extract(o.result,'$.disposition')='recorded_manually'
          AND NOT EXISTS(SELECT 1 FROM driver_cash_operations n
            WHERE n.root_id=o.root_id AND n.state='PROCESSED'
              AND json_extract(n.request,'$.revision')>json_extract(o.request,'$.revision'))),0) AS allocated_pence
    FROM cash_transactions t JOIN cash_days d ON d.id=t.cash_day_id
    WHERE t.reference_id=? AND t.type='IN' AND t.category='driver_collection'
      AND t.driver_cash_root IS NULL AND d.date BETWEEN ? AND ?`).all(driverId,startDate,endDate) as Array<{id:number;date:string;amount_pence:number;allocated_pence:number}>;
  const grouped = new Map<string, DriverCollectionsReport['stores'][number]>();
  for (const row of [...rows, ...manual]) {
    const date = londonDate.format(row.recorded_at_ms);
    if (date < startDate || date > endDate || row.amount_pence === 0) continue;
    if (!Number.isSafeInteger(row.amount_pence) || row.amount_pence < 0) throw Error('Încasarea necesită verificare.');
    const key = row.store_id === null ? row.root_id : String(row.store_id);
    const store = grouped.get(key) || { storeId: row.store_id, storeName: row.store_name || 'Magazin indisponibil', amountPence: 0, receipts: 0 };
    store.amountPence += row.amount_pence; store.receipts++;
    grouped.set(key, store);
  }
  for (const row of office) {
    const remaining = row.amount_pence - row.allocated_pence;
    if (!Number.isSafeInteger(remaining) || remaining < 0) throw Error('Încasarea manuală necesită reconciliere.');
    if (!remaining) continue;
    const key = 'office';
    const store = grouped.get(key) || { storeId: null, storeName: 'Încasări manuale (Daily Cash)', amountPence: 0, receipts: 0 };
    store.amountPence += remaining; store.receipts++;
    grouped.set(key, store);
  }
  const stores = [...grouped.values()].sort((a, b) => a.storeName.localeCompare(b.storeName));
  return { startDate, endDate, driverId, stores, totalPence: stores.reduce((sum, row) => sum + row.amountPence, 0) };
}
