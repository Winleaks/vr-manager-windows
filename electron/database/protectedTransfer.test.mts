import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { initialSchema } from './schema.ts';
import { ensureBillingIssuerSchema } from './billingIssuers.ts';
import { ensureCreditNoteSchema } from './creditNotes.ts';
import { installBillingPublication } from './billingPublication.ts';
import { installDocumentSyncQueue } from './documentSyncQueue.ts';
import { installNormalBillingVisibility, replaceNormalBillingVisibility, normalBillingReadDatabase } from './normalBillingVisibility.ts';
import { prepareInvoiceHandoff, activateInvoiceHandoff } from './invoiceHandoffs.ts';
import { beginTransfer, completeTransfer, transferFingerprint, transferBlock, validateTransfer, assertTransfersUnchanged } from '../protectedRegistry/transfer.ts';
import { createEmptyProtectedVault } from '../protectedRegistry/types.ts';
import { prepareProtectedBillingDeliveries, protectedBillingInvoiceId } from '../protectedRegistry/billingPublication.ts';
import { isChannelAllowedForRole } from '../device/viewerPolicy.ts';

function fixture(t: any) {
 const db=new Database(':memory:'); t.after(()=>db.close()); db.pragma('foreign_keys=ON'); db.exec(initialSchema);
 ensureBillingIssuerSchema(db); ensureCreditNoteSchema(db); installBillingPublication(db); installDocumentSyncQueue(db); installNormalBillingVisibility(db);
 const company=randomUUID(), store=randomUUID();
 db.exec("INSERT INTO clients(id,name) VALUES(1,'Owner'); INSERT INTO companies(id,client_id,name) VALUES(1,1,'Company'); INSERT INTO stores(id,company_id,name) VALUES(1,1,'Shop'),(2,1,'Other Shop');");
 db.prepare('UPDATE companies SET supabase_company_id=? WHERE id=1').run(company); db.prepare('UPDATE stores SET supabase_store_id=? WHERE id=1').run(store);
 db.exec("UPDATE billing_issuers SET address='Address',company_number='123',bank_name_1='Bank',account_number_1='12345678',sort_code_1='123456',vat_registered=0,invoice_series='TGB',next_invoice_number=10 WHERE code='goodness'");
 replaceNormalBillingVisibility(db,[1]);
 const vault=createEmptyProtectedVault(); vault.mode='live'; vault.revision=2; vault.updatedAt='2026-10-18T10:00:00Z';
 vault.assignments.push({companyKey:`vrbaker:${company}`} as any);
 const invoice:any={replacesInvoiceId:null,replacedByInvoiceId:null,id:randomUUID(),reference:'TGBL-99',series:'TGBL',sequenceNumber:99,companyId:1,companyKey:`vrbaker:${company}`,storeId:1,storeExternalId:store,issuerCode:'goodness',invoiceDate:'2026-10-01',totalAmount:100,paidAmount:30,creditedAmount:0,status:'partial',testDocument:false,sourceOrderIds:['original-order'],items:[{productName:'Bread',productNameRo:'Pâine',unit:'buc',quantity:10,unitPrice:10,totalPrice:100,externalProductId:null,productOrder:1}]};
 vault.invoices.push(invoice); vault.payments.push({id:randomUUID(),invoiceId:invoice.id,companyKey:invoice.companyKey,issuerCode:'goodness',amount:30,paymentDate:'2026-10-02',method:'cash',testEntry:false} as any);
 const request=validateTransfer({invoiceId:invoice.id,expectedVersion:transferFingerprint(vault,invoice),amount:50,paymentDate:'2026-10-18',cardReference:'terminal-123',bankName:'HSBC',operationId:randomUUID()},'2026-10-18');
 return {db,vault,invoice,request};
}

test('mixed payment freezes source, reserves one invisible number, resumes and moves money exactly once',t=>{
 const f=fixture(t),{db,vault,invoice,request}=f; const read=normalBillingReadDatabase(db);
 beginTransfer(vault,request,'2026-10-18'); const frozen=structuredClone(vault);
 const target=prepareInvoiceHandoff(db,vault,invoice);
 assert.equal(target.invoiceNumber,'TGB-10'); assert.equal(read.prepare('SELECT * FROM invoices').all().length,0);
 assert.equal(db.prepare('SELECT * FROM payments').all().length,0);
 assert.deepEqual(prepareInvoiceHandoff(db,structuredClone(vault),structuredClone(invoice)),target);
 assert.throws(()=>activateInvoiceHandoff(db,vault,invoice),/confirmat/);
 completeTransfer(vault,invoice.id,request.operationId,target);
 assert.throws(()=>prepareProtectedBillingDeliveries(db,vault),/finalizarea locală/);
 const loaded=JSON.parse(JSON.stringify(vault));
 activateInvoiceHandoff(db,loaded,loaded.invoices[0]); activateInvoiceHandoff(db,loaded,loaded.invoices[0]);
 const normal:any=read.prepare('SELECT * FROM invoices').get();
 assert.equal(normal.total_amount,100);assert.equal(normal.paid_amount,80);assert.equal(normal.status,'partial');assert.equal(normal.invoice_date,'2026-10-18');
 assert.equal(db.prepare('SELECT * FROM cash_transactions').all().length,0);
 assert.deepEqual(db.prepare('SELECT amount,payment_date,method,notes FROM payments ORDER BY id').all(),[{amount:30,payment_date:'2026-10-02',method:'cash',notes:null},{amount:50,payment_date:'2026-10-18',method:'card',notes:'terminal-123'}]);
 assert.equal(db.prepare('SELECT * FROM invoice_handoff_payments').all().length,1);
 assert.equal((db.prepare("SELECT next_invoice_number AS n FROM billing_issuers WHERE code='goodness'").get() as any).n,11);
 assert.equal(invoice.status,'cancelled');assert.ok(vault.payments[0].transferredAt);assert.ok(vault.payments[0].reversedAt);
 assert.deepEqual(invoice.sourceOrderIds,['original-order']);
 assert.equal(read.prepare('SELECT * FROM stores').all().length,1);
 assert.equal(db.prepare('SELECT * FROM document_sync_queue').all().length,1);
 const delivery=prepareProtectedBillingDeliveries(db,vault)[0];
 assert.equal(delivery.invoices.length,1); assert.equal(delivery.invoices[0].number,'TGB-10');assert.equal(delivery.invoices[0].outstanding,2000);
 assert.ok(delivery.deleted.includes(protectedBillingInvoiceId(invoice)));
 assert.doesNotMatch(JSON.stringify(delivery.invoices),/TGBL|transfer|original-order|terminal/);
 const revision=delivery.revision; db.prepare('UPDATE invoices SET drive_file_id=? WHERE id=?').run('normal_pdf_file_id',target.invoiceId);
 assert.ok(prepareProtectedBillingDeliveries(db,vault)[0].revision>revision);
 const modified=structuredClone(frozen);modified.payments[0].amount=20; assert.throws(()=>assertTransfersUnchanged(frozen,modified),/blocată/);
 const unassigned=structuredClone(frozen);unassigned.assignments=[];assert.throws(()=>assertTransfersUnchanged(frozen,unassigned),/atribu/);
});

test('full payment, duplicate confirmation, stale preview and invalid eligibility',t=>{
 const {db,vault,invoice,request}=fixture(t);
 for(const change of [{status:'cancelled'},{testDocument:true},{creditedAmount:1},{paidAmount:100}]) { const altered={...invoice,...change};assert.ok(transferBlock(vault,altered)); }
 vault.creditApplications.push({invoiceId:invoice.id} as any);assert.match(transferBlock(vault,invoice)!,/credit aplicat/);vault.creditApplications=[];
 vault.creditNotes.push({status:'issued',sourceInvoiceIds:[invoice.id]} as any);assert.match(transferBlock(vault,invoice)!,/Credit Notes/);vault.creditNotes=[];
 assert.throws(()=>beginTransfer(vault,{...request,amount:71},'2026-10-18'),/depășește/);
 assert.throws(()=>beginTransfer(vault,{...request,expectedVersion:'stale'},'2026-10-18'),/modificat/);
 for(const change of [{amount:0},{amount:-1},{amount:Infinity},{paymentDate:'2026-10-19'},{cardReference:''},{bankName:''},{bankName:'Unknown'}]) assert.throws(()=>validateTransfer({...request,...change},'2026-10-18'));
 const full={...request,amount:70};beginTransfer(vault,full,'2026-10-18');beginTransfer(vault,full,'2026-10-19');assert.throws(()=>beginTransfer(vault,request,'2026-10-18'),/altă operațiune/);
 const target=prepareInvoiceHandoff(db,vault,invoice);completeTransfer(vault,invoice.id,full.operationId,target);activateInvoiceHandoff(db,vault,invoice);
 assert.equal((db.prepare('SELECT status FROM invoices').get() as any).status,'paid');
 db.prepare('DELETE FROM invoice_handoffs').run();assert.throws(()=>prepareInvoiceHandoff(db,vault,invoice),/Jurnalul local/);
});

test('bank selection persists once and legacy pending transfers resume without inventing a bank',t=>{
 for(const bankName of ['Barclays','Virgin','HSBC'] as const) {
  const {db,vault,invoice,request}=fixture(t);
  assert.throws(()=>beginTransfer(vault,{...request,bankName:undefined},'2026-10-18'),/banca/);
  beginTransfer(vault,{...request,bankName},'2026-10-18');
  const target=prepareInvoiceHandoff(db,vault,invoice);
  assert.throws(()=>beginTransfer(vault,{...request,bankName:bankName==='HSBC'?'Virgin':'HSBC'},'2026-10-18'),/altă operațiune/);
  completeTransfer(vault,invoice.id,request.operationId,target);
  activateInvoiceHandoff(db,vault,invoice);activateInvoiceHandoff(db,vault,invoice);
  assert.deepEqual(db.prepare('SELECT method,bank_name FROM payments ORDER BY id').all(),[{method:'cash',bank_name:null},{method:'card',bank_name:bankName}]);
 }
 const {db,vault,invoice,request}=fixture(t);
 beginTransfer(vault,request,'2026-10-18');
 delete invoice.transfer.request.bankName; // Persisted v0.1.136 request shape.
 const legacy=validateTransfer(invoice.transfer.request,'2026-10-18');
 const target=prepareInvoiceHandoff(db,vault,invoice);
 beginTransfer(vault,legacy,'2026-10-18');
 assert.deepEqual(prepareInvoiceHandoff(db,vault,invoice),target);
 completeTransfer(vault,invoice.id,request.operationId,target);activateInvoiceHandoff(db,vault,invoice);
 assert.equal((db.prepare("SELECT bank_name FROM payments WHERE method='card'").get() as any).bank_name,null);
});

test('failed SQLite preparation rolls back numbering and invoice; identity mismatch fails closed',t=>{
 const {db,vault,invoice,request}=fixture(t);beginTransfer(vault,request,'2026-10-18');
 db.exec("CREATE TRIGGER reject_items BEFORE INSERT ON invoice_items BEGIN SELECT RAISE(ABORT,'disk failure'); END");
 assert.throws(()=>prepareInvoiceHandoff(db,vault,invoice),/disk failure/);
 assert.equal(db.prepare('SELECT * FROM invoices').all().length,0); assert.equal(db.prepare('SELECT * FROM invoice_handoffs').all().length,0);
 db.exec('DROP TRIGGER reject_items');invoice.companyKey='local:999';assert.throws(()=>prepareInvoiceHandoff(db,vault,invoice),/companiei/);
});

test('Viewer cannot preview or execute transfer IPC',()=>{
 for(const channel of ['protectedRegistry:getTransferPreview','protectedRegistry:transferInvoice']) assert.equal(isChannelAllowedForRole('viewer',channel),false);
});

import { protectedOutboxHarness } from '../security/fixtures/protectedOutboxHarness.mts';
for (const failure of ['registru-separat.pending','registru-separat.vault','registru-separat.manifest','delete','after-prepare','after-commit','after-activate']) {
 test(`actual encrypted service recovers ${failure} without duplicating money/number`,async t=>{
  const {db,vault,invoice,request}=fixture(t); let injected=false;
  const bindings={db,localTodayIso:()=> '2026-10-18',beginTransfer,completeTransfer,transferBlock,transferFingerprint,validateTransfer,
   scheduleProtectedBillingPublication:()=>{},
   prepareInvoiceHandoff:(...args:Parameters<typeof prepareInvoiceHandoff>)=>{const result=prepareInvoiceHandoff(...args);if(failure==='after-prepare'&&!injected){injected=true;throw Error('interrupted after prepare');}return result;},
   activateInvoiceHandoff:(...args:Parameters<typeof activateInvoiceHandoff>)=>{if(failure==='after-commit'&&!injected){injected=true;throw Error('interrupted after commit');}const result=activateInvoiceHandoff(...args);if(failure==='after-activate'&&!injected){injected=true;throw Error('interrupted after activate');}return result;}
  };
  const first=protectedOutboxHarness(t,undefined,vault,bindings);
  if(!failure.startsWith('after-')) {first.state.failAt=failure;first.state.afterWrite=true;}
  await assert.rejects(first.api.transferProtectedInvoice(1,request));
  // Discard all session state; reload only encrypted cloud + durable SQL journal.
  const restarted=protectedOutboxHarness(t,first,first.current(),bindings);
  const result=await restarted.api.transferProtectedInvoice(1,request);
  const again=await restarted.api.transferProtectedInvoice(1,request);
  assert.deepEqual(result,again);assert.equal(result.invoiceNumber,'TGB-10');
  assert.equal(db.prepare('SELECT * FROM invoices').all().length,1);assert.equal(db.prepare('SELECT * FROM payments').all().length,2);
  assert.equal((db.prepare('SELECT paid_amount FROM invoices').get() as any).paid_amount,80);
  assert.equal(restarted.current().invoices.find((row:any)=>row.id===invoice.id).transfer.state,'committed');
 });
}

test('actual service rejects Viewer and locked register',async t=>{
 const {db,vault,request}=fixture(t);
 const f=protectedOutboxHarness(t,undefined,vault,{db,localTodayIso:()=> '2026-10-18',validateTransfer});
 f.state.role='viewer';await assert.rejects(f.api.transferProtectedInvoice(1,request));
 f.state.role='writer';f.sessions.clear();await assert.rejects(f.api.transferProtectedInvoice(1,request));
 assert.equal(db.prepare('SELECT * FROM invoices').all().length,0);
});

import { statementReport } from './billingReports.ts';
import { recordCompanyPaymentTransaction } from './repositories/billingTransactions.ts';
import { assertDriverCashPaymentMutable } from './driverCashGuard.ts';

test('normal statement preserves early cash dates and subsequent payments cannot settle hidden invoices',t=>{
 const {db,vault,invoice,request}=fixture(t);beginTransfer(vault,request,'2026-10-18');const target=prepareInvoiceHandoff(db,vault,invoice);completeTransfer(vault,invoice.id,request.operationId,target);activateInvoiceHandoff(db,vault,invoice);
 const read=normalBillingReadDatabase(db); const issuer=(db.prepare('SELECT issuer_id FROM invoice_identities WHERE invoice_id=?').get(target.invoiceId) as any).issuer_id;
 const report=statementReport(read,1,issuer,'2026-10-18','2026-10-18');
 assert.equal(report.opening,-30);assert.equal(report.closing,20);assert.doesNotMatch(JSON.stringify(report),/TGBL|transfer|original-order/i);
 db.exec("INSERT INTO invoices(id,store_id,invoice_number,invoice_date,total_amount,paid_amount,status) VALUES(100,2,'HIDDEN-1','2026-10-01',100,0,'unpaid')");
 db.prepare("INSERT INTO invoice_identities(invoice_id,issuer_id,series,sequence_number,reference,issuer_snapshot_json) VALUES(100,?,'HIDDEN',1,'HIDDEN-1','{}')").run(issuer);
 recordCompanyPaymentTransaction(db,{companyId:1,issuerId:issuer,amount:25,paymentDate:'2026-10-18',method:'card'});
 assert.equal((db.prepare('SELECT paid_amount FROM invoices WHERE id=100').get() as any).paid_amount,0);
 assert.equal((db.prepare('SELECT paid_amount FROM invoices WHERE id=?').get(target.invoiceId) as any).paid_amount,100);
 const delivery=prepareProtectedBillingDeliveries(db,vault)[0];assert.equal(delivery.credit,500);assert.equal(delivery.invoices.length,1);assert.equal(delivery.invoices[0].outstanding,0);
 assert.throws(()=>assertDriverCashPaymentMutable(db,(db.prepare('SELECT payment_id FROM invoice_handoff_payments').get() as any).payment_id),/reconciliată/);
});

test('two stores and two issuers retain independent counters and original values',t=>{
 const {db,vault,invoice,request}=fixture(t);
 db.exec("UPDATE billing_issuers SET address='Address',company_number='123',bank_name_1='Bank',account_number_1='12345678',sort_code_1='123456',is_active=1,vat_registered=0,invoice_series='VR',next_invoice_number=40 WHERE code='vatra'");
 const store=randomUUID();db.prepare('UPDATE stores SET supabase_store_id=? WHERE id=2').run(store);
 const other={...structuredClone(invoice),id:randomUUID(),reference:'VRL-1',series:'VRL',sequenceNumber:1,storeId:2,storeExternalId:store,issuerCode:'vatra',paidAmount:0};vault.invoices.push(other as any);
 const otherRequest={...request,invoiceId:other.id,operationId:randomUUID(),expectedVersion:transferFingerprint(vault,other as any)};
 beginTransfer(vault,request,'2026-10-18');beginTransfer(vault,otherRequest,'2026-10-18');
 const a=prepareInvoiceHandoff(db,vault,invoice),b=prepareInvoiceHandoff(db,vault,other as any);
 assert.equal(a.invoiceNumber,'TGB-10');assert.equal(b.invoiceNumber,'VR-40');
 for(const [source,target] of [[invoice,a],[other,b]] as any) {completeTransfer(vault,source.id,source.transfer.operationId,target);activateInvoiceHandoff(db,vault,source);}
 assert.deepEqual(normalBillingReadDatabase(db).prepare('SELECT store_id,total_amount FROM invoices ORDER BY id').all(),[{store_id:1,total_amount:100},{store_id:2,total_amount:100}]);
 const duplicate={...structuredClone(invoice),id:randomUUID(),transfer:undefined,status:'partial'};vault.invoices.push(duplicate);
 assert.throws(()=>beginTransfer(vault,{...request,invoiceId:duplicate.id},'2026-10-18'),/altei facturi/);
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('prepared journal survives actual SQLite close/reopen and activation rollback is retryable', async t=>{
 const {db,vault,invoice,request}=fixture(t);beginTransfer(vault,request,'2026-10-18');const target=prepareInvoiceHandoff(db,vault,invoice);
 const directory=mkdtempSync(path.join(tmpdir(),'vr-transfer-restart-'));
 let reopened!: Database.Database;
 t.after(()=>{if(reopened?.open) reopened.close();rmSync(directory,{recursive:true,force:true});});
 const filename=path.join(directory,'writer.db');await db.backup(filename);
 reopened=new Database(filename);reopened.pragma('foreign_keys=ON');assert.deepEqual(prepareInvoiceHandoff(reopened,vault,invoice),target);reopened.close();
 completeTransfer(vault,invoice.id,request.operationId,target);
 reopened=new Database(filename);
 reopened.exec("CREATE TRIGGER fail_card BEFORE INSERT ON payments WHEN NEW.method='card' BEGIN SELECT RAISE(ABORT,'card storage failed'); END");
 assert.throws(()=>activateInvoiceHandoff(reopened,vault,invoice),/card storage failed/);
 assert.equal(reopened.prepare('SELECT * FROM payments').all().length,0);
 assert.equal((reopened.prepare('SELECT state FROM invoice_handoffs').get() as any).state,'prepared');
 reopened.exec('DROP TRIGGER fail_card');activateInvoiceHandoff(reopened,vault,invoice);
 assert.equal((reopened.prepare('SELECT paid_amount FROM invoices').get() as any).paid_amount,80);
});

test('simultaneous confirmations reserve different sequence numbers and replay one operation',async t=>{
 const {db,vault,invoice,request}=fixture(t);
 const second={...structuredClone(invoice),id:randomUUID(),reference:'TGBL-100',sequenceNumber:100,paidAmount:0};vault.invoices.push(second);
 const other={...request,invoiceId:second.id,operationId:randomUUID(),expectedVersion:transferFingerprint(vault,second)};
 const f=protectedOutboxHarness(t,undefined,vault,{db,localTodayIso:()=> '2026-10-18',beginTransfer,completeTransfer,transferBlock,transferFingerprint,validateTransfer,prepareInvoiceHandoff,activateInvoiceHandoff,scheduleProtectedBillingPublication:()=>{}});
 const results=await Promise.all([f.api.transferProtectedInvoice(1,request),f.api.transferProtectedInvoice(1,other),f.api.transferProtectedInvoice(1,request)]);
 assert.equal(results[0].invoiceNumber,results[2].invoiceNumber);
 assert.notEqual(results[0].invoiceNumber,results[1].invoiceNumber);
 assert.equal(db.prepare('SELECT * FROM invoices').all().length,2);assert.equal(db.prepare('SELECT * FROM payments').all().length,3);
});

import { spawnSync } from 'node:child_process';
import { generateInvoicePDF } from '../../src/utils/pdfGenerator.ts';
import { generateStatementPdf } from '../reports/statementPdf.ts';
test('rendered normal PDF and Statement contain the new number and no protected identity',t=>{
 if(spawnSync('pdftotext',['-v']).error) {t.skip('pdftotext unavailable; PDF generators covered separately');return;}
 const {db,vault,invoice,request}=fixture(t);beginTransfer(vault,request,'2026-10-18');const target=prepareInvoiceHandoff(db,vault,invoice);completeTransfer(vault,invoice.id,request.operationId,target);activateInvoiceHandoff(db,vault,invoice);
 const read=normalBillingReadDatabase(db);const row:any=read.prepare('SELECT i.*,ii.issuer_id,ii.issuer_snapshot_json FROM invoices i JOIN invoice_identities ii ON ii.invoice_id=i.id').get();
 const items:any=read.prepare('SELECT product_name AS productName,product_name_ro AS name_ro,unit,quantity,unit_price AS unitPrice,total_price AS totalPrice FROM invoice_items').all();
 const pdf=generateInvoicePDF(JSON.parse(row.issuer_snapshot_json),{invoiceNumber:row.invoice_number,invoiceDate:row.invoice_date,client:{name:'Company'},store:{name:'Shop'},items,totalAmount:row.total_amount});
 const statement=generateStatementPdf(statementReport(read,1,row.issuer_id,'2026-10-01','2026-10-18'));
 const directory=mkdtempSync(path.join(tmpdir(),'vr-transfer-pdf-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const [index,document] of [pdf,statement].entries()) {
  const filename=path.join(directory,`document-${index}.pdf`);writeFileSync(filename,Buffer.from(document));
  const result=spawnSync('pdftotext',[filename,'-'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/TGB-10/);assert.doesNotMatch(result.stdout,/TGBL|Transferat|registru separat|original-order/i);
 }
});

import { publishProtectedBillingVault } from '../protectedRegistry/billingPublication.ts';
test('merged portal acknowledgement drains only the delivered normal revision',async t=>{
 const {db,vault,invoice,request}=fixture(t);beginTransfer(vault,request,'2026-10-18');const target=prepareInvoiceHandoff(db,vault,invoice);completeTransfer(vault,invoice.id,request.operationId,target);activateInvoiceHandoff(db,vault,invoice);
 db.prepare("UPDATE invoices SET drive_file_id='normal_pdf_verified' WHERE id=?").run(target.invoiceId);
 const before:any=db.prepare('SELECT revision FROM billing_publication_queue WHERE company_id=1').get();
 const actions:string[]=[];
 await publishProtectedBillingVault(db,vault,{request:async (action:string)=>{actions.push(action);if(action==='billing.stage') db.prepare("UPDATE invoices SET drive_file_id='newer_pdf_verified' WHERE id=?").run(target.invoiceId);return {sync_enabled:true,protocol_version:2} as any;}},new Map(),{prepareDocuments:async()=>new Map()});
 const after:any=db.prepare('SELECT revision,published_revision FROM billing_publication_queue WHERE company_id=1').get();
 assert.equal(after.published_revision,before.revision);assert.ok(after.revision>after.published_revision);assert.deepEqual(actions,['billing.status','billing.stage','billing.commit']);
});

test('preview reconciles a lost cloud acknowledgement before the UI chooses its retry request',async t=>{
 const {db,vault,invoice,request}=fixture(t);
 const f=protectedOutboxHarness(t,undefined,vault,{db,localTodayIso:()=> '2026-10-18',beginTransfer,completeTransfer,transferBlock,transferFingerprint,validateTransfer,prepareInvoiceHandoff,activateInvoiceHandoff,scheduleProtectedBillingPublication:()=>{}});
 f.state.failAt='registru-separat.vault';f.state.afterWrite=true;
 await assert.rejects(f.api.transferProtectedInvoice(1,request));
 assert.equal(f.sessions.get(1).vault.invoices[0].transfer,undefined,'memory is genuinely stale after lost acknowledgement');
 f.state.failAt='';const preview=await f.api.getProtectedTransferPreview(1,invoice.id);
 assert.deepEqual(preview.invoice.transfer.request,request);
 const result=await f.api.transferProtectedInvoice(1,preview.invoice.transfer.request);assert.equal(result.invoiceNumber,'TGB-10');assert.equal(db.prepare('SELECT * FROM invoices').all().length,1);
});
