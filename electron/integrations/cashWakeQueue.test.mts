import test from 'node:test';
import assert from 'node:assert/strict';
import { createCashWakeQueue } from './cashWakeQueue.ts';
const flush = async () => { for(let i=0;i<8;i++) await Promise.resolve(); };
function fixture(drain: () => Promise<void>, nextRetry: () => number | null = () => null, failed = () => true) {
  const timers = new Map<any, {fn: () => void; ms: number}>();
  const queue = createCashWakeQueue({ drain, nextRetry, failed, now: () => 100,
    schedule: (fn,ms) => {const timer = {unref(){}} as any; timers.set(timer,{fn,ms}); return timer;},
    cancel: timer => {timers.delete(timer);},
  });
  return {queue,timers};
}
test('a burst triggers one drain and no idle timer remains', async()=>{
 let count=0; const {queue,timers}=fixture(async()=>{count++;});
 queue.wake();queue.wake();queue.wake();await flush();
 assert.equal(count,1);assert.equal(timers.size,0);
});
test('an event during a slow drain forces a second drain without overlap',async()=>{
 let finish!:()=>void,count=0;
 const {queue}=fixture(async()=>{count++;if(count===1)await new Promise<void>(resolve=>{finish=resolve;});});
 queue.wake();await flush();queue.wake();queue.wake();assert.equal(count,1);
 finish();await flush();assert.equal(count,2);
});
test('transient failure retries known work, then stops on success',async()=>{
 let count=0;const {queue,timers}=fixture(async()=>{if(++count===1)throw Error('offline');});
 queue.wake();await flush();assert.equal(timers.size,1);
 const [id,timer]=[...timers][0];assert.equal(timer.ms,5000);timers.delete(id);timer.fn();await flush();
 assert.equal(count,2);assert.equal(timers.size,0);
});
test('permanent failure does not retry',async()=>{
 const {queue,timers}=fixture(async()=>{throw Error('denied');},()=>null,()=>false);
 queue.wake();await flush();assert.equal(timers.size,0);
});
test('durable deferred work gets its deadline, shutdown cancels it',async()=>{
 const {queue,timers}=fixture(async()=>{},()=>30100);
 queue.wake();await flush();assert.equal([...timers.values()][0].ms,30000);
 queue.stop();queue.wake();await flush();assert.equal(timers.size,0);
});
test('stopping during drain never schedules work or handles later notifications',async()=>{
 let finish!:()=>void;let count=0;
 const {queue,timers}=fixture(async()=>{count++;await new Promise<void>(r=>{finish=r;});},()=>5000);
 queue.wake();await flush();queue.stop();queue.wake();finish();await flush();
 assert.equal(count,1);assert.equal(timers.size,0);
});
