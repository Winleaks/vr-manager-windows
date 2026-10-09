import type Database from 'better-sqlite3';
import type {DriverCashCommand} from './driverCash.ts';
import {cashRetryDelay} from '../integrations/driverCashQueue.ts';
export function installDriverCashQueue(db:Database.Database) {
 db.exec(`CREATE TABLE driver_cash_delivery_retries(operation_id TEXT PRIMARY KEY,root_id TEXT NOT NULL,attempts INTEGER NOT NULL,next_attempt_ms INTEGER NOT NULL,result TEXT NOT NULL);
 CREATE INDEX driver_cash_retry_root ON driver_cash_delivery_retries(root_id);
 CREATE TABLE driver_cash_reviews(operation_id TEXT PRIMARY KEY,root_id TEXT NOT NULL,decision TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
}
export function deferDriverCash(db:Database.Database,c:DriverCashCommand,now=Date.now()) {
 const attempts=((db.prepare('SELECT attempts FROM driver_cash_delivery_retries WHERE operation_id=?').get(c.operation_id) as any)?.attempts??0)+1;
 db.prepare(`INSERT INTO driver_cash_delivery_retries VALUES(?,?,?,?,?) ON CONFLICT(operation_id) DO UPDATE SET attempts=excluded.attempts,next_attempt_ms=excluded.next_attempt_ms,result=excluded.result`)
 .run(c.operation_id,c.root_operation_id,attempts,now+cashRetryDelay(attempts),JSON.stringify({driver_name:c.driver_name,store_name:c.store_name,error:'Încasare păstrată. Sincronizarea va fi reîncercată automat.'}));
}
