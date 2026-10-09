import type Database from 'better-sqlite3';
import {companyPaymentDate,driverCashRequest,driverCashRequestMatches,type DriverCashCommand} from './driverCash.ts';
export const manualReviewError='Posibilă încasare introdusă manual. Verifică înainte de import.';
export function manuallyResolvedRoot(db:Database.Database,root:string) {
 return Boolean(db.prepare("SELECT 1 FROM driver_cash_reviews WHERE root_id=? AND decision='manual'").get(root));
}
export function manualCashCandidates(db:Database.Database,c:DriverCashCommand) {
 return db.prepare(`SELECT t.id,t.amount,d.date,t.created_at FROM cash_transactions t JOIN cash_days d ON d.id=t.cash_day_id
 JOIN drivers driver ON driver.id=t.reference_id WHERE t.type='IN' AND t.category='driver_collection' AND t.driver_cash_root IS NULL
 AND driver.supabase_driver_id=? AND d.date=? ORDER BY t.id`).all(c.driver_id,companyPaymentDate(c.collected_at_ms??c.recorded_at_ms)) as Array<{id:number;amount:number;date:string;created_at:string}>;
}
export function holdManualReview(db:Database.Database,c:DriverCashCommand,financialMatch=false) {
 const decision=db.prepare('SELECT decision FROM driver_cash_reviews WHERE operation_id=?').get(c.operation_id) as any;
 if(decision?.decision==='distinct' && !manuallyResolvedRoot(db,c.root_operation_id)) return;
 const hasImported=db.prepare("SELECT 1 FROM driver_cash_operations WHERE root_id=? AND state IN ('PROCESSING','PROCESSED') AND json_extract(request,'$.amount_pence')>0").get(c.root_operation_id);
 if(!manuallyResolvedRoot(db,c.root_operation_id) && (hasImported || c.amount_pence===0)) return;
 if(!manuallyResolvedRoot(db,c.root_operation_id) && !financialMatch && !manualCashCandidates(db,c).some(t=>Math.round(t.amount*100)===c.amount_pence)) return;
 db.prepare("INSERT INTO driver_cash_reviews(operation_id,root_id,decision) VALUES(?,?,'pending') ON CONFLICT(operation_id) DO NOTHING").run(c.operation_id,c.root_operation_id);
 throw Object.assign(Error(manualReviewError),{businessConflict:true});
}
export function normalManualPaymentMatch(db:Database.Database,c:DriverCashCommand,company:number,issuer:number) {
 return Boolean(db.prepare(`SELECT 1 FROM payments p WHERE p.company_id=? AND p.issuer_id=? AND p.payment_date=?
 AND NOT EXISTS(SELECT 1 FROM driver_cash_allocations a WHERE a.payment_id=p.id)
 GROUP BY p.created_at HAVING round(sum(p.amount)*100)=? LIMIT 1`).get(company,issuer,companyPaymentDate(c.collected_at_ms??c.recorded_at_ms),c.amount_pence));
}
export function finishManualReview(db:Database.Database,c:DriverCashCommand) {
 const review=db.prepare("SELECT * FROM driver_cash_reviews WHERE operation_id=? AND decision='manual'").get(c.operation_id) as any;
 if(!review) return null;
 const known=db.prepare('SELECT request,state,result FROM driver_cash_operations WHERE operation_id=?').get(c.operation_id) as any;
 if(!known || !driverCashRequestMatches(known.request,c) || !['CONFLICT','RETRY_PENDING','RETRY_READY','PROCESSED'].includes(known.state))
  throw Object.assign(Error('Rezolvarea manuală necesită reconciliere.'),{retryable:false});
 if(known.state==='PROCESSED') return {state:'PROCESSED',result:JSON.parse(known.result)};
 if(db.prepare('SELECT 1 FROM cash_transactions WHERE driver_cash_root=?').get(c.root_operation_id) ||
 db.prepare('SELECT 1 FROM driver_cash_allocations WHERE root_id=?').get(c.root_operation_id)) throw Object.assign(Error('Încasarea are deja mișcări financiare.'),{retryable:false});
 // PROCESSED is the transport acknowledgment. The explicit disposition is not a new payment.
 const result={disposition:'recorded_manually',revision:c.revision,driver_name:c.driver_name,store_name:c.store_name};
 db.prepare("UPDATE driver_cash_operations SET state='PROCESSED',result=? WHERE operation_id=?").run(JSON.stringify(result),c.operation_id);
 return {state:'PROCESSED',result};
}
export function decideManualReview(db:Database.Database,operationId:unknown,decision:unknown,cashId:unknown) {
 if(typeof operationId!=='string' || !['distinct','manual'].includes(String(decision))) throw Error('Decizie invalidă.');
 db.transaction(()=>{
 const row=db.prepare("SELECT o.request,r.decision FROM driver_cash_reviews r JOIN driver_cash_operations o USING(operation_id) WHERE r.operation_id=? AND o.state='CONFLICT'").get(operationId) as any;
 if(!row || row.decision!=='pending') throw Error('Verificarea s-a modificat. Reîncarcă pagina.');
 const c=JSON.parse(row.request) as DriverCashCommand;
 if(decision==='distinct' && manuallyResolvedRoot(db,c.root_operation_id)) throw Error('Corectează întâi înregistrarea manuală. Această revizie nu poate crea o a doua plată.');
 let reference='';
 if(decision==='manual') {
  if(!Number.isSafeInteger(cashId) || Number(cashId)<=0) throw Error('Selectează încasarea manuală din Daily Cash.');
  const candidate=manualCashCandidates(db,c).find(t=>t.id===cashId);
  if(!candidate) throw Error('Încasarea manuală nu corespunde șoferului și zilei.');
  const used=db.prepare(`SELECT coalesce(sum(json_extract(o.request,'$.amount_pence')),0) AS amount FROM driver_cash_reviews r JOIN driver_cash_operations o USING(operation_id)
   WHERE r.decision='manual' AND r.reference=? AND r.root_id<>? AND NOT EXISTS(SELECT 1 FROM driver_cash_reviews newer JOIN driver_cash_operations n ON n.operation_id=newer.operation_id
     WHERE newer.root_id=r.root_id AND newer.decision='manual' AND json_extract(n.request,'$.revision')>json_extract(o.request,'$.revision'))`).get(String(cashId),c.root_operation_id) as any;
  if(Math.round(candidate.amount*100)<c.amount_pence+used.amount) throw Error('Suma manuală disponibilă nu acoperă această încasare.');
  reference=String(cashId);
 }
 db.prepare('UPDATE driver_cash_reviews SET decision=?,reference=? WHERE operation_id=?').run(decision,reference,operationId);
 db.prepare("INSERT INTO billing_audit_events(event_type,details) VALUES('driver_cash_review',?)").run(JSON.stringify({operation_id:operationId,decision,cash_transaction_id:reference||null}));
 })();
}
