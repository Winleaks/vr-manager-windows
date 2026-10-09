import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { recordCompanyPaymentTransaction, deletePaymentTransaction } from './repositories/billingTransactions.ts';
import { withDriverCashMutation } from './driverCashGuard.ts';
import { rolloverCashDay, localIsoDate } from './cashDayRollover.ts';

export interface DriverCashCommand {
  operation_id: string; root_operation_id: string; previous_operation_id: string | null;
  collected_at_ms?: number; sequence_id?: number; state?: string; revision: number; recorded_at_ms: number; amount_pence: number;
  driver_id: string; driver_name: string; store_id: string; store_name: string; company_id: string | null;
  hub_result?: { error?: string } | null;
  association_error?: string | null; recoverable_association?: boolean;
  zero_prefix?: Pick<DriverCashCommand,'operation_id'|'previous_operation_id'|'revision'|'recorded_at_ms'|'amount_pence'>[] | null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateDriverCashCommand(input: unknown): DriverCashCommand {
  if (!input || typeof input !== 'object') throw new Error('Format încasare invalid.');
  const c = input as DriverCashCommand;
  for (const key of ['operation_id','root_operation_id','driver_id','store_id'] as const)
    if (typeof c[key] !== 'string' || !uuid.test(c[key])) throw new Error('Identitate încasare invalidă.');
  if (c.company_id !== null && (typeof c.company_id !== 'string' || !uuid.test(c.company_id))) throw new Error('Identitate companie invalidă.');
  if (c.previous_operation_id !== null && (typeof c.previous_operation_id !== 'string' || !uuid.test(c.previous_operation_id))) throw new Error('Operație anterioară invalidă.');
  if (!Number.isSafeInteger(c.revision) || c.revision < 1 || !Number.isSafeInteger(c.recorded_at_ms) || c.recorded_at_ms < 946684800000 ||
      !Number.isSafeInteger(c.amount_pence) || c.amount_pence < 0 || c.amount_pence > 100000000000) throw new Error('Sumă sau versiune invalidă.');
  if(c.collected_at_ms !== undefined && (!Number.isSafeInteger(c.collected_at_ms) || c.collected_at_ms<946684800000 || c.collected_at_ms>c.recorded_at_ms)) throw new Error('Data încasării este invalidă.');
  for (const key of ['driver_name','store_name'] as const) if (typeof c[key] !== 'string' || c[key].length > 300) throw new Error('Denumire invalidă.');
  if(c.association_error!=null && (typeof c.association_error!=='string' || c.association_error.length>500)) throw Error('Asociere invalidă.');
  if(c.recoverable_association!==undefined && typeof c.recoverable_association!=='boolean') throw Error('Stare de recuperare invalidă.');
  if (c.revision === 1 && (c.operation_id !== c.root_operation_id || c.previous_operation_id !== null)) throw new Error('Confirmare inițială invalidă.');
  return c;
}
export function installDriverCash(db: Database.Database) {
  db.exec(`
    ALTER TABLE drivers ADD COLUMN supabase_driver_id TEXT;
    CREATE UNIQUE INDEX drivers_platform_identity ON drivers(supabase_driver_id) WHERE supabase_driver_id IS NOT NULL;
    ALTER TABLE cash_transactions ADD COLUMN driver_cash_root TEXT;
    ALTER TABLE cash_transactions ADD COLUMN driver_recorded_at TEXT;
    CREATE TABLE driver_cash_receipts(root_id TEXT PRIMARY KEY,latest_operation_id TEXT NOT NULL,revision INTEGER NOT NULL,
      company_id INTEGER NOT NULL,store_id INTEGER NOT NULL,driver_id INTEGER NOT NULL,issuer_id INTEGER NOT NULL,
      amount_pence INTEGER NOT NULL,recorded_at_ms INTEGER NOT NULL);
    CREATE TABLE driver_cash_operations(operation_id TEXT PRIMARY KEY,root_id TEXT NOT NULL,request TEXT NOT NULL,
      state TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE driver_cash_allocations(root_id TEXT NOT NULL,operation_id TEXT NOT NULL,payment_id INTEGER NOT NULL,
      amount REAL NOT NULL,reversed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(operation_id,payment_id));
    CREATE TABLE driver_cash_report_invalidations(cash_day_id INTEGER PRIMARY KEY,invalidated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE driver_cash_office_outbox(root_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'PENDING',last_error TEXT);
  `);
}
export function driverCashRequest(c: DriverCashCommand) {
  return JSON.stringify({operation_id:c.operation_id,root_operation_id:c.root_operation_id,previous_operation_id:c.previous_operation_id,
    revision:c.revision,collected_at_ms:c.collected_at_ms??c.recorded_at_ms,recorded_at_ms:c.recorded_at_ms,amount_pence:c.amount_pence,driver_id:c.driver_id,store_id:c.store_id,company_id:c.company_id});
}
export function upgradeDriverCashRouting(db: Database.Database) {
  db.exec(`
    ALTER TABLE driver_cash_receipts RENAME TO driver_cash_receipts_v26;
    CREATE TABLE driver_cash_receipts(root_id TEXT PRIMARY KEY,latest_operation_id TEXT NOT NULL,revision INTEGER NOT NULL,
      company_id INTEGER,store_id INTEGER,driver_id INTEGER NOT NULL,issuer_id INTEGER,
      amount_pence INTEGER NOT NULL,recorded_at_ms INTEGER NOT NULL);
    INSERT INTO driver_cash_receipts SELECT * FROM driver_cash_receipts_v26;
    DROP TABLE driver_cash_receipts_v26;
  `);
}
export function driverCashRequestMatches(stored: string, c: DriverCashCommand,unfundedRetry=false) {
  if (stored === driverCashRequest(c)) return true;
  // The platform may fill an explicitly missing association after a zero declaration.
  const before = JSON.parse(stored);
  return before.company_id === null && (before.amount_pence === 0 || unfundedRetry) && c.company_id !== null &&
    JSON.stringify({...before, company_id:c.company_id}) === driverCashRequest(c);
}
export function companyPaymentDate(ms: number) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);
}
/** Import zero-only continuity with the first financial command, never as queued work. */
export function prepareDriverCashZeroPrefix(db: Database.Database,c: DriverCashCommand) {
  if(c.zero_prefix==null) return;
  const fail=()=>{throw Object.assign(Error('Istoricul inițial al încasării necesită reconciliere.'),{retryable:false});};
  if(!Array.isArray(c.zero_prefix) || c.amount_pence<=0 || c.revision<=1 || c.zero_prefix.length!==c.revision-1 || c.zero_prefix.length>1000) fail();
  let previous:string|null=null,recorded=c.collected_at_ms??c.recorded_at_ms;
  const zeros=c.zero_prefix!.map((z,index)=>{
    if(!z || typeof z!=='object' || Array.isArray(z)) fail();
    let zero:DriverCashCommand;
    try {zero=validateDriverCashCommand({...c,operation_id:z.operation_id,previous_operation_id:z.previous_operation_id,
      revision:z.revision,recorded_at_ms:z.recorded_at_ms,amount_pence:z.amount_pence,company_id:null,zero_prefix:null});} catch {return fail();}
    if(z.amount_pence!==0 || z.revision!==index+1 || z.previous_operation_id!==previous || z.recorded_at_ms<recorded || z.recorded_at_ms>c.recorded_at_ms) fail();
    previous=z.operation_id;recorded=z.recorded_at_ms;return zero;
  });
  if(previous!==c.previous_operation_id) fail();
  db.transaction(()=>{
    for(const zero of zeros) {
      const known=db.prepare('SELECT request,state FROM driver_cash_operations WHERE operation_id=?').get(zero.operation_id) as any;
      if(known) {
        if(!driverCashRequestMatches(known.request,{...zero,company_id:c.company_id})) fail();
        if(known.state==='PROCESSED') continue;
        if(!['CONFLICT','RETRY_PENDING','RETRY_READY'].includes(known.state)) fail();
      }
      if(db.prepare('SELECT 1 FROM cash_transactions WHERE driver_cash_root=? LIMIT 1').get(c.root_operation_id) ||
        db.prepare('SELECT 1 FROM driver_cash_allocations WHERE root_id=? LIMIT 1').get(c.root_operation_id)) fail();
      if(known) db.prepare("UPDATE driver_cash_operations SET state='RETRY_READY' WHERE operation_id=?").run(zero.operation_id);
      applyDriverCash(db,known ? {...zero,company_id:JSON.parse(known.request).company_id} : zero);
      db.prepare("INSERT INTO billing_audit_events(event_type,details) VALUES('driver_cash_zero_continuity',?)")
        .run(JSON.stringify({operation_id:zero.operation_id,root_id:c.root_operation_id,revision:zero.revision,previous:known??null}));
    }
    const baseline=db.prepare('SELECT latest_operation_id,revision,amount_pence FROM driver_cash_receipts WHERE root_id=?').get(c.root_operation_id) as any;
    if(!baseline || baseline.latest_operation_id!==c.previous_operation_id || baseline.revision!==c.revision-1 || baseline.amount_pence!==0) fail();
  })();
}
export interface DriverCashIdentity { id:number|null; company_id:number|null; issuer_id:number|null }
export function prepareDriverCash(db: Database.Database, c: DriverCashCommand) {
  const old = db.prepare('SELECT * FROM driver_cash_receipts WHERE root_id=?').get(c.root_operation_id) as any;
  if (old ? old.latest_operation_id !== c.previous_operation_id || c.revision !== old.revision + 1 : c.revision !== 1)
    throw new Error('Încasarea a fost modificată sau lipsește operația anterioară.');
  const stores = db.prepare(`SELECT s.id,s.company_id,c.issuer_id FROM stores s JOIN companies c ON c.id=s.company_id
    WHERE s.supabase_store_id=? AND c.supabase_company_id=? AND c.is_active=1`).all(c.store_id,c.company_id) as DriverCashIdentity[];
  const financial = c.amount_pence > 0 || old?.company_id != null && old?.issuer_id != null;
  if(financial && c.association_error) throw new Error(c.association_error);
  if(financial && c.company_id===null) throw new Error('Compania magazinului lipsește din încasare. Verifică asocierea din platformă.');
  if(financial && stores.length!==1) throw new Error('Asocierea magazinului și companiei nu corespunde datelor verificate din platformă.');
  if(financial && !stores[0].issuer_id) throw new Error('Emitentul companiei nu este configurat. Verifică emitentul în Hub.');
  // No guessed company/issuer for zero declarations. Keep their external identity in the operation.
  const identity:DriverCashIdentity = stores.length === 1 ? stores[0] : {
    id:(db.prepare('SELECT id FROM stores WHERE supabase_store_id=?').get(c.store_id) as any)?.id ?? null,
    company_id:null,issuer_id:null,
  };
  if (old && (old.store_id != null && old.store_id !== identity.id || old.company_id != null && old.company_id !== identity.company_id))
    throw new Error('Asocierea încasării s-a modificat.');
  const cashHistory=db.prepare('SELECT 1 FROM cash_transactions WHERE driver_cash_root=? LIMIT 1').get(c.root_operation_id);
  return {old,identity,issuerId:cashHistory ? old?.issuer_id ?? identity.issuer_id : identity.issuer_id};
}
export function applyDriverCash(db: Database.Database, input: unknown, today = localIsoDate(), options?: {cashOnly:boolean; identity:DriverCashIdentity; issuerId:number}) {
  const c = validateDriverCashCommand(input);
  const request = driverCashRequest(c);
  return db.transaction(() => withDriverCashMutation(db, () => {
    const prior = db.prepare('SELECT request,state,result FROM driver_cash_operations WHERE operation_id=?').get(c.operation_id) as any;
    if (prior) {
      if (!driverCashRequestMatches(prior.request,c,prior.state==='RETRY_READY')) throw new Error('Operație retrimisă cu alte date.');
      if (prior.state === 'PROCESSED' || prior.state === 'CONFLICT') return {state:prior.state,result:JSON.parse(prior.result)};
      if (!['PROCESSING','RETRY_READY'].includes(prior.state)) throw new Error('Încasarea așteaptă confirmarea reîncercării.');
    }
    const {old,identity,issuerId:resolvedIssuer} = prepareDriverCash(db,c);
    if (options && (JSON.stringify(options.identity) !== JSON.stringify(identity) || resolvedIssuer !== options.issuerId))
      throw Object.assign(new Error('Asocierea s-a schimbat în timpul sincronizării. Încasarea este păstrată pentru reconciliere.'),{retryable:false});
    let driver = db.prepare('SELECT id FROM drivers WHERE supabase_driver_id=?').get(c.driver_id) as any;
    if (!driver) {
      const inserted = db.prepare('INSERT INTO drivers(name,supabase_driver_id) VALUES(?,?)').run(c.driver_name,c.driver_id);
      driver = {id:Number(inserted.lastInsertRowid)};
    }
    const issuerId = resolvedIssuer;
    const before = old?.amount_pence ?? 0;
    if (!options?.cashOnly && old && before !== c.amount_pence) {
      const allocations = db.prepare('SELECT payment_id,amount FROM driver_cash_allocations WHERE root_id=? AND reversed=0').all(c.root_operation_id) as any[];
      for (const allocation of allocations) {
        deletePaymentTransaction(db,{id:allocation.payment_id,reason:'Corectare încasare șofer',operationId:randomUUID(),expectedRevision:0,expectedAmount:allocation.amount});
      }
      db.prepare('UPDATE driver_cash_allocations SET reversed=1 WHERE root_id=?').run(c.root_operation_id);
    }
    if (!options?.cashOnly && c.amount_pence > 0 && (!old || before !== c.amount_pence)) {
      if(identity.company_id===null || issuerId===null) throw Error('Asocierea magazinului, companiei sau emitentului necesită verificare.');
      const maxId = (db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM payments').get() as any).id;
      recordCompanyPaymentTransaction(db,{companyId:identity.company_id,issuerId,amount:c.amount_pence/100,paymentDate:companyPaymentDate(c.collected_at_ms??c.recorded_at_ms),
        method:'cash',notes:`Aplicație șofer · ${c.driver_name} · ${c.store_name} · ${c.root_operation_id}`});
      const payments = db.prepare('SELECT id,amount FROM payments WHERE id>? AND company_id=? AND issuer_id=?').all(maxId,identity.company_id,issuerId) as any[];
      if (Math.round(payments.reduce((s,p)=>s+p.amount,0)*100) !== c.amount_pence) throw new Error('Alocările nu corespund sumei încasate.');
      for (const p of payments) db.prepare('INSERT INTO driver_cash_allocations(root_id,operation_id,payment_id,amount) VALUES(?,?,?,?)').run(c.root_operation_id,c.operation_id,p.id,p.amount);
    }
    const difference = c.amount_pence - before;
    if (difference !== 0) {
      const existing = db.prepare('SELECT id,is_closed FROM cash_days WHERE date=?').get(today) as any;
      if (existing?.is_closed) {
        db.prepare('UPDATE cash_days SET is_closed=0,closing_balance=NULL,closed_at=NULL WHERE id=?').run(existing.id);
        db.prepare("INSERT INTO cash_day_events(cash_day_id,event_type,balance) VALUES(?,'reopen',NULL)").run(existing.id);
      }
      const day = rolloverCashDay(db,today);
      if ((db.prepare('SELECT is_closed FROM cash_days WHERE id=?').get(day.currentDayId) as any)?.is_closed) throw new Error('Ziua de casă nu poate fi deschisă.');
      // Keep import time for accounting; the actual collection time is stored separately.
      db.prepare(`INSERT INTO cash_transactions(cash_day_id,type,category,amount,reference_id,notes,driver_cash_root,driver_recorded_at)
        VALUES(?,?,'driver_collection',?,?,?,?,?)`).run(day.currentDayId,difference>0?'IN':'OUT',Math.abs(difference)/100,driver.id,
        `Aplicație șofer · ${c.store_name} · ${difference<0?'Corectare încasare':'Încasare'} · ${c.root_operation_id}`,c.root_operation_id,new Date(c.collected_at_ms??c.recorded_at_ms).toISOString());
      db.prepare('INSERT INTO driver_cash_report_invalidations(cash_day_id) VALUES(?) ON CONFLICT(cash_day_id) DO UPDATE SET invalidated_at=CURRENT_TIMESTAMP').run(day.currentDayId);
    }
    db.prepare(`INSERT INTO driver_cash_receipts VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(root_id) DO UPDATE SET
      latest_operation_id=excluded.latest_operation_id,revision=excluded.revision,amount_pence=excluded.amount_pence,recorded_at_ms=excluded.recorded_at_ms,
      store_id=excluded.store_id,company_id=excluded.company_id,issuer_id=excluded.issuer_id`)
      .run(c.root_operation_id,c.operation_id,c.revision,identity.company_id,identity.id,driver.id,issuerId,c.amount_pence,c.collected_at_ms??c.recorded_at_ms);
    const result = {root_operation_id:c.root_operation_id,revision:c.revision,amount_pence:c.amount_pence};
    db.prepare("INSERT INTO driver_cash_operations(operation_id,root_id,request,state,result) VALUES(?,?,?,'PROCESSED',?) ON CONFLICT(operation_id) DO UPDATE SET state='PROCESSED',request=excluded.request,result=excluded.result")
      .run(c.operation_id,c.root_operation_id,request,JSON.stringify(result));
    db.prepare('DELETE FROM driver_cash_office_outbox WHERE operation_id=?').run(c.operation_id);
    return {state:'PROCESSED',result};
  }))();
}
export function recordDriverCashConflict(db: Database.Database,c: DriverCashCommand,error: string) {
  const result = {error:error.slice(0,500),driver_name:c.driver_name,store_name:c.store_name,store_id:c.store_id,company_id:c.company_id};
  db.prepare("INSERT INTO driver_cash_operations(operation_id,root_id,request,state,result) VALUES(?,?,?,'CONFLICT',?) ON CONFLICT(operation_id) DO UPDATE SET state='CONFLICT',request=excluded.request,result=excluded.result WHERE driver_cash_operations.state='RETRY_READY'")
    .run(c.operation_id,c.root_operation_id,driverCashRequest(c),JSON.stringify(result));
  return {state:'CONFLICT',result};
}
