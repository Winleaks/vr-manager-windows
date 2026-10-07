import { randomUUID } from 'node:crypto';
import { db, waitForDatabaseReady } from '../database/db';
import { getDeviceRole } from '../device/deviceRole';
import { createVrBakerClient } from './vrBakerIntegration';
import {processDriverCashBatch} from './driverCashProcessor';
import {normalBillingReadDatabase} from '../database/normalBillingVisibility';
import { publishBilling } from './billingPublisher';
let running: Promise<void> | undefined;
export function syncDriverCash() {
  if (running) return running;
  running = run().finally(()=>{running=undefined;});
  return running;
}
function sourceId() {
  const row = db.prepare('SELECT source_id FROM billing_publication_identity WHERE id=1').get() as {source_id:string}|undefined;
  if (!row) throw new Error('Identitatea Writer nu este configurată.');
  return row.source_id;
}
async function run() {
  if (getDeviceRole() !== 'writer') return;
  await waitForDatabaseReady();
  const connection = db;
  const client = createVrBakerClient();
  const source = sourceId();
  await (await import('../protectedRegistry/service')).ensureNormalBillingVisibility();
  const outbox = db.prepare("SELECT payload,operation_id FROM driver_cash_office_outbox WHERE state='PENDING'").all() as any[];
  for (const row of outbox) {
    if (db!==connection || getDeviceRole()!=='writer') return;
    try { await client.request('driver.cash.correct',JSON.parse(row.payload),row.operation_id); }
    catch (error) {
      if ((error as any)?.retryable === false) db.prepare("UPDATE driver_cash_office_outbox SET state='CONFLICT',last_error=? WHERE operation_id=?")
        .run('Corectarea s-a suprapus cu o altă operație. Reîncarcă încasările.',row.operation_id);
      else throw error;
    }
  }
  const cursor = Number((db.prepare("SELECT value FROM app_settings WHERE key='driver_cash_cursor'").get() as any)?.value || 0);
  const incoming = await client.request<unknown>('driver.cash.pending',{source_id:source,after:cursor});
  if (!Array.isArray(incoming) || incoming.length>50) throw new Error('Lista încasărilor este invalidă.');
  await processDriverCashBatch(db,incoming,source,{
    current:()=>db===connection && getDeviceRole()==='writer',saveCursor,
    verifyCompany:(company)=>{if(!normalBillingReadDatabase(db).prepare('SELECT 1 FROM companies WHERE supabase_company_id=?').get(company))
      throw new Error('Compania nu este disponibilă în facturarea normală. Verifică asocierea încasării.');},
    ack:(payload,key)=>client.request('driver.cash.ack',payload,key),
  });
  if (incoming.length) await publishBilling();
}
export async function correctHubDriverCash(transactionId: number | string, amount: number, expectedRevision?: number) {
  if (getDeviceRole()!=='writer') throw new Error('Numai Writer poate corecta încasările.');
  if (!Number.isFinite(amount) || amount<0 || Math.abs(amount*100-Math.round(amount*100))>0.00001 || amount*100>100000000000) throw new Error('Suma trebuie să aibă maximum două zecimale.');
  const row = typeof transactionId === 'string' ? db.prepare('SELECT * FROM driver_cash_receipts WHERE root_id=?').get(transactionId) as any
    : db.prepare(`SELECT r.* FROM cash_transactions t JOIN driver_cash_receipts r ON r.root_id=t.driver_cash_root WHERE t.id=?`).get(transactionId) as any;
  if (!row) throw new Error('Încasarea nu există.');
  if (!normalBillingReadDatabase(db).prepare('SELECT 1 FROM companies WHERE id=?').get(row.company_id)) throw new Error('Compania nu este disponibilă în facturarea normală.');
  if (row.revision!==expectedRevision) throw new Error('Încasarea s-a modificat. Reîncarcă pagina.');
  const previous = db.prepare('SELECT * FROM driver_cash_office_outbox WHERE root_id=?').get(row.root_id) as any;
  if (previous) {
    if (JSON.parse(previous.payload).amount_pence!==Math.round(amount*100)) throw new Error('Există deja o corectare în așteptare.');
  } else {
    const operation = randomUUID();
    const payload = {source_id:sourceId(),operation_id:operation,root_operation_id:row.root_id,previous_operation_id:row.latest_operation_id,
      expected_revision:row.revision,recorded_at_ms:Date.now(),amount_pence:Math.round(amount*100)};
    db.prepare('INSERT INTO driver_cash_office_outbox(root_id,operation_id,payload) VALUES(?,?,?)').run(row.root_id,operation,JSON.stringify(payload));
  }
  await syncDriverCash();
  const stillPending = db.prepare('SELECT state FROM driver_cash_office_outbox WHERE root_id=?').get(row.root_id) as any;
  if (stillPending?.state==='CONFLICT') throw new Error('Corectarea necesită verificare. Există o operație concurentă.');
  return true;
}
export function startDriverCashSync() {
  const attempt = () => {
    if((db.prepare("SELECT value FROM app_settings WHERE key='driver_cash_sync_paused'").get() as any)?.value==='1') return;
    void syncDriverCash().then(()=>setSyncError(null)).catch(error=>{
      setSyncError(error instanceof Error?error.message:'Sincronizare indisponibilă.');
      if((error as any)?.retryable===false) db.prepare("INSERT INTO app_settings(key,value) VALUES('driver_cash_sync_paused','1') ON CONFLICT(key) DO UPDATE SET value='1'").run();
    });
  };
  attempt();
  setInterval(attempt,30_000).unref();
}

function saveCursor(sequence: number) {
  const old=Number((db.prepare("SELECT value FROM app_settings WHERE key='driver_cash_cursor'").get() as any)?.value||0);
  db.prepare("INSERT INTO app_settings(key,value) VALUES('driver_cash_cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(Math.max(old,sequence)));
}
function setSyncError(error: string | null) {
  db.prepare("INSERT INTO app_settings(key,value) VALUES('driver_cash_sync_error',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(error?.slice(0,500)??null);
}
export function driverCashStatus() {
  return {error:(db.prepare("SELECT value FROM app_settings WHERE key='driver_cash_sync_error'").get() as any)?.value??null,
    conflicts:db.prepare("SELECT operation_id,root_id,result FROM driver_cash_operations WHERE state='CONFLICT'").all(),
    receipts:normalBillingReadDatabase(db).prepare(`SELECT r.*,s.name AS store_name,d.name AS driver_name,c.name AS company_name FROM driver_cash_receipts r
      JOIN stores s ON s.id=r.store_id JOIN companies c ON c.id=r.company_id JOIN drivers d ON d.id=r.driver_id ORDER BY recorded_at_ms DESC LIMIT 100`).all(),
    invalidReports:db.prepare('SELECT d.date FROM driver_cash_report_invalidations i JOIN cash_days d ON d.id=i.cash_day_id').all(),
    officeRequests:db.prepare('SELECT root_id,state,last_error FROM driver_cash_office_outbox').all()};
}
export async function retryDriverCashConflict(operationId: string) {
  if (getDeviceRole()!=='writer') throw new Error('Numai Writer poate rezolva conflictele.');
  const row=db.prepare("SELECT request,result,root_id FROM driver_cash_operations WHERE operation_id=? AND state='CONFLICT'").get(operationId) as any;
  if (!row) throw new Error('Conflictul nu mai este disponibil.');
  const client=createVrBakerClient();
  await client.request('driver.cash.retry',{source_id:sourceId(),operation_id:operationId},randomUUID());
  const failed=db.prepare("SELECT operation_id,request,result FROM driver_cash_operations WHERE root_id=? AND state='CONFLICT'").all(row.root_id) as any[];
  db.transaction(()=>{
    for (const item of failed) {
      db.prepare("INSERT INTO billing_audit_events(event_type,details) VALUES('driver_cash_conflict_retry',?)").run(JSON.stringify(item));
      db.prepare("DELETE FROM driver_cash_operations WHERE operation_id=? AND state='CONFLICT'").run(item.operation_id);
    }
  })();
  await syncDriverCash();
}

export function discardRejectedDriverCashOffice(rootId:string) {
  if(getDeviceRole()!=='writer') throw new Error('Numai Writer poate modifica operațiile.');
  db.transaction(()=>{
    const row=db.prepare("SELECT * FROM driver_cash_office_outbox WHERE root_id=? AND state='CONFLICT'").get(rootId);
    if(!row) throw new Error('Corectarea nu este respinsă.');
    db.prepare("INSERT INTO billing_audit_events(event_type,details) VALUES('driver_cash_office_rejected',?)").run(JSON.stringify(row));
    db.prepare("DELETE FROM driver_cash_office_outbox WHERE root_id=? AND state='CONFLICT'").run(rootId);
  })();
}

export function resumeDriverCashSync() {
  db.prepare("DELETE FROM app_settings WHERE key='driver_cash_sync_paused'").run();
  return syncDriverCash();
}
