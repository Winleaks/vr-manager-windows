import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('./driverCashNotifications.ts', import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function fixture() {
 const sockets:any[]=[];const timers=new Map<any,()=>void>();
 const state={error:null as any,role:'writer', wakes:0, stopped:0, acquisitions:0, invalidations:0, callback:undefined as any};
 const lease={protocol_version:1,topic:'cash-writer:'+'a'.repeat(64),expires_at:new Date(Date.now()+900000).toISOString(),renew_after_ms:600000,url:'https://qcblxsbzopvsgohfghrv.supabase.co',api_key:'public-test-key'};
 class Socket {
  status:any;event:any;closed=false;
  constructor(){sockets.push(this);}
  channel(topic:any,options:any){assert.equal(topic,lease.topic);assert.equal(options.config.private,true);return this;}
  on(_:any,filter:any,cb:any){assert.equal(filter.event,'cash_changed');this.event=cb;return this;}
  subscribe(cb:any){this.status=cb;return this;}
  disconnect(){this.closed=true;this.status?.('CLOSED');}
 }
 const exports:any={};
 const bindings:any={
  'node:crypto':{randomUUID:()=> 'test-subscriber'},
  '@supabase/realtime-js':{RealtimeClient:Socket},
  '../database/db':{db:{},waitForDatabaseReady:async()=>{}},
  '../device/deviceRole':{getDeviceRole:()=>state.role},
  './vrBakerIntegration':{createVrBakerClient:()=>({request:async(action:string)=>{assert.equal(action,'driver.cash.subscribe');state.acquisitions++;if(state.error)throw state.error;return lease;}})},
  './cashWakeQueue':{createCashWakeQueue:()=>({wake:()=>{state.wakes++;},stop:()=>{state.stopped++;}})},
  './driverCashSync':{setDriverCashConnectionError:()=>{},bindDriverCashWake:(cb:any)=>{state.callback=cb;},driverCashSourceId:()=> 'source',invalidateDriverCashEnvironment:()=>{state.invalidations++;}},
 };
 runInNewContext(code,{exports,require:(id:string)=>{if(!bindings[id])throw Error(id);return bindings[id];},Date,
 setTimeout:(cb:any)=>{const id={unref(){}};timers.set(id,cb);return id;},clearTimeout:(id:any)=>timers.delete(id)});
 return {api:exports,state,sockets,timers};
}
test('subscribe before catch-up; one wake on each subscribed event and cash notification',async()=>{
 const {api,state,sockets}=fixture();api.startDriverCashSync();await flush();
 assert.equal(state.acquisitions,1);assert.equal(state.wakes,0);
 sockets[0].status('SUBSCRIBED');assert.equal(state.wakes,1);
 sockets[0].event();assert.equal(state.wakes,2);
 sockets[0].status('SUBSCRIBED');assert.equal(state.wakes,3);
});
test('lease renewal does not query or wake cash queue',async()=>{
 const {api,state,sockets,timers}=fixture();api.startDriverCashSync();await flush();sockets[0].status('SUBSCRIBED');
 [...timers.values()][0]();await flush();assert.equal(state.acquisitions,2);assert.equal(state.wakes,1);
});
test('connection error closes stale channel and reconnects before catching up',async()=>{
 const {api,state,sockets,timers}=fixture();api.startDriverCashSync();await flush();
 sockets[0].status('CHANNEL_ERROR');assert.equal(sockets[0].closed,true);
 [...timers.values()][0]();await flush();assert.equal(sockets.length,2);
 sockets[1].status('SUBSCRIBED');assert.equal(state.wakes,1);
});
test('role change to viewer closes socket; late callbacks and timer do not fetch or apply cash',async()=>{
 const {api,state,sockets,timers}=fixture();api.startDriverCashSync();await flush();
 state.role='viewer';api.startDriverCashSync();sockets[0].event();sockets[0].status('SUBSCRIBED');await flush();
 assert.equal(sockets[0].closed,true);assert.equal(state.wakes,0);assert.equal(timers.size,0);assert.equal(state.acquisitions,1);
});

test('permanent API denial waits for an explicit retry or credential change',async()=>{
 const {api,state,sockets,timers}=fixture();state.error={retryable:false};api.startDriverCashSync();await flush();
 assert.equal(state.acquisitions,1);assert.equal(timers.size,0);assert.equal(sockets.length,0);
 state.error=null;state.callback();await flush();assert.equal(state.acquisitions,2);assert.equal(sockets.length,1);
});
