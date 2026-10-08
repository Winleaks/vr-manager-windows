import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { initialSchema } from '../database/schema.ts';
import * as publication from '../database/billingPublication.ts';
import * as visibility from '../database/normalBillingVisibility.ts';
import { installEntitySyncState } from '../database/entitySync.ts';
import { recordCompanyPaymentTransaction } from '../database/repositories/billingTransactions.ts';

const code = ts.transpileModule(readFileSync(new URL('./billingPublisher.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function fixture() {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); db.exec(initialSchema);
  publication.installBillingPublication(db); installEntitySyncState(db); visibility.installNormalBillingVisibility(db);
  db.exec("INSERT INTO clients(id,name) VALUES(1,'Fixture')");
  for (const id of [1,2,3]) {
    const external = `${id}`.repeat(8) + '-1111-4111-8111-111111111111';
    db.prepare('INSERT INTO companies(id,client_id,name,supabase_company_id) VALUES(?,1,?,?)').run(id,`Company ${id}`,external);
    db.prepare('INSERT INTO stores(id,company_id,name,supabase_store_id) VALUES(?,?,?,?)').run(id,id,`Store ${id}`,external);
    db.prepare("INSERT INTO invoices(id,store_id,invoice_number,invoice_date,total_amount,status) VALUES(?,?,?,'2026-10-08',100,'unpaid')").run(id,id,`FIX-${id}`);
  }
  visibility.replaceNormalBillingVisibility(db,[]);
  const database = { db, waitForDatabaseReady: async () => {} };
  const timers = new Map<object, () => void>();
  const calls: Array<{ action: string; payload: any; key?: string }> = [];
  let role = 'writer', fail = false, enabled = true;
  let beforeRequest = async (_action: string, _payload: any) => {};
  const mocks: Record<string, unknown> = {
    '../database/db': database,
    '../device/deviceRole': { getDeviceRole: () => role },
    '../database/billingPublication': publication,
    '../database/normalBillingVisibility': visibility,
    '../database/legacyEntityRepair': { retiredLegacyCompanyIds: () => new Set() },
    '../protectedRegistry/service': { ensureNormalBillingVisibility: async () => visibility.assertNormalBillingVisibilityReady(database.db) },
    './vrBakerIntegration': { createVrBakerClient: () => ({ request: async (action: string, payload: any, key?: string) => {
      calls.push({ action, payload, key }); await beforeRequest(action,payload);
      if (fail) throw Error('Network unavailable');
      return action === 'billing.status' ? { sync_enabled: enabled, protocol_version: 2 } : {};
    } }) },
  };
  const api: any = {};
  runInNewContext(code, { exports: api, require: (id: string) => {
    if (!(id in mocks)) throw Error(`Unexpected dependency ${id}`); return mocks[id];
  }, setTimeout: (fn: () => void) => { const timer = { unref() {} }; timers.set(timer,fn); return timer; },
  clearTimeout: (timer: object) => timers.delete(timer), setInterval: () => ({ unref() {} }) });
  const settle = async () => {
    for (let attempt=0;attempt<100 && api.isBillingPublishing();attempt++) await new Promise(resolve=>setImmediate(resolve));
    assert.equal(api.isBillingPublishing(),false,'publisher must finish without a timer');
  };
  const pay = (id: number, amount = 10) => recordCompanyPaymentTransaction(db, { companyId: id, amount, paymentDate: '2026-10-08', method: 'cash' });
  return { db, api, calls, timers, settle, pay, before: (fn: typeof beforeRequest) => { beforeRequest=fn; },
    setRole: (value: string) => { role=value; }, fail: (value: boolean) => { fail=value; },
    disable: () => { enabled=false; },
    switchDb: () => { database.db = new Database(':memory:'); },
    close: () => { db.close(); if (database.db!==db) database.db.close(); } };
}

test('operator payment publishes immediately, prioritizes its company and bypasses only its deferred retry',async()=>{
  const f=fixture();try{
    f.pay(3); f.db.exec(`UPDATE billing_publication_queue SET retry_at=${Date.now()+300000} WHERE company_id IN (2,3)`);
    f.api.scheduleBillingPublication(); assert.equal(f.timers.size,1);
    f.api.publishCompanyPaymentNow(3); assert.equal(f.timers.size,0);
    await f.settle();
    const stages=f.calls.filter(row=>row.action==='billing.stage');
    assert.deepEqual(stages.map(row=>row.payload.invoices[0].id),['3','1']);
    assert.equal(stages[0].payload.invoices[0].paid,1000);
    assert.equal((f.db.prepare('SELECT revision>published_revision AS pending FROM billing_publication_queue WHERE company_id=3').get() as any).pending,0);
    assert.equal((f.db.prepare('SELECT revision>published_revision AS pending FROM billing_publication_queue WHERE company_id=2').get() as any).pending,1);
  }finally{f.close()}
});

test('a payment arriving during a batch is sent after the current atomic commit and before the remaining backlog',async()=>{
  const f=fixture();try{
    let release!: () => void; const gate=new Promise<void>(resolve=>{release=resolve;});
    let reached!: () => void; const staged=new Promise<void>(resolve=>{reached=resolve;});
    f.before(async(action,payload)=>{if(action==='billing.stage'&&payload.invoices[0].id==='1'){reached();await gate;}});
    const batch=f.api.publishBilling(); await staged;
    f.pay(3); f.api.publishCompanyPaymentNow(3); release(); await batch; await f.settle();
    assert.deepEqual(f.calls.filter(row=>row.action==='billing.commit').map(row=>row.payload.company_id[0]),['1','3','2']);
    assert.equal(f.calls.filter(row=>row.action==='billing.stage').find(row=>row.payload.invoices[0].id==='3')!.payload.invoices[0].paid,1000);
    assert.equal(f.timers.size,0);
  }finally{f.close()}
});

test('an older immutable delivery and a payment during its commit drain immediately in order without duplicate cash',async()=>{
  const f=fixture();try{
    f.db.exec('UPDATE billing_publication_queue SET published_revision=revision WHERE company_id!=1');
    const old=publication.prepareBillingDelivery(f.db,1);
    let changed=false;
    f.before(async(action)=>{if(action==='billing.commit'&&!changed){changed=true;f.pay(1);f.api.publishCompanyPaymentNow(1);}});
    await f.api.publishBilling(); await f.settle();
    const stages=f.calls.filter(row=>row.action==='billing.stage');
    assert.equal(stages.length,2);assert.equal(stages[0].payload.revision,old.revision);
    assert.equal(stages[0].payload.invoices[0].paid,0);assert.equal(stages[1].payload.invoices[0].paid,1000);
    assert.ok(stages[1].payload.revision>old.revision);assert.notEqual(stages[0].key,stages[1].key);
    assert.equal((f.db.prepare('SELECT count(*) n FROM payments').get() as any).n,1);
    assert.equal(f.timers.size,0);
  }finally{f.close()}
});

test('failed immediate delivery keeps the payment and immutable retry; does not spin or bypass another company backoff',async()=>{
  const f=fixture();try{
    f.db.exec(`UPDATE billing_publication_queue SET retry_at=${Date.now()+300000}`);
    f.pay(1); const before=JSON.stringify(f.db.prepare('SELECT * FROM payments').all());
    f.before(async(action)=>{if(action==='billing.stage')f.fail(true);});
    f.api.publishCompanyPaymentNow(1);await f.settle();
    const pending=publication.prepareBillingDelivery(f.db,1);
    assert.equal(f.calls.filter(row=>row.action==='billing.stage').length,1);
    assert.equal(f.timers.size,0);assert.ok((f.db.prepare('SELECT retry_at FROM billing_publication_queue WHERE company_id=1').get() as any).retry_at>Date.now());
    assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM payments').all()),before);
    f.fail(false);f.before(async()=>{});f.api.publishCompanyPaymentNow(1);await f.settle();
    const stages=f.calls.filter(row=>row.action==='billing.stage');
    assert.equal(stages.length,2);assert.equal(stages[0].key,stages[1].key);
    assert.equal(stages[1].payload.revision,pending.revision);
    assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM payments').all()),before);
  }finally{f.close()}
});

test('consecutive company receipts keep their immediate requests when an older delivery interrupts the batch',async()=>{
  const f=fixture();try{
    f.pay(1);publication.prepareBillingDelivery(f.db,1);f.pay(1,20);f.pay(3);
    f.db.exec(`UPDATE billing_publication_queue SET retry_at=${Date.now()+300000}`);
    f.api.publishCompanyPaymentNow(1);f.api.publishCompanyPaymentNow(3);await f.settle();
    const stages=f.calls.filter(row=>row.action==='billing.stage');
    assert.deepEqual(stages.map(row=>row.payload.invoices[0].id),['1','1','3']);
    assert.deepEqual(stages.map(row=>row.payload.invoices[0].paid),[1000,3000,1000]);
    assert.equal((f.db.prepare('SELECT count(*) n FROM payments').get() as any).n,3);
    assert.equal(f.timers.size,0);
  }finally{f.close()}
});

test('Viewer, hidden companies, invalidated visibility and database replacement cannot publish a manual payment',async()=>{
  for(const mode of ['viewer','hidden','visibility','database']){const f=fixture();try{
    if(mode==='viewer')f.setRole('viewer');
    if(mode==='hidden')visibility.replaceNormalBillingVisibility(f.db,[3]);
    if(mode==='visibility')visibility.invalidateNormalBillingVisibility(f.db);
    if(mode==='database')f.before(async(action)=>{if(action==='billing.status')f.switchDb();});
    f.api.publishCompanyPaymentNow(3);await f.settle();
    assert.equal(f.calls.some(row=>row.action==='billing.stage'&&row.payload.invoices[0].id==='3'),false,mode);
    if(mode!=='hidden')assert.equal(f.calls.some(row=>row.action==='billing.stage'),false,mode);
    assert.equal(f.timers.size,0);
  }finally{f.close()}}
});

test('disabled platform sync or a failed status check retains the receipt without repeated immediate requests',async()=>{
  for(const mode of ['disabled','offline']){const f=fixture();try{
    f.pay(3);if(mode==='disabled')f.disable();else f.fail(true);
    f.api.publishCompanyPaymentNow(3);await f.settle();
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,'billing.status');
    assert.equal(f.timers.size,0);
    assert.equal((f.db.prepare('SELECT count(*) n FROM payments').get() as any).n,1);
    assert.equal((f.db.prepare('SELECT revision>published_revision AS pending FROM billing_publication_queue WHERE company_id=3').get() as any).pending,1);
  }finally{f.close()}}
});

test('real payment IPC starts delivery only after local commit, returns while offline and never sends a rejected payment',async()=>{
  const handlerCode=ts.transpileModule(readFileSync(new URL('../ipc/billingHandlers.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
  }).outputText;
  const f=fixture();try{
    const handlers=new Map<string,Function>();
    const mocks:any={
      './trustedHandler':{handleTrustedIpc:(name:string,fn:Function)=>handlers.set(name,fn)},
      '../database/repositories/billingRepo':{recordCompanyPayment:(input:any)=>recordCompanyPaymentTransaction(f.db,input)},
      '../database/db':{db:f.db},
      '../protectedRegistry/service':{ensureNormalBillingVisibility:async()=>visibility.assertNormalBillingVisibilityReady(f.db)},
      '../integrations/billingPublisher':f.api,
    };
    const api:any={};runInNewContext(handlerCode,{exports:api,require:(id:string)=>mocks[id]||{}});
    api.registerBillingHandlers();
    const handler=handlers.get('billing:recordCompanyPayment')!;
    await assert.rejects(handler(null,{companyId:3,amount:-1,paymentDate:'2026-10-08',method:'cash'}));
    assert.equal(f.calls.length,0);
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    f.before(async()=>{
      assert.equal((f.db.prepare('SELECT count(*) n FROM payments').get() as any).n,1,'local commit precedes network');
      await gate;
    });
    const result=await handler(null,{companyId:3,amount:10,paymentDate:'2026-10-08',method:'cash'});
    assert.ok(result);assert.equal(f.api.isBillingPublishing(),true);
    assert.equal(f.timers.size,0,'operator action does not use the debounce or periodic timer');
    f.fail(true);release();await f.settle();
    assert.equal((f.db.prepare('SELECT count(*) n FROM payments').get() as any).n,1,'offline delivery cannot undo or repeat payment');
  }finally{f.close()}
});
