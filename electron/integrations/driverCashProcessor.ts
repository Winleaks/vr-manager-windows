import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {applyDriverCash,prepareDriverCashZeroPrefix,recordDriverCashConflict,validateDriverCashCommand,driverCashRequestMatches,type DriverCashCommand} from '../database/driverCash.ts';
export async function processDriverCashBatch(db:Database.Database,incoming:unknown[],source:string,deps:{
  current:()=>boolean;verifyCompany?:(company:string|null)=>void;saveCursor:(sequence:number)=>void;
  apply?:(command:DriverCashCommand)=>Promise<{state:string;result:unknown}>;
  ack:(payload:Record<string,unknown>,key:string)=>Promise<unknown>;
}) {
  const blockedRoots=new Set<string>();
  for (const input of incoming) {
    if (!deps.current()) return;
    const command = validateDriverCashCommand(input);
    const known = db.prepare('SELECT request,state,result FROM driver_cash_operations WHERE operation_id=?').get(command.operation_id) as any;
    if (!Number.isSafeInteger(command.sequence_id) || (command.sequence_id ?? 0)<1) throw new Error('Secvența încasării este invalidă.');
    if (command.state === 'PROCESSED' && (!known || !driverCashRequestMatches(known.request,command) || known.state!=='PROCESSED'))
      throw Object.assign(new Error('Baza Hub nu conține o încasare deja procesată pe server. Verifică restaurarea sau identitatea Writer înainte de continuare.'),{retryable:false});
    if (command.state === 'CONFLICT') {
      if(known && ['PROCESSED','PROCESSING'].includes(known.state)) throw Object.assign(Error('Starea încasării diferă între Hub și server. Verifică reconcilierea înainte de continuare.'),{retryable:false});
      recordDriverCashConflict(db,command,command.hub_result?.error||'Încasarea necesită verificare la birou.');
      blockedRoots.add(command.root_operation_id);
      deps.saveCursor(command.sequence_id!);continue;
    }
    if (command.state!=='PENDING' && command.state!=='PROCESSED') throw new Error('Stare încasare invalidă.');
    if(blockedRoots.has(command.root_operation_id)) continue;
    if(known && ['PROCESSING','RETRY_READY'].includes(known.state) && !driverCashRequestMatches(known.request,command,known.state==='RETRY_READY'))
      throw Object.assign(Error('Operație retrimisă cu alte date. Încasarea necesită reconciliere.'),{retryable:false});
    let receipt;
    try {
      if(known?.state==='PROCESSED') {
        if(!driverCashRequestMatches(known.request,command)) throw Object.assign(Error('Operație retrimisă cu alte date.'),{retryable:false});
        receipt={state:known.state,result:JSON.parse(known.result)};
      } else {
        deps.verifyCompany?.(command.company_id);
        prepareDriverCashZeroPrefix(db,command);
        receipt = deps.apply ? await deps.apply(command) : applyDriverCash(db,command);
      }
    }
    catch (error) {
      // Storage failures remain retriable; verified business conflicts require office review.
      if ((error as any)?.code?.startsWith('SQLITE_')) throw error;
      if((error as any)?.retryable!==undefined) throw error;
      if(known?.state==='PROCESSING') throw Object.assign(Error('Încasarea necesită reconciliere. Datele au fost păstrate.'),{retryable:false});
      receipt = recordDriverCashConflict(db,command,error instanceof Error?error.message:'Încasarea necesită verificare.');
    }
    if(!deps.current()) return;
    if (command.state === 'PENDING') await deps.ack({source_id:source,operation_id:command.operation_id,...receipt},`${command.operation_id}:ack:${receipt.state}:${createHash('sha256').update(JSON.stringify(receipt.result)).digest('hex').slice(0,16)}`);
    if(!deps.current()) return;
    deps.saveCursor(command.sequence_id!);
    if (receipt.state==='CONFLICT') blockedRoots.add(command.root_operation_id);
  }
}
