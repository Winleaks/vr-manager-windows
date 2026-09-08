import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as queue from '../database/documentSyncQueue.ts';
import { withInvoiceDriveLock } from './invoiceDriveDocument.ts';
import { withDriveFolderLock } from './driveFolderLock.ts';
import { resolveCompanyInvoiceFolder } from './invoiceDriveFolder.ts';

const require=createRequire(import.meta.url);
const compiled=ts.transpileModule(readFileSync(new URL('./documentSync.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
function fixture() {
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE invoices(id INTEGER PRIMARY KEY,status TEXT,invoice_number TEXT,document_revision INTEGER,drive_file_id TEXT);
    CREATE TABLE credit_notes(id INTEGER PRIMARY KEY,status TEXT,reference TEXT,cloud_status TEXT);
    INSERT INTO invoices VALUES(1,'issued','FIX-1',1,NULL);INSERT INTO credit_notes VALUES(1,'issued','CN-1','pending');`);
  queue.installDocumentSyncQueue(db);
  let role='writer';let connected=true;let beforeUpload=async()=>{};let result={success:true};
  const calls:string[]=[];
  const databaseModule={db,waitForDatabaseReady:async()=>{}};
  const mocks:any={
    '../database/invoiceDriveIdentity':{invoiceCopyCleanupError:()=>null,retryInvoiceCopyCleanup:()=>{}},
    electron:{app:{getPath:()=>'/synthetic',once:()=>{}}},'node:fs':{existsSync:()=>false},
    '../database/db':databaseModule,'../device/deviceRole':{getDeviceRole:()=>role},'../database/documentSyncQueue':queue,
    './invoiceDriveDocument':{withInvoiceDriveLock},
    '../database/cloudSync':{
      cleanupPublishedInvoiceCopies:async()=>{},
      isDocumentDriveConnected:()=>connected,
      uploadInvoicePdf:async(id:number)=>queue.trackDocumentUpload(db,'invoice',id,()=>role==='writer'&&databaseModule.db===db,async()=>{calls.push('invoice');await beforeUpload();return result}),
      uploadCreditNotePdfToCloud:async()=>{calls.push('credit_note');await beforeUpload();return result},
    },
    '../database/repositories/billingRepo':{
      readCreditNote:()=>({...db.prepare('SELECT * FROM credit_notes WHERE id=1').get() as object,company_name:'Fixture',issuer_code:'fixture'}),
      setCreditNotePdfState:(_id:number,_path:string,_local:string,cloud:string)=>db.prepare('UPDATE credit_notes SET cloud_status=? WHERE id=1').run(cloud),
    },
    '../reports/creditNotePdf':{generateCreditNotePdf:()=>Buffer.from('%PDF-fixture')},
    '../reports/creditNoteDelivery':{saveCreditNotePdf:()=>({filename:'Credit_Note_CN-1.pdf',filePath:'/synthetic/Credit_Note_CN-1.pdf'})},
  };
  const api:any={};
  runInNewContext(compiled,{exports:api,console,Buffer,setInterval,clearInterval,require:(id:string)=>Object.hasOwn(mocks,id)?mocks[id]:require(id)});
  return {api,db,calls,setRole:(value:string)=>{role=value},disconnect:()=>{connected=false},fail:()=>{result={success:false}},before:(fn:()=>Promise<void>)=>{beforeUpload=fn},switchDb:()=>{databaseModule.db=new Database(':memory:')},close:()=>{db.close();if(databaseModule.db!==db)databaseModule.db.close()}};
}

test('background worker drains verified documents, coalesces concurrent runs and does not reupload ready rows',async()=>{
  const f=fixture();try{
    await Promise.all([f.api.syncPendingDocuments(),f.api.syncPendingDocuments()]);
    assert.deepEqual(f.calls,['credit_note','invoice']);
    assert.equal(f.api.getDocumentSyncStatus().pending,0);
    await f.api.syncPendingDocuments();assert.equal(f.calls.length,2);
  }finally{f.close()}
});
test('Viewer and disconnected Writer perform no document uploads',async()=>{
  for(const mode of ['viewer','offline']){const f=fixture();try{
    if(mode==='viewer')f.setRole('viewer');else f.disconnect();
    await f.api.syncPendingDocuments();assert.equal(f.calls.length,0);
    assert.equal(f.api.getDocumentSyncStatus().pending,2);
    if(mode==='viewer')assert.throws(()=>f.api.retryPendingDocuments(),/Writer/);
  }finally{f.close()}}
});
test('credit upload failure remains locally ready and visibly pending; role/database changes stop the batch',async()=>{
  const failed=fixture();try{
    failed.fail();const result=await failed.api.syncCreditNoteDocument(1);
    assert.equal(result.success,true);assert.equal(result.cloud.success,false);
    assert.equal(queue.documentSyncStatus(failed.db).pending,2);
    assert.equal((failed.db.prepare('SELECT cloud_status FROM credit_notes').get() as any).cloud_status,'error');
  }finally{failed.close()}
  for(const mode of ['role','database']){const f=fixture();try{
    f.before(async()=>{if(mode==='role')f.setRole('viewer');else f.switchDb()});
    await f.api.syncPendingDocuments();assert.deepEqual(f.calls,['credit_note']);
    assert.equal(queue.documentSyncStatus(f.db).pending,2);
  }finally{f.close()}}
});
test('concurrent creation of the same Drive folder is serialized and a failure does not poison the lock',async()=>{
  const events:string[]=[];
  const first=withDriveFolderLock('root','Client',async()=>{events.push('first');await Promise.resolve();throw new Error('interrupted')});
  const second=withDriveFolderLock('root','Client',async()=>{events.push('second');return 'existing_folder'});
  await assert.rejects(first);assert.equal(await second,'existing_folder');
  assert.deepEqual(events,['first','second']);
});

test('simultaneous invoice uploads reuse one newly created company folder hierarchy',async()=>{
  const rows:any[]=[];
  const drive={files:{
    list:async({q}:any)=>({data:{files:rows.filter(row=>q.includes(`name='${row.name}'`)&&q.includes(`'${row.parents[0]}' in parents`))}}),
    create:async({requestBody}:any)=>{await Promise.resolve();const row={...requestBody,id:`new_folder_${rows.length+1}`};rows.push(row);return {data:row}},
  }};
  const results=await Promise.all([resolveCompanyInvoiceFolder(drive,'invoice_root_123','Fixture'),resolveCompanyInvoiceFolder(drive,'invoice_root_123','Fixture')]);
  assert.equal(results[0],results[1]);assert.equal(rows.length,2);
});

test('role or database invalidation during folder lookup prevents folder creation',async()=>{
  let writes=0;
  const drive={files:{list:async()=>({data:{files:[]}}),create:async()=>{writes++;return {data:{id:'new_folder_123'}}}}};
  await assert.rejects(resolveCompanyInvoiceFolder(drive,'invoice_root_123','Fixture',()=>{throw new Error('Writer changed')}),/Writer changed/);
  assert.equal(writes,0);
});
