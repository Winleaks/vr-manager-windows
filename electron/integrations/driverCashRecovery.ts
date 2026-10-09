import type Database from 'better-sqlite3';
import {driverCashRequestMatches,type DriverCashCommand} from '../database/driverCash.ts';
export const legacyDriverCashRoutingError='Compania nu este disponibilă în facturarea normală. Verifică asocierea încasării.';

/** Retry only a formerly missing company, after a fresh authoritative entity import. */
export async function recoverDriverCashAssociation(db:Database.Database,c:DriverCashCommand,retry:(operationId:string)=>Promise<unknown>,current:()=>boolean) {
  if(!['CONFLICT','PENDING'].includes(c.state??'') || c.recoverable_association!==true || c.association_error || !c.company_id) return false;
  const known=db.prepare('SELECT request,state FROM driver_cash_operations WHERE operation_id=?').get(c.operation_id) as any;
  if(c.state==='PENDING' && !known) return false;
  if(known && (known.state!=='CONFLICT' || JSON.parse(known.request).company_id!==null || !driverCashRequestMatches(known.request,c,true))) return false;
  const identities=db.prepare(`SELECT s.id FROM stores s JOIN companies co ON co.id=s.company_id
    WHERE s.supabase_store_id=? AND co.supabase_company_id=? AND co.is_active=1 AND co.issuer_id IS NOT NULL`).all(c.store_id,c.company_id);
  if(identities.length!==1 || db.prepare('SELECT 1 FROM cash_transactions WHERE driver_cash_root=? LIMIT 1').get(c.root_operation_id) ||
    db.prepare('SELECT 1 FROM driver_cash_allocations WHERE root_id=? LIMIT 1').get(c.root_operation_id) ||
    db.prepare(`SELECT 1 FROM driver_cash_operations WHERE root_id=? AND
      (state IN ('PROCESSED','PROCESSING','RETRY_PENDING','RETRY_READY')) AND json_extract(request,'$.amount_pence')>0 LIMIT 1`).get(c.root_operation_id)) return false;
  if(!known) {
    // Preserve the original unassociated canonical request for safe retry validation.
    const {recordDriverCashConflict}=await import('../database/driverCash.ts');
    recordDriverCashConflict(db,{...c,company_id:null},c.hub_result?.error||'Asocierea necesită verificare.');
  }
  await retryCashRoot(db,c.operation_id,()=>retry(c.operation_id),current);
  return true;
}

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
  const rows=db.prepare(`SELECT operation_id,state,result FROM driver_cash_operations WHERE state IN ('CONFLICT','RETRY_PENDING')
    AND EXISTS(SELECT 1 FROM driver_cash_operations history WHERE history.root_id=driver_cash_operations.root_id
      AND json_extract(history.request,'$.amount_pence')>0) ORDER BY created_at,operation_id`).all() as any[];
  for(const row of rows) {
    if(!current()) return;
    if(row.state==='CONFLICT' && JSON.parse(row.result).error!==legacyDriverCashRoutingError) continue;
    await retryCashRoot(db,row.operation_id,()=>retry(row.operation_id),current);
  }
}
