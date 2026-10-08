import type Database from 'better-sqlite3';
export const legacyDriverCashRoutingError='Compania nu este disponibilă în facturarea normală. Verifică asocierea încasării.';

/** Persist intent before the RPC, so a lost retry response or crash is resumable. */
export async function retryCashRoot(db:Database.Database,operationId:string,request:()=>Promise<unknown>,current:()=>boolean) {
  const row=db.prepare("SELECT * FROM driver_cash_operations WHERE operation_id=? AND state IN ('CONFLICT','RETRY_PENDING')").get(operationId) as any;
  if(!row) return;
  db.transaction(()=>{
    const rows=db.prepare("SELECT * FROM driver_cash_operations WHERE root_id=? AND state='CONFLICT'").all(row.root_id) as any[];
    for(const item of rows) {
      db.prepare("INSERT INTO billing_audit_events(event_type,details) VALUES('driver_cash_conflict_retry',?)").run(JSON.stringify(item));
      db.prepare("UPDATE driver_cash_operations SET state='RETRY_PENDING' WHERE operation_id=?").run(item.operation_id);
    }
  })();
  await request();
  if(!current()) return;
  db.prepare("UPDATE driver_cash_operations SET state='RETRY_READY' WHERE root_id=? AND state='RETRY_PENDING'").run(row.root_id);
}

export async function recoverDriverCashRouting(db:Database.Database,retry:(operationId:string)=>Promise<unknown>,current:()=>boolean) {
  const rows=db.prepare("SELECT operation_id,state,result FROM driver_cash_operations WHERE state IN ('CONFLICT','RETRY_PENDING') ORDER BY created_at,operation_id").all() as any[];
  for(const row of rows) {
    if(!current()) return;
    if(row.state==='CONFLICT' && JSON.parse(row.result).error!==legacyDriverCashRoutingError) continue;
    await retryCashRoot(db,row.operation_id,()=>retry(row.operation_id),current);
  }
}
