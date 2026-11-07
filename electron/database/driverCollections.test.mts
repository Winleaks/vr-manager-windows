import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { driverCollectionsReport } from './driverCollections.ts';
function fixture(t: any) {
 const db=new Database(':memory:');t.after(()=>db.close());
 db.exec(`CREATE TABLE drivers(id INTEGER,name TEXT,supabase_driver_id TEXT);
 CREATE TABLE stores(id INTEGER,name TEXT,supabase_store_id TEXT);
 CREATE TABLE driver_cash_receipts(root_id TEXT,driver_id INTEGER,store_id INTEGER,amount_pence INTEGER,recorded_at_ms INTEGER);
 CREATE TABLE driver_cash_operations(operation_id TEXT,root_id TEXT,request TEXT,state TEXT,result TEXT);
 INSERT INTO drivers VALUES(1,'Driver A','driver-a'),(2,'Driver B','driver-b');
 INSERT INTO stores VALUES(1,'Shop A','store-a'),(2,'Shop B','store-b');`);
 return db;
}
test('actual London collection date, stores, driver separation and latest corrected totals',t=>{
 const db=fixture(t),insert=db.prepare('INSERT INTO driver_cash_receipts VALUES(?,?,?,?,?)');
 insert.run('a',1,1,1200,Date.parse('2026-07-01T23:30:00Z'));
 insert.run('b',1,1,500,Date.parse('2026-07-02T12:00:00Z'));
 insert.run('c',1,2,2400,Date.parse('2026-07-02T22:59:59Z'));
 insert.run('next',1,2,99999,Date.parse('2026-07-02T23:00:00Z'));
 insert.run('other',2,2,7777,Date.parse('2026-07-02T12:00:00Z'));
 insert.run('zero',1,2,0,Date.parse('2026-07-02T12:00:00Z'));
 db.prepare('UPDATE driver_cash_receipts SET amount_pence=1100 WHERE root_id=?').run('a');
 const result=driverCollectionsReport(db,'2026-07-02','2026-07-02',1);
 assert.equal(result.totalPence,4000);assert.deepEqual(result.stores.map(s=>[s.storeName,s.amountPence,s.receipts]),[['Shop A',1600,2],['Shop B',2400,1]]);
 assert.equal(driverCollectionsReport(db,'2026-07-01','2026-07-01',1).totalPence,0);
});
test('manual reconciliation counts latest acknowledged root once and ignores conflicts',t=>{
 const db=fixture(t),insert=db.prepare('INSERT INTO driver_cash_operations VALUES(?,?,?,?,?)');
 const request={driver_id:'driver-a',store_id:'store-a',collected_at_ms:Date.parse('2026-11-07T08:00:00Z'),recorded_at_ms:Date.parse('2026-11-08T08:00:00Z')};
 for(const [id,root,revision,amount,state] of [['a','root',1,2000,'PROCESSED'],['b','root',2,1000,'PROCESSED'],['c','root',3,800,'CONFLICT'],['d','normal',1,500,'PROCESSED']] as const)
 insert.run(id,root,JSON.stringify({...request,revision,amount_pence:amount}),state,JSON.stringify({disposition:'recorded_manually'}));
 db.prepare('INSERT INTO driver_cash_receipts VALUES(?,?,?,?,?)').run('normal',1,1,500,request.collected_at_ms);
 assert.equal(driverCollectionsReport(db,'2026-11-07','2026-11-07',1).totalPence,1500);
 assert.equal(driverCollectionsReport(db,'2026-11-08','2026-11-08',1).totalPence,0);
});
test('London DST change and invalid input',t=>{
 const db=fixture(t);db.prepare('INSERT INTO driver_cash_receipts VALUES(?,?,?,?,?)').run('dst',1,1,100,Date.parse('2026-10-24T23:30:00Z'));
 assert.equal(driverCollectionsReport(db,'2026-10-25','2026-10-25',1).totalPence,100);
 for(const args of [['2026-02-30','2026-03-01',1],['2026-11-08','2026-11-07',1],['2026-11-07','2026-11-07',0],['2026-11-07','2026-11-07',999]]) assert.throws(()=>driverCollectionsReport(db,...args as [string,string,number]));
});
