import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ProtectedPublicationReceipts,publicationFingerprint} from '../protectedRegistry/publicationReceipts.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  prepareProtectedBillingDeliveries,
  protectedBillingInvoiceId,
  protectedBillingRevision,
  publishProtectedBillingVault,
  protectedPublicationCompanyIds,
  queueNormalPublicationAfterProtected,
} from '../protectedRegistry/billingPublication.ts';
import { createEmptyProtectedVault, type ProtectedInvoice } from '../protectedRegistry/types.ts';

const company = '11111111-1111-4111-8111-111111111111';
const store = '22222222-2222-4222-8222-222222222222';
const source = '33333333-3333-4333-8333-333333333333';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE companies(id INTEGER PRIMARY KEY,supabase_company_id TEXT);
    CREATE TABLE stores(id INTEGER PRIMARY KEY,company_id INTEGER,supabase_store_id TEXT);
    CREATE TABLE invoices(id INTEGER PRIMARY KEY,store_id INTEGER);
    CREATE TABLE billing_publication_identity(id INTEGER PRIMARY KEY,source_id TEXT NOT NULL);
    CREATE TABLE billing_publication_deleted(company_id INTEGER NOT NULL,invoice_id TEXT NOT NULL,PRIMARY KEY(company_id,invoice_id));
    CREATE TABLE billing_publication_queue(company_id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,last_error TEXT,retry_at INTEGER NOT NULL DEFAULT 0);
  `);
  db.prepare('INSERT INTO companies VALUES(1,?)').run(company);
  db.prepare('INSERT INTO stores VALUES(1,1,?)').run(store);
  db.exec("INSERT INTO invoices VALUES(12,1);INSERT INTO billing_publication_identity VALUES(1,'33333333-3333-4333-8333-333333333333');INSERT INTO billing_publication_deleted VALUES(1,'7');INSERT INTO billing_publication_queue VALUES(1,4,'old',99)");
  const vault = createEmptyProtectedVault('2026-09-28T10:00:00.000Z');
  vault.mode = 'live';
  vault.revision = 21;
  vault.updatedAt = '2026-09-28T10:00:01.234Z';
  vault.assignments.push({ companyKey: `vrbaker:${company}`, localCompanyId: 1, companyName: 'Client', assignedAt: vault.updatedAt });
  const invoice: ProtectedInvoice = {
    id: '44444444-4444-4444-8444-444444444444', operationId: 'operation_123456789', reference: 'TGBL-2930', series: 'TGBL', sequenceNumber: 2930,
    invoiceDate: '2026-09-28', companyKey: `vrbaker:${company}`, companyId: 1, companyName: 'Client', companySnapshot: {},
    storeExternalId: store, storeId: 1, storeName: 'Shop', storeSnapshot: {}, issuerId: 1, issuerCode: 'goodness', issuerSnapshot: {},
    items: [], sourceOrderIds: [], sourceFingerprint: null, periodStart: null, periodEnd: null,
    totalAmount: 100, paidAmount: 20, creditedAmount: 10, status: 'partial', testDocument: false,
    createdAt: vault.updatedAt, cancelledAt: null, cancellationReason: null, replacesInvoiceId: null, replacedByInvoiceId: null,
  };
  vault.invoices.push(invoice, { ...invoice, id: '55555555-5555-4555-8555-555555555555', operationId: 'operation_987654321', sequenceNumber: 2931, reference: 'TGBL-2931', testDocument: true });
  vault.creditApplications.push({ id: 'application', operationId: 'operation_123456789', companyKey: invoice.companyKey, issuerCode: 'goodness', invoiceId: invoice.id, amount: 5, allocations: [], reason: 'credit', createdAt: vault.updatedAt, reversedAt: null, reversalReason: null, testEntry: false });
  vault.creditEntries.push({ id: 'credit', companyKey: invoice.companyKey, issuerCode: 'goodness', sourceType: 'payment_overpayment', sourceId: 'payment', originalAmount: 3, availableAmount: 3, createdAt: vault.updatedAt, testEntry: false });
  return { db, vault, invoice };
}

test('protected live registry publishes only client-safe invoice metadata and balance', () => {
  const { db, vault, invoice } = fixture();
  try {
    const metadataOnlyRevision = Date.parse(vault.updatedAt) * 1000 + (vault.revision % 1000);
    assert.ok(protectedBillingRevision(vault) > metadataOnlyRevision, 'document publication must supersede v0.1.119 metadata');
    const [delivery] = prepareProtectedBillingDeliveries(db, vault, new Map([[invoice.id, 'protected_portal_pdf_123']]));
    assert.equal(delivery.company_id, company);
    assert.equal(delivery.source_id, source);
    assert.equal(delivery.revision, protectedBillingRevision(vault));
    assert.equal(delivery.credit, 300);
    assert.deepEqual(delivery.deleted, ['7', '12']);
    assert.equal(delivery.invoices.length, 1);
    assert.deepEqual(delivery.invoices[0], {
      id: protectedBillingInvoiceId(invoice), store_id: store, number: 'TGBL-2930', date: '2026-09-28',
      due_date:'2026-09-28',due_basis:'manual',period_start:null,period_end:null,
      total: 10000, paid: 2000, credited: 1000, applied_credit: 500, outstanding: 6500,
      cancelled: false, drive_file_id: 'protected_portal_pdf_123',
    });
    assert.ok(!JSON.stringify(delivery).includes('items'));
    assert.ok(!JSON.stringify(delivery).includes('companySnapshot'));
  } finally { db.close(); }
});

test('protected publication keeps every company and store strictly isolated', () => {
  const { db, vault, invoice } = fixture();
  const otherCompany = '66666666-6666-4666-8666-666666666666';
  const otherStore = '77777777-7777-4777-8777-777777777777';
  try {
    db.prepare('INSERT INTO companies VALUES(2,?)').run(otherCompany);
    db.prepare('INSERT INTO stores VALUES(2,2,?)').run(otherStore);
    db.exec('INSERT INTO billing_publication_queue VALUES(2,1,NULL,0)');
    vault.assignments.push({ companyKey: `vrbaker:${otherCompany}`, localCompanyId: 2, companyName: 'Other', assignedAt: vault.updatedAt });
    vault.invoices.push({ ...invoice, id: '88888888-8888-4888-8888-888888888888', operationId: 'operation_other_1234',
      companyKey: `vrbaker:${otherCompany}`, companyId: 2, companyName: 'Other', storeExternalId: otherStore, storeId: 2,
      storeName: 'Other shop', series: 'VRL', sequenceNumber: 41, reference: 'VRL-41', totalAmount: 55, paidAmount: 5, creditedAmount: 0 });
    const deliveries = prepareProtectedBillingDeliveries(db, vault);
    assert.equal(deliveries.length, 2);
    const first = deliveries.find(row => row.company_id === company)!;
    const second = deliveries.find(row => row.company_id === otherCompany)!;
    assert.deepEqual(first.invoices.map(row => row.store_id), [store]);
    assert.deepEqual(second.invoices.map(row => row.store_id), [otherStore]);
    assert.deepEqual(second.invoices.map(row => row.number), ['VRL-41']);
    assert.equal(second.credit, 0);
  } finally { db.close(); }
});

test('test registry never reaches the platform; live publication uses existing idempotent protocol', async () => {
  const { db, vault, invoice } = fixture();
  const calls: Array<{ action: string; payload: any; key?: string }> = [];
  const client = { request: async (action: string, payload?: any, key?: string) => {
    calls.push({ action, payload, key });
    if (action === 'billing.status') return { sync_enabled: true, protocol_version: 2 };
    return true;
  } };
  try {
    vault.mode = 'test';
    assert.deepEqual(await publishProtectedBillingVault(db, vault, client), { published: 0, skipped: true });
    assert.equal(calls.length, 0);
    vault.mode = 'live';
    assert.deepEqual(await publishProtectedBillingVault(db, vault, client, new Map([[invoice.id, 'protected_portal_pdf_123']])), { published: 1, skipped: false });
    assert.deepEqual(calls.map(call => call.action), ['billing.status', 'billing.stage', 'billing.commit']);
    assert.match(calls[1].key || '', /:protected:/);
    assert.equal(calls[1].payload.invoices[0].drive_file_id, 'protected_portal_pdf_123');
  } finally { db.close(); }
});

test('portal PDF references are allowlisted and cancelled invoices never expose a document', () => {
  const { db, vault, invoice } = fixture();
  try {
    assert.throws(() => prepareProtectedBillingDeliveries(db, vault, new Map([[invoice.id, '../private.pdf']])), /Identitatea PDF-ului/);
    invoice.status = 'cancelled';
    const [delivery] = prepareProtectedBillingDeliveries(db, vault, new Map([[invoice.id, 'protected_portal_pdf_123']]));
    assert.equal(delivery.invoices[0].drive_file_id, null);
    assert.equal(delivery.invoices[0].outstanding, 0);
  } finally { db.close(); }
});

test('returning a company to normal billing tombstones protected rows and advances revision', () => {
  const { db, vault, invoice } = fixture();
  try {
    queueNormalPublicationAfterProtected(db, vault, invoice.companyKey);
    const deleted = db.prepare('SELECT invoice_id FROM billing_publication_deleted ORDER BY invoice_id').all() as Array<{ invoice_id: string }>;
    assert.ok(deleted.some(row => row.invoice_id === protectedBillingInvoiceId(invoice)));
    const queue = db.prepare('SELECT * FROM billing_publication_queue WHERE company_id=1').get() as any;
    assert.equal(queue.revision, protectedBillingRevision(vault) + 1);
    assert.equal(queue.last_error, null);
    assert.equal(queue.retry_at, 0);
  } finally { db.close(); }
});

test('protected receipts publish their own verified PDFs and balance before unrelated documents', async () => {
  const {db,vault,invoice}=fixture();
  const other='66666666-6666-4666-8666-666666666666';
  const calls:string[]=[];
  const client={request:async(action:string,payload?:any)=>{
    calls.push(`${action}:${payload?.company_id||''}`);
    return action==='billing.status'?{sync_enabled:true,protocol_version:2}:true;
  }};
  try {
    db.prepare('INSERT INTO companies VALUES(2,?)').run(other);
    vault.assignments.push({companyKey:`vrbaker:${other}`,localCompanyId:2,companyName:'Other',assignedAt:vault.updatedAt});
    await assert.rejects(publishProtectedBillingVault(db,vault,client,new Map(),{
      priorityCompanyIds:new Set([other]),
      prepareDocuments:async id=>{
        calls.push(`pdf:${id}`);
        if(id===company)throw Error('Unrelated PDF temporarily unavailable');
        return new Map();
      },
    }),/Unrelated PDF/);
    assert.deepEqual(calls,['billing.status:',`pdf:${other}`,`billing.stage:${other}`,`billing.commit:${other}`,`pdf:${company}`]);
    calls.length=0;
    await assert.rejects(publishProtectedBillingVault(db,vault,client,new Map(),{prepareDocuments:async()=>new Map()}),/PDF-ul/);
    assert.deepEqual(calls,['billing.status:'],'no live invoice metadata is committed without its verified PDF');
    assert.equal(invoice.paidAmount,20,'publication never changes financial records');
  }finally{db.close();}
});

test('a newer financial snapshot interrupts publication only between complete company commits',async()=>{
  const {db,vault,invoice}=fixture();let current=true;const calls:string[]=[];
  const other='66666666-6666-4666-8666-666666666666';
  try {
    db.prepare('INSERT INTO companies VALUES(2,?)').run(other);
    vault.assignments.push({companyKey:`vrbaker:${other}`,localCompanyId:2,companyName:'Other',assignedAt:vault.updatedAt});
    for(let n=0;n<50;n++)vault.invoices.push({...invoice,id:`invoice_${n}`,sequenceNumber:3000+n,reference:`TGBL-${3000+n}`});
    const client={request:async(action:string,payload?:any)=>{
      calls.push(action);
      if(action==='billing.stage'){assert.equal(payload.company_id,company);current=false;}
      return action==='billing.status'?{sync_enabled:true,protocol_version:2}:true;
    }};
    const result=await publishProtectedBillingVault(db,vault,client,new Map(),{
      shouldContinue:()=>current,
      prepareDocuments:async()=>new Map(vault.invoices.filter(i=>!i.testDocument).map(i=>[i.id,'verified_portal_file_123'])),
    });
    assert.deepEqual(result,{published:1,skipped:true});
    assert.deepEqual(calls,['billing.status','billing.stage','billing.stage','billing.commit']);
  }finally{db.close();}
});

test('publication priority follows encrypted receipt identities, including zero cancellations and credit-only operator payments',()=>{
  const {db,vault,invoice}=fixture();try {
    const operation='receipt_operation';
    vault.driverCashReceipts=[{rootId:'root',companyKey:invoice.companyKey,issuerCode:'goodness',amountPence:0,paymentIds:[],operations:[{operationId:operation,request:'{}',revision:2,amountPence:0}]}];
    const pending:any={operationId:operation,vault,documents:[]};
    assert.deepEqual(protectedPublicationCompanyIds(pending),[company]);
    vault.driverCashReceipts=[];
    vault.payments.push({id:'payment',operationId:operation,companyKey:invoice.companyKey,issuerCode:'goodness',invoiceId:null,amount:5,paymentDate:'2026-09-28',method:'cash',notes:null,createdAt:vault.updatedAt,reversedAt:null,reversalReason:null,testEntry:false});
    assert.deepEqual(protectedPublicationCompanyIds(pending),[company]);
    vault.payments=[];pending.documents=[{type:'invoice',id:invoice.id}];
    assert.deepEqual(protectedPublicationCompanyIds(pending),[company]);
    invoice.companyKey='local:1';assert.deepEqual(protectedPublicationCompanyIds(pending),[]);
  }finally{db.close();}
});

test('losing Writer authorization or cloud scope during staging prevents the financial commit',async()=>{
 const {db,vault}=fixture();let allowed=true;const calls:string[]=[];
 try {
  await assert.rejects(publishProtectedBillingVault(db,vault,{request:async(action:string)=>{
   calls.push(action);if(action==='billing.stage')allowed=false;
   return action==='billing.status'?{sync_enabled:true,protocol_version:2}:true;
  }},new Map(),{assertCurrent:()=>{if(!allowed)throw Error('Writer scope changed');}}),/Writer scope changed/);
  assert.deepEqual(calls,['billing.status','billing.stage']);
 }finally{db.close();}
});

function confirmedFixture(t:any) {
 const f=fixture();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-publication-'));
 t.after(()=>{f.db.close();fs.rmSync(dir,{recursive:true,force:true});});
 const filename=path.join(dir,'confirmed.enc'),key=Buffer.alloc(32,7);
 const store=new ProtectedPublicationReceipts(filename,()=>key);
 const calls:Array<{action:string,payload:any,key?:string}>=[];
 const client={request:async(action:string,payload?:any,id?:string)=>{calls.push({action,payload,key:id});return action==='billing.status'?{sync_enabled:true,protocol_version:2}:true;}};
 const ids=new Map([[f.invoice.id,'protected_portal_pdf_123']]);
 return {...f,filename,key,store,calls,client,ids};
}
test('confirmed snapshot survives restart and emits only the control check, with encrypted receipts',async t=>{
 const f=confirmedFixture(t);const receipts=f.store.forScope('destination');
 await publishProtectedBillingVault(f.db,f.vault,f.client,f.ids,{receipts});f.calls.length=0;
 const restarted=new ProtectedPublicationReceipts(f.filename,()=>f.key).forScope('destination');
 assert.deepEqual(await publishProtectedBillingVault(f.db,f.vault,f.client,f.ids,{receipts:restarted}),{published:0,skipped:false});
 assert.deepEqual(f.calls.map(c=>c.action),['billing.status']);
 const disk=fs.readFileSync(f.filename,'utf8');for(const secret of [company,source,f.invoice.reference,'10000'])assert.equal(disk.includes(secret),false);
});
test('missing, corrupt or differently scoped confirmation cannot suppress work; explicit retry invalidates it',async t=>{
 const f=confirmedFixture(t);const data=prepareProtectedBillingDeliveries(f.db,f.vault,f.ids)[0];
 assert.equal(f.store.forScope('a').has(data),false);f.store.forScope('a').confirm(data);
 assert.equal(f.store.forScope('b').has(data),false);
 assert.equal(new ProtectedPublicationReceipts(f.filename,()=>Buffer.alloc(32,8)).forScope('a').has(data),false);
 fs.writeFileSync(f.filename,'corrupted');assert.equal(f.store.forScope('a').has(data),false);
 f.store.forScope('a').confirm(data);f.store.clear();assert.equal(f.store.forScope('a').has(data),false);
});
test('all final snapshot fields and identity participate in confirmation',async t=>{
 const f=confirmedFixture(t),receipts=f.store.forScope('destination'),data=prepareProtectedBillingDeliveries(f.db,f.vault,f.ids)[0];receipts.confirm(data);
 for(const update of [(d:any)=>d.revision++,(d:any)=>d.credit++,(d:any)=>d.source_id=store,(d:any)=>d.company_id=store,(d:any)=>d.deleted.push('99'),(d:any)=>d.invoices[0].drive_file_id='replacement_pdf_123',(d:any)=>d.invoices[0].paid++,(d:any)=>d.invoices[0].due_date='2026-10-01',(d:any)=>d.invoices[0].cancelled=true]){
  const changed=structuredClone(data);update(changed);assert.equal(receipts.has(changed),false);
 }
 assert.equal(publicationFingerprint({...data,deleted:[...data.deleted].reverse()}),publicationFingerprint(data));
});
test('lost commit response retries the same keys and applies the server effect only once',async t=>{
 const f=confirmedFixture(t);const receipts=f.store.forScope('destination');let lose=true,effects=0;const committed=new Set<string>();
 const client={request:async(action:string,payload?:any,key?:string)=>{
  f.calls.push({action,payload,key});if(action==='billing.status')return {sync_enabled:true,protocol_version:2};
  if(action==='billing.commit') {if(!committed.has(key!)){effects++;committed.add(key!);}if(lose){lose=false;throw Error('Response lost');}}return true;
 }};
 await assert.rejects(publishProtectedBillingVault(f.db,f.vault,client,f.ids,{receipts}),/Response lost/);
 assert.equal(receipts.has(prepareProtectedBillingDeliveries(f.db,f.vault,f.ids)[0]),false);
 await publishProtectedBillingVault(f.db,f.vault,client,f.ids,{receipts});assert.equal(effects,1);
 const keys=f.calls.filter(c=>c.action==='billing.commit').map(c=>c.key);assert.equal(keys[0],keys[1]);
 f.calls.length=0;await publishProtectedBillingVault(f.db,f.vault,client,f.ids,{receipts});assert.deepEqual(f.calls.map(c=>c.action),['billing.status']);
});
test('stage failure, negative commit and malformed commit never become confirmed',async t=>{
 const f=confirmedFixture(t),receipts=f.store.forScope('destination');
 for(const mode of ['stage','false','invalid']) {
  await assert.rejects(publishProtectedBillingVault(f.db,f.vault,{request:async(action:string)=>{
   if(action==='billing.status')return {sync_enabled:true,protocol_version:2};
   if(action==='billing.stage' && mode==='stage')throw Error('Unavailable');
   if(action==='billing.commit')return mode==='false'?false:{success:true};return true;
  }} as any,f.ids,{receipts}));
  assert.equal(receipts.has(prepareProtectedBillingDeliveries(f.db,f.vault,f.ids)[0]),false);
 }
});
test('a new revision arriving during a commit is not marked as confirmed',async t=>{
 const f=confirmedFixture(t),receipts=f.store.forScope('destination');
 await publishProtectedBillingVault(f.db,f.vault,{request:async(action:string)=>{
  if(action==='billing.status')return {sync_enabled:true,protocol_version:2};
  if(action==='billing.commit'){f.vault.revision++;f.invoice.paidAmount+=1;}return true;
 }} as any,f.ids,{receipts});
 assert.equal(receipts.has(prepareProtectedBillingDeliveries(f.db,f.vault,f.ids)[0]),false);
 await publishProtectedBillingVault(f.db,f.vault,f.client,f.ids,{receipts});assert.ok(f.calls.some(c=>c.action==='billing.commit'));
});
test('document preparation occurs before suppression and changed PDF cannot reuse old confirmation',async t=>{
 const f=confirmedFixture(t),receipts=f.store.forScope('destination');
 await publishProtectedBillingVault(f.db,f.vault,f.client,f.ids,{receipts});f.calls.length=0;let prepared=0;
 await publishProtectedBillingVault(f.db,f.vault,f.client,new Map(),{receipts,prepareDocuments:async()=>{prepared++;return new Map([[f.invoice.id,'replacement_pdf_123']]);}});
 assert.equal(prepared,1);assert.ok(f.calls.some(c=>c.action==='billing.stage'&&c.payload.invoices[0].drive_file_id==='replacement_pdf_123'));
});
test('confirmation write failure preserves the retry and does not claim a completed publication',async t=>{
 const f=confirmedFixture(t);const receipts={has:()=>false,confirm:()=>{throw Error('Disk unavailable');}};
 await assert.rejects(publishProtectedBillingVault(f.db,f.vault,f.client,f.ids,{receipts}),/Disk unavailable/);
 assert.equal(f.calls.filter(c=>c.action==='billing.commit').length,1);
});

test('partial multi-part staging never confirms a company and retries identical part keys',async t=>{
 const f=confirmedFixture(t),receipts=f.store.forScope('destination');
 for(let n=0;n<50;n++)f.vault.invoices.push({...f.invoice,id:`extra_${n}`,sequenceNumber:4000+n,reference:`TGBL-${4000+n}`});
 let fail=true;const client={request:async(action:string,payload?:any,key?:string)=>{
  f.calls.push({action,payload,key});if(action==='billing.status')return {sync_enabled:true,protocol_version:2};
  if(action==='billing.stage'&&payload.part===1&&fail){fail=false;throw Error('Second part unavailable');}return true;
 }};
 await assert.rejects(publishProtectedBillingVault(f.db,f.vault,client,f.ids,{receipts}),/Second part/);
 assert.equal(receipts.has(prepareProtectedBillingDeliveries(f.db,f.vault,f.ids)[0]),false);
 await publishProtectedBillingVault(f.db,f.vault,client,f.ids,{receipts});
 assert.equal(f.calls.filter(c=>c.action==='billing.commit').length,1);
 const parts=f.calls.filter(c=>c.action==='billing.stage').map(c=>c.key);assert.deepEqual(parts.slice(0,2),parts.slice(2));
});
test('a destination switch after commit cannot persist confirmation for the previous context',async t=>{
 const f=confirmedFixture(t),receipts=f.store.forScope('destination');let allowed=true;
 await assert.rejects(publishProtectedBillingVault(f.db,f.vault,{request:async(action:string)=>{
  if(action==='billing.status')return {sync_enabled:true,protocol_version:2};if(action==='billing.commit')allowed=false;return true;
 }} as any,f.ids,{receipts,assertCurrent:()=>{if(!allowed)throw Error('Destination changed');}}),/Destination changed/);
 assert.equal(receipts.has(prepareProtectedBillingDeliveries(f.db,f.vault,f.ids)[0]),false);
});
