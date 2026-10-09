import { randomUUID } from 'node:crypto';
import { db, waitForDatabaseReady } from '../database/db';
import { getDeviceRole } from '../device/deviceRole';
import { createVrBakerClient } from './vrBakerIntegration';
import {processDriverCashBatch} from './driverCashProcessor';
import {recordDriverCashConflict,validateDriverCashCommand} from '../database/driverCash';
import {legacyDriverCashRoutingError,recoverDriverCashRouting,recoverDriverCashAssociation,retryCashRoot} from './driverCashRecovery';
import * as billingRepo from '../database/repositories/billingRepo';
import {EntityAssociationConflict} from '../database/entitySync';
import {invalidateNormalBillingVisibility} from '../database/normalBillingVisibility';
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
  const current=()=>db===connection && getDeviceRole()==='writer';
  const retry=(operationId:string)=>client.request('driver.cash.retry',{source_id:source,operation_id:operationId},`${operationId}:routing-retry-v127`);
  await recoverDriverCashRouting(db,retry,current);
  if(!current()) return;
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
  let incoming = await client.request<unknown>('driver.cash.pending',{source_id:source,after:cursor,protocol_version:2});
  if (!Array.isArray(incoming) || incoming.length>50) throw new Error('Lista încasărilor este invalidă.');
  if(!current()) return;
  const refresh=incoming.map(validateDriverCashCommand).filter(c=>!c.association_error && c.company_id &&
    (c.state==='PENDING' || c.recoverable_association===true) &&
    (db.prepare('SELECT state FROM driver_cash_operations WHERE operation_id=?').get(c.operation_id) as any)?.state!=='PROCESSED');
  if(refresh.length) {
    const snapshot=await client.fetchEntitySnapshot([...new Set(refresh.map(c=>c.store_id))]);
    if(!current()) return;
    for(const store of snapshot.stores) {
      try {
        billingRepo.syncEntitiesFromVrBaker(store.company ? [store.company] : [],[store],{complete:false});
      }catch(error) {
        if(!(error instanceof EntityAssociationConflict)) throw error;
        for(const c of incoming as any[]) if(c.store_id===store.id) c.association_error=error.message;
      }
    }
    invalidateNormalBillingVisibility(db);
  }
  let recovered=false;
  for(const input of incoming) {
    const c=validateDriverCashCommand(input);
    if(c.state==='CONFLICT' && c.hub_result?.error===legacyDriverCashRoutingError) {
      recordDriverCashConflict(db,c,legacyDriverCashRoutingError);recovered=true;
    } else if(await recoverDriverCashAssociation(db,c,retry,current)) recovered=true;
    if(!current()) return;
  }
  if(recovered) {
    await recoverDriverCashRouting(db,retry,current);
    if(!current()) return;
    incoming=await client.request<unknown>('driver.cash.pending',{source_id:source,after:cursor,protocol_version:2});
    if(!Array.isArray(incoming)||incoming.length>50) throw Error('Lista încasărilor este invalidă.');
  }
  await processDriverCashBatch(db,incoming,source,{
    current,saveCursor,
    apply:async command=>(await import('../protectedRegistry/service')).applyRoutedDriverCash(command),
    ack:(payload,key)=>client.request('driver.cash.ack',{...payload,protocol_version:2},key),
  });
  if (incoming.length && current()) await publishBilling();
}
export async function correctHubDriverCash(transactionId: number | string, amount: number, expectedRevision?: number) {
  if (getDeviceRole()!=='writer') throw new Error('Numai Writer poate corecta încasările.');
  if (!Number.isFinite(amount) || amount<0 || Math.abs(amount*100-Math.round(amount*100))>0.00001 || amount*100>100000000000) throw new Error('Suma trebuie să aibă maximum două zecimale.');
  const row = typeof transactionId === 'string' ? db.prepare('SELECT * FROM driver_cash_receipts WHERE root_id=?').get(transactionId) as any
    : db.prepare(`SELECT r.* FROM cash_transactions t JOIN driver_cash_receipts r ON r.root_id=t.driver_cash_root WHERE t.id=?`).get(transactionId) as any;
  if (!row) throw new Error('Încasarea nu există.');
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
    conflicts:db.prepare("SELECT operation_id,root_id,result FROM driver_cash_operations WHERE state='CONFLICT' AND EXISTS(SELECT 1 FROM driver_cash_operations history WHERE history.root_id=driver_cash_operations.root_id AND json_extract(history.request,'$.amount_pence')>0)").all(),
    pending:db.prepare("SELECT operation_id,result FROM driver_cash_operations WHERE state IN ('PROCESSING','RETRY_PENDING','RETRY_READY') AND EXISTS(SELECT 1 FROM driver_cash_operations history WHERE history.root_id=driver_cash_operations.root_id AND json_extract(history.request,'$.amount_pence')>0)").all(),
    receipts:db.prepare(`SELECT r.*,COALESCE(s.name,'Magazin în așteptarea asocierii') AS store_name,d.name AS driver_name,COALESCE(c.name,'Companie neasociată') AS company_name FROM driver_cash_receipts r
      LEFT JOIN stores s ON s.id=r.store_id LEFT JOIN companies c ON c.id=r.company_id JOIN drivers d ON d.id=r.driver_id WHERE EXISTS(SELECT 1 FROM driver_cash_operations history WHERE history.root_id=r.root_id AND json_extract(history.request,'$.amount_pence')>0) ORDER BY recorded_at_ms DESC LIMIT 100`).all(),
    invalidReports:db.prepare('SELECT d.date FROM driver_cash_report_invalidations i JOIN cash_days d ON d.id=i.cash_day_id').all(),
    officeRequests:db.prepare('SELECT root_id,state,last_error FROM driver_cash_office_outbox').all()};
}
export async function retryDriverCashConflict(operationId: string) {
  if (getDeviceRole()!=='writer') throw new Error('Numai Writer poate rezolva conflictele.');
  const connection=db;
  const row=db.prepare("SELECT request,result,root_id FROM driver_cash_operations WHERE operation_id=? AND state IN ('CONFLICT','RETRY_PENDING')").get(operationId) as any;
  if (!row) throw new Error('Conflictul nu mai este disponibil.');
  const client=createVrBakerClient();
  const source=sourceId();
  await retryCashRoot(db,operationId,()=>client.request('driver.cash.retry',{source_id:source,operation_id:operationId},`${operationId}:retry:${randomUUID()}`),()=>connection===db&&getDeviceRole()==='writer');
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

export async function resumeDriverCashSync() {
  db.prepare("DELETE FROM app_settings WHERE key='driver_cash_sync_paused'").run();
  try { await syncDriverCash(); setSyncError(null); }
  catch(error) { setSyncError(error instanceof Error?error.message:'Sincronizare indisponibilă.'); throw error; }
}
