import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import Database from 'better-sqlite3';
import { ProtectedOutboxWorker } from '../protectedRegistry/outbox.ts';

const source=ts.createSourceFile('service.ts',readFileSync(new URL('../protectedRegistry/service.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const names=new Set(['scheduleProtectedBillingPublication','publishProtectedBilling']);
const functions=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name?.text||'')).map(node=>node.getText(source)).join('\n').replaceAll('export ','');
const uploader=source.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>declaration.name.getText(source)==='protectedUploader'))!.getText(source);
const code=ts.transpileModule(`${functions}\n${uploader}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

function fixture(){
  const db=new Database(':memory:');db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT)');
  let role='writer',pending=true,commits=0,publications=0,loads=0,fail=false;
  let cloudGate=Promise.resolve();
  const timers=new Map<object,()=>void>();
  const store:any={hasPending:()=>pending,read:()=>pending?[{name:'encrypted-fixture',value:{}}]:[],acknowledge:()=>{pending=false;}};
  const bindings:any={db,ProtectedOutboxWorker,protectedOutbox:store,
    protectedPublicationCompanyIds:()=>[],protectedBillingPriorities:new Set(),
    protectedCloudAccountScope:()=> 'fixture',
    commitPendingProtectedSave:async()=>{await cloudGate;commits++;},getDeviceRole:()=>role,isProtectedRegistryEnabled:()=>true,
    withRegistryRoutingLock:async(fn:Function)=>fn(),withPrivateCloudOperation:async(fn:Function)=>fn(),
    keyBuffer:()=>Buffer.alloc(32),reconcilePending:async()=>{},loadVaultFromCloud:async()=>{loads++;return {vault:{assignments:[],invoices:[]},cloudScope:'fixture'};},
    prepareProtectedBillingDeliveries:()=>[],createVrBakerClient:()=>({}),uploadProtectedClientInvoicePdf:async()=>{throw Error('Unexpected PDF');},
    publishProtectedBillingVault:async(_db:any,_vault:any,_client:any,_ids:any,options:any)=>{publications++;assert.equal(options.shouldContinue(),true);if(fail)throw Error('Unavailable');return {skipped:false};},
    setTimeout:(fn:()=>void)=>{const timer={unref(){}};timers.set(timer,fn);return timer;},clearTimeout:(timer:object)=>timers.delete(timer),
  };
  const api=new Function(...Object.keys(bindings),`let protectedBillingPublishing=false,protectedBillingQueued=false,protectedFinancialGeneration=0,protectedBillingDebounce=null;\n${code}\nreturn {scheduleProtectedBillingPublication,protectedUploader,busy:()=>protectedBillingPublishing};`)(...Object.values(bindings));
  const settle=async()=>{for(let n=0;n<100&&api.busy();n++)await new Promise(resolve=>setImmediate(resolve));assert.equal(api.busy(),false);};
  return {api,db,timers,settle,stats:()=>({commits,publications,loads}),setRole:(value:string)=>{role=value;},
    fail:()=>{fail=true;},gate:(value:Promise<void>)=>{cloudGate=value;},close:()=>{api.protectedUploader.stop();db.close();}};
}

test('protected delivery starts directly after the encrypted Writer save is acknowledged, even with the interface locked',async()=>{
  const f=fixture();try{
    let release!:()=>void;f.gate(new Promise<void>(resolve=>{release=resolve;}));
    f.api.scheduleProtectedBillingPublication();assert.equal(f.timers.size,1);
    const upload=f.api.protectedUploader.start();await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(f.stats(),{commits:0,publications:0,loads:0});
    release();await upload;await f.settle();
    assert.deepEqual(f.stats(),{commits:1,publications:1,loads:1});
    assert.equal(f.timers.size,0,'Drive acknowledgement bypasses the publication debounce');
    assert.equal((f.db.prepare("SELECT value FROM app_settings WHERE key='protected_financial_pending'").get() as any).value,'0');
  }finally{f.close()}
});

test('protected publication waits for Drive, never runs on Viewer and retains a failed mirror without spinning',async()=>{
  for(const mode of ['pending','viewer','failed']){const f=fixture();try{
    if(mode==='viewer')f.setRole('viewer');
    if(mode==='failed'){f.fail();await f.api.protectedUploader.start();}
    else f.api.scheduleProtectedBillingPublication(true);
    await f.settle();
    assert.equal(f.stats().publications,mode==='failed'?1:0,mode);
    assert.equal(f.timers.size,0);
    if(mode==='failed')assert.equal((f.db.prepare("SELECT value FROM app_settings WHERE key='protected_financial_pending'").get() as any).value,'1');
  }finally{f.close()}}
});
