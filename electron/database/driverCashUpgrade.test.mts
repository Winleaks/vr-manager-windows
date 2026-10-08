import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import Database from 'better-sqlite3';
import {initialSchema} from './schema.ts';
import {ensureBillingIssuerSchema} from './billingIssuers.ts';
import {ensureCreditNoteSchema} from './creditNotes.ts';
import {installBillingPublication} from './billingPublication.ts';
import {installDriverCash,upgradeDriverCashRouting,applyDriverCash} from './driverCash.ts';
import {verifyDatabaseFile} from './databaseValidation.ts';
import * as fs from 'node:fs';

function fixture(rejectBackup=false) {
 const directory=mkdtempSync(path.join(tmpdir(),'driver-cash-upgrade-')),db=new Database(path.join(directory,'business.db'));
 db.pragma('journal_mode=WAL');db.pragma('foreign_keys=ON');db.exec(initialSchema);
 ensureBillingIssuerSchema(db);ensureCreditNoteSchema(db);installBillingPublication(db);installDriverCash(db);
 const company=randomUUID(),store=randomUUID(),root=randomUUID(),issuer=(db.prepare('SELECT id FROM billing_issuers LIMIT 1').get() as any).id;
 db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY);INSERT INTO schema_migrations VALUES(26);INSERT INTO categories(name,type) VALUES('Keep','raw');INSERT INTO clients(id,name) VALUES(1,'Client');");
 db.prepare('INSERT INTO companies(id,client_id,name,supabase_company_id,issuer_id) VALUES(1,1,?,?,?)').run('Company',company,issuer);
 db.prepare('INSERT INTO stores(id,company_id,name,supabase_store_id) VALUES(1,1,?,?)').run('Store',store);
 const command={operation_id:root,root_operation_id:root,previous_operation_id:null,revision:1,recorded_at_ms:Date.parse('2026-10-07T08:00:00Z'),
  amount_pence:1234,driver_id:randomUUID(),driver_name:'Driver',store_id:store,store_name:'Store',company_id:company};
 applyDriverCash(db,command,'2026-10-07');
 const source=ts.createSourceFile('db.ts',readFileSync(new URL('./db.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
 const names=new Set(['initDb','createPreMigrationSnapshotIfNeeded','runMigrations']);
 const code=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name?.text||'')).map(node=>node.getText(source).replace('export ','')).join('\n');
 const bindings={db,fs,path,initialSchema,seedData:'',databaseExistedAtStartup:true,dbFolder:directory,upgradeDriverCashRouting,
  verifyDatabaseFile:(file:string)=>{if(rejectBackup)throw Error('snapshot verification failed');return verifyDatabaseFile(file);},console:{log:()=>{},error:()=>{}}};
 const compiled=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const init=new Function(...Object.keys(bindings),compiled+';return initDb;')(...Object.values(bindings));
 return {db,directory,command,init,cleanup:()=>{db.close();rmSync(directory,{recursive:true,force:true});}};
}

test('real v26 file upgrades with verified WAL-inclusive pre-migration backup, retains money and opens offline twice',()=>{
 const f=fixture();try {
  f.init();f.init();
  const backups=readdirSync(path.join(f.directory,'backups'));assert.equal(backups.length,1);
  const backup=new Database(path.join(f.directory,'backups',backups[0]),{readonly:true});
  try {
   assert.equal((backup.prepare('SELECT max(version) AS v FROM schema_migrations').get() as any).v,26);
   assert.equal((backup.prepare('SELECT amount_pence FROM driver_cash_receipts').get() as any).amount_pence,1234);
   assert.equal((backup.pragma('table_info(driver_cash_receipts)') as any[]).find(row=>row.name==='company_id').notnull,1);
  } finally {backup.close();}
  assert.equal((f.db.prepare('SELECT max(version) AS v FROM schema_migrations').get() as any).v,27);
  assert.equal((f.db.prepare('SELECT sum(amount) AS value FROM payments').get() as any).value,12.34);
  const root=randomUUID();applyDriverCash(f.db,{...f.command,operation_id:root,root_operation_id:root,amount_pence:0,company_id:null},'2026-10-08');
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM cash_transactions').get() as any).n,1);
 } finally {f.cleanup();}
});

test('failed backup verification aborts upgrade before changing receipts or schema version',()=>{
 const f=fixture(true);try {
  assert.throws(f.init,/snapshot verification failed/);
  assert.equal((f.db.prepare('SELECT max(version) AS v FROM schema_migrations').get() as any).v,26);
  assert.equal((f.db.prepare('SELECT amount_pence FROM driver_cash_receipts').get() as any).amount_pence,1234);
  assert.equal((f.db.pragma('table_info(driver_cash_receipts)') as any[]).find(row=>row.name==='company_id').notnull,1);
 } finally {f.cleanup();}
});
