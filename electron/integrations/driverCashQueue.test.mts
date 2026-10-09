import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCashPage,cashRetryDelay} from './driverCashQueue.ts';
test('page contract rejects no-progress loops, changed snapshots, duplicate or unordered sequences',()=>{
 const good={protocol_version:3,items:[{sequence_id:2}],through:5,next_page_after:2,has_more:true};
 assert.equal(validateCashPage(good,0).next_page_after,2);
 for(const page of [{...good,items:[],next_page_after:0},{...good,through:6},{...good,next_page_after:3},{...good,items:[{sequence_id:2},{sequence_id:2}]}])
  assert.throws(()=>validateCashPage(page,0,5));
 assert.equal(cashRetryDelay(1),5000);assert.equal(cashRetryDelay(99),300000);
});
