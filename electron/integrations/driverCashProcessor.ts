import type Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {applyDriverCash,recordDriverCashConflict,validateDriverCashCommand,driverCashRequest} from '../database/driverCash.ts';
export async function processDriverCashBatch(db:Database.Database,incoming:unknown[],source:string,deps:{
  current:()=>boolean;verifyCompany:(company:string|null)=>void;saveCursor:(sequence:number)=>void;
  ack:(payload:Record<string,unknown>,key:string)=>Promise<unknown>;
}) {
  for (const input of incoming) {
    if (!deps.current()) return;
    const command = validateDriverCashCommand(input);
    const known = db.prepare('SELECT request,state,result FROM driver_cash_operations WHERE operation_id=?').get(command.operation_id) as any;
    if (!Number.isSafeInteger(command.sequence_id) || (command.sequence_id ?? 0)<1) throw new Error('Secvența încasării este invalidă.');
    if (command.state === 'PROCESSED' && (!known || known.request !== driverCashRequest(command) || known.state!=='PROCESSED'))
      throw Object.assign(new Error('Baza Hub nu conține o încasare deja procesată pe server. Verifică restaurarea sau identitatea Writer înainte de continuare.'),{retryable:false});
    if (command.state === 'CONFLICT') {
      recordDriverCashConflict(db,command,'Încasarea necesită verificare la birou.');
      deps.saveCursor(command.sequence_id!);continue;
    }
    if (command.state!=='PENDING' && command.state!=='PROCESSED') throw new Error('Stare încasare invalidă.');
    let receipt;
    try { deps.verifyCompany(command.company_id); receipt = applyDriverCash(db,command); }
    catch (error) {
      // Storage failures remain retriable; verified business conflicts require office review.
      if ((error as any)?.code?.startsWith('SQLITE_')) throw error;
      receipt = recordDriverCashConflict(db,command,error instanceof Error?error.message:'Încasarea necesită verificare.');
    }
    if (command.state === 'PENDING') await deps.ack({source_id:source,operation_id:command.operation_id,...receipt},`${command.operation_id}:ack:${receipt.state}:${createHash('sha256').update(JSON.stringify(receipt.result)).digest('hex').slice(0,16)}`);
    deps.saveCursor(command.sequence_id!);
    if (receipt.state==='CONFLICT') break;
  }
}
