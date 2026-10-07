import type Database from 'better-sqlite3';
const coordinated = new WeakSet<Database.Database>();
export function withDriverCashMutation<T>(db: Database.Database, action: () => T): T {
  if (coordinated.has(db)) return action();
  coordinated.add(db);
  try { return action(); } finally { coordinated.delete(db); }
}
export function assertDriverCashPaymentMutable(db: Database.Database, paymentId: number) {
  if (coordinated.has(db) || !db.prepare("SELECT 1 FROM sqlite_master WHERE name='driver_cash_allocations'").get()) return;
  if (db.prepare('SELECT 1 FROM driver_cash_allocations WHERE payment_id=? AND reversed=0').get(paymentId))
    throw new Error('Încasarea provine din aplicația șoferului. Corectează suma întreagă din Daily Cash → Încasări șoferi.');
}

export function assertDriverCashTransactionMutable(db: Database.Database, transactionId: number) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info('cash_transactions') WHERE name='driver_cash_root'").get()) return;
  if ((db.prepare('SELECT driver_cash_root FROM cash_transactions WHERE id=?').get(transactionId) as any)?.driver_cash_root)
    throw new Error('Folosește corectarea coordonată a încasării șoferului.');
}
