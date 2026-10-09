import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import Database from 'better-sqlite3';
import {initialSchema} from '../database/schema.ts';
import {ensureBillingIssuerSchema} from '../database/billingIssuers.ts';
import {ensureCreditNoteSchema} from '../database/creditNotes.ts';
import {installBillingPublication} from '../database/billingPublication.ts';
import {installDriverCash,upgradeDriverCashRouting,applyDriverCash,prepareDriverCash,driverCashRequest,validateDriverCashCommand} from '../database/driverCash.ts';
import {processDriverCashBatch} from '../integrations/driverCashProcessor.ts';
import {applyProtectedDriverCash} from '../protectedRegistry/driverCash.ts';
import {createEmptyProtectedVault} from '../protectedRegistry/types.ts';
import {ProtectedOutboxStore,ProtectedOutboxWorker,vaultDigest} from '../protectedRegistry/outbox.ts';
import * as crypto from '../protectedRegistry/crypto.ts';

function fixture() {
 const db=new Database(':memory:');db.exec(initialSchema);ensureBillingIssuerSchema(db);ensureCreditNoteSchema(db);installBillingPublication(db);installDriverCash(db);upgradeDriverCashRouting(db);
 const issuer=db.prepare("SELECT id,code FROM billing_issuers WHERE code='goodness'").get() as any;
 const company=randomUUID(),store=randomUUID(),root=randomUUID();
 db.exec("INSERT INTO clients(id,name) VALUES(1,'Client')");
 db.prepare('INSERT INTO companies(id,client_id,name,supabase_company_id,issuer_id) VALUES(1,1,?,?,?)').run('Company',company,issuer.id);
 db.prepare('INSERT INTO stores(id,company_id,name,supabase_store_id) VALUES(1,1,?,?)').run('Store',store);
 const command={operation_id:root,root_operation_id:root,previous_operation_id:null,revision:1,recorded_at_ms:Date.parse('2026-10-08T08:00:00Z'),
  amount_pence:12500,driver_id:randomUUID(),driver_name:'Driver',store_id:store,store_name:'Store',company_id:company,sequence_id:1,state:'PENDING'};
 const vault=createEmptyProtectedVault();vault.mode='live';vault.assignments.push({companyKey:`vrbaker:${company}`,localCompanyId:1,companyName:'Company',assignedAt:new Date().toISOString()});
 for(let i=1;i<=2;i++) vault.invoices.push({id:`private-invoice-${i}`,reference:`TGBL${i}`,invoiceDate:`2026-10-0${i}`,sequenceNumber:i,
  companyKey:`vrbaker:${company}`,issuerCode:'goodness',totalAmount:50,paidAmount:0,creditedAmount:0,status:'unpaid',testDocument:false,sourceOrderIds:[],items:[]} as any);
 const key=crypto.generateVaultKey(),recovery=crypto.generateRecoveryKey(),directory=mkdtempSync(path.join(tmpdir(),'driver-cash-routing-'));
 let cloud={vault,envelope:crypto.encryptVault(Buffer.from(JSON.stringify(vault)),key,recovery,vault.revision),driveFileId:'fixed-file',driveVersion:'1',cloudScope:'a'.repeat(64)};
 const state={role:'writer',failBeforeCommit:false,failAfterCommit:false,failBackup:false,assigned:true,backups:0,commits:0};
 const sessions=new Map<number,any>(); // Locked throughout every background-receiver test.
 const outbox=new ProtectedOutboxStore(directory,()=>key);
 const uploader=new ProtectedOutboxWorker(outbox,async pending=>{
  if(state.failBeforeCommit) throw Error('network');
  cloud={...cloud,vault:pending.vault,envelope:crypto.encryptVaultWithExistingRecovery(Buffer.from(JSON.stringify(pending.vault)),key,pending.vault.revision,pending.recovery)};state.commits++;
  if(state.failAfterCommit) throw Error('lost Drive response');
 });
 const source=ts.createSourceFile('service.ts',readFileSync(new URL('../protectedRegistry/service.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
 const declaration=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='applyRoutedDriverCash')!.getText(source).replace('export ','');
 const bindings={db,getDeviceRole:()=>state.role,assertWriter:()=>{if(state.role!=='writer')throw Error('Writer only');},validateDriverCashCommand,prepareDriverCash,
  applyDriverCash,driverCashRequest,applyProtectedDriverCash,withRegistryRoutingLock:async(fn:any)=>fn(),withPrivateCloudOperation:async(fn:any)=>fn(),
  protectedUploader:uploader,protectedOutbox:outbox,loadProtectedRoutingPolicy:async()=>({enabled:true,key,vaultRevision:cloud.vault.revision,
    companyHashes:new Set(state.assigned?[crypto.routingHash(key,'company',`vrbaker:${company}`)]:[])}),loadVaultFromCloud:async()=>structuredClone(cloud),
  readIssuer:()=>issuer,writeVerifiedPrivateCloudFile:async()=>{if(state.failBackup)throw Error('backup failed');state.backups++;},
  encode:(value:any)=>Buffer.from(JSON.stringify(value)),addAudit:(next:any,eventType:string,operationId:string,details:any)=>next.audit.push({eventType,operationId,details}),
  sessions,randomUUID,vaultDigest,...crypto};
 Object.assign(bindings,{companyKey:(company:any)=>`vrbaker:${company.supabase_company_id}`,replaceNormalBillingVisibility:()=>{}});
 const code=ts.transpileModule(declaration,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const apply=new Function(...Object.keys(bindings),code+';return applyRoutedDriverCash;')(...Object.values(bindings));
 const cleanup=()=>{uploader.stop();db.close();rmSync(directory,{recursive:true,force:true});};
 const process=(c:any,ack:()=>Promise<unknown>=async()=>{})=>processDriverCashBatch(db,[c],'writer',{current:()=>state.role==='writer',saveCursor:()=>{},apply,ack});
 return {db,command,state,sessions,outbox,uploader,apply,process,cloud:()=>cloud.vault,cleanup};
}

test('locked module routes cash to encrypted ledger only, pays oldest invoices and surplus, then reverses once',async()=>{
 const f=fixture();try {
  await f.process(f.command);assert.equal(f.sessions.size,0);assert.equal(f.state.backups,1);
  assert.deepEqual(f.cloud().invoices.map(row=>row.paidAmount),[50,50]);assert.equal(f.cloud().creditEntries[0].availableAmount,25);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM payments').get() as any).n,0);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM driver_cash_allocations').get() as any).n,0);
  assert.equal((f.db.prepare('SELECT sum(amount) AS n FROM cash_transactions').get() as any).n,125);
  await f.process(f.command);assert.equal(f.cloud().payments.length,3);
  f.state.assigned=false; // Financial binding survives a subsequent assignment change.
  const correction={...f.command,operation_id:randomUUID(),previous_operation_id:f.command.operation_id,revision:2,amount_pence:3000,sequence_id:2};
  await f.process(correction);assert.deepEqual(f.cloud().invoices.map(row=>row.paidAmount),[30,0]);
  const zero={...correction,operation_id:randomUUID(),previous_operation_id:correction.operation_id,revision:3,amount_pence:0,sequence_id:3};
  await f.process(zero);assert.deepEqual(f.cloud().invoices.map(row=>row.paidAmount),[0,0]);
  assert.equal(f.cloud().creditEntries[0].originalAmount,25);assert.equal(f.cloud().creditEntries[0].availableAmount,0);
  assert.equal((f.db.prepare("SELECT sum(CASE WHEN type='IN' THEN amount ELSE -amount END) AS n FROM cash_transactions").get() as any).n,0);
  assert.equal(f.cloud().driverCashReceipts![0].operations.length,3);
 } finally {f.cleanup();}
});

test('pending encrypted commit and lost cloud acknowledgment resume without duplicate payments or cash',async()=>{
 const f=fixture();try {
  f.state.failAfterCommit=true;let acks=0;
  await assert.rejects(f.process(f.command,async()=>{acks++;}),/așteptare/);
  assert.equal(acks,0);assert.equal(f.outbox.count(),1);assert.equal(f.cloud().payments.length,3);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM cash_transactions').get() as any).n,0);
  f.state.failAfterCommit=false;await f.process(f.command,async()=>{acks++;});
  assert.equal(acks,1);assert.equal(f.cloud().payments.length,3);assert.equal(f.outbox.count(),0);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM cash_transactions').get() as any).n,1);
 } finally {f.cleanup();}
});

test('SQLite write failure after vault commit and lost server ack both retry exactly once',async()=>{
 const f=fixture();try {
  f.db.exec("CREATE TRIGGER reject_cash BEFORE INSERT ON cash_transactions BEGIN SELECT RAISE(ABORT,'injected');END;");
  await assert.rejects(f.process(f.command),/injected/);assert.equal(f.cloud().payments.length,3);
  assert.equal((f.db.prepare('SELECT state FROM driver_cash_operations').get() as any).state,'PROCESSING');
  f.db.exec('DROP TRIGGER reject_cash;');await assert.rejects(f.process(f.command,async()=>{throw Error('lost ack');}),/lost ack/);
  await f.process(f.command);assert.equal(f.cloud().payments.length,3);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM cash_transactions').get() as any).n,1);
 } finally {f.cleanup();}
});

test('test mode and failed backup remain pending; consumed protected credit conflicts before changes',async()=>{
 const f=fixture();try {
  f.cloud().mode='test';await assert.rejects(f.process(f.command),/așteptare/);
  assert.equal(f.cloud().payments.length,0);
  f.cloud().mode='live';f.state.failBackup=true;await assert.rejects(f.process(f.command),/așteptare/);
  assert.equal(f.outbox.count(),0);assert.equal(f.cloud().payments.length,0);
  f.state.failBackup=false;await f.process(f.command);
  f.cloud().creditEntries[0].availableAmount=0;
  const correction={...f.command,operation_id:randomUUID(),previous_operation_id:f.command.operation_id,revision:2,amount_pence:0,sequence_id:2};
  await f.process(correction);
  assert.equal((f.db.prepare('SELECT state FROM driver_cash_operations WHERE operation_id=?').get(correction.operation_id) as any).state,'CONFLICT');
  assert.deepEqual(f.cloud().invoices.map(row=>row.paidAmount),[50,50]);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM cash_transactions').get() as any).n,1);
 } finally {f.cleanup();}
});

test('zero acquires protected binding on first positive revision; Viewer cannot invoke internal receiver',async()=>{
 const f=fixture();try {
  await f.process({...f.command,amount_pence:0});assert.equal(f.cloud().payments.length,0);
  await f.process({...f.command,operation_id:randomUUID(),previous_operation_id:f.command.operation_id,revision:2,amount_pence:6000,sequence_id:2});
  assert.deepEqual(f.cloud().invoices.map(row=>row.paidAmount),[50,10]);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM payments').get() as any).n,0);
  f.state.role='viewer';await assert.rejects(f.apply(f.command),/Writer/);
 } finally {f.cleanup();}
});

test('restored older SQLite and altered processing request stop before any replay',async()=>{
 const f=fixture();try {
  await f.process(f.command);
  f.db.exec('DELETE FROM driver_cash_operations;DELETE FROM driver_cash_receipts;DELETE FROM cash_transactions;');
  await assert.rejects(f.process({...f.command,state:'PROCESSED'}),/restaurarea/);
  await assert.rejects(f.process(f.command),/restaurarea/);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM cash_transactions').get() as any).n,0);
 } finally {f.cleanup();}
});

test('normal receipt stays in its original ledger after the company is assigned to the separate register',async()=>{
 const f=fixture();try {
  f.state.assigned=false;await f.process(f.command);
  assert.equal(f.cloud().payments.length,0);
  assert.equal((f.db.prepare('SELECT sum(amount) AS n FROM payments').get() as any).n,125);
  f.state.assigned=true;
  await f.process({...f.command,operation_id:randomUUID(),previous_operation_id:f.command.operation_id,revision:2,amount_pence:5000,sequence_id:2});
  assert.equal(f.cloud().payments.length,0);
  assert.equal((f.db.prepare('SELECT sum(amount) AS n FROM payments').get() as any).n,50);
 } finally {f.cleanup();}
});

test('ambiguous encrypted append refreshes existing session and blocks stale mutations until recovery',async()=>{
 const f=fixture();try {
  f.sessions.set(1,{role:'writer',vault:structuredClone(f.cloud()),lastActivity:1});
  const append=f.outbox.append.bind(f.outbox);let once=true;
  f.outbox.append=(pending)=>{const name=append(pending);if(once){once=false;throw Error('directory flush interrupted');}return name;};
  await assert.rejects(f.process(f.command),/așteptare/);
  assert.equal(f.sessions.get(1).vault.driverCashReceipts[0].operations[0].operationId,f.command.operation_id);
  assert.equal(f.sessions.get(1).lastActivity,1);
  await f.process(f.command);
  assert.equal(f.cloud().payments.length,3);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM cash_transactions').get() as any).n,1);
 } finally {f.cleanup();}
});

test('altered request cannot replace an in-progress receipt or leak a second financial allocation',async()=>{
 const f=fixture();try {
  f.state.failBeforeCommit=true;await assert.rejects(f.process(f.command),/așteptare/);
  f.state.failBeforeCommit=false;
  await assert.rejects(f.process({...f.command,amount_pence:1}),/alte date/);
  await f.process(f.command);assert.equal(f.cloud().payments.length,3);
 } finally {f.cleanup();}
});

test('v2 first cash after No uses the locked encrypted register without zero cash or acknowledgments',async()=>{
 const f=fixture();try {
  const c={...f.command,operation_id:randomUUID(),previous_operation_id:f.command.operation_id,revision:2,
   collected_at_ms:f.command.recorded_at_ms,recorded_at_ms:f.command.recorded_at_ms+1000,sequence_id:2,
   zero_prefix:[{operation_id:f.command.operation_id,previous_operation_id:null,revision:1,recorded_at_ms:f.command.recorded_at_ms,amount_pence:0}]};
  let acks=0;await f.process(c,async()=>{acks++;});await f.process(c,async()=>{acks++;});
  assert.equal(acks,2);assert.equal(f.sessions.size,0);assert.equal(f.cloud().payments.length,3);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM payments').get() as any).n,0);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM cash_transactions').get() as any).n,1);
  const zero={...c,zero_prefix:null,amount_pence:0,operation_id:randomUUID(),previous_operation_id:c.operation_id,revision:3,sequence_id:3};
  await f.process(zero);assert.deepEqual(f.cloud().invoices.map(row=>row.paidAmount),[0,0]);
 }finally{f.cleanup();}
});
