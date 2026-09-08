import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {syncSingleInvoicePdf,trashConfirmedInvoiceCopy,type InvoicePdfCopy} from './singleInvoiceDriveDocument.ts';

const root='invoice_root_123',parent='invoice_client_123',sourceId='11111111-1111-4111-8111-111111111111';
const short='Invoice_TGB-42.pdf',old='Factura_TGB-42.pdf';
const technical=`Invoice_${sourceId}_42_35_aaaaaaaaaaaaaaaa.pdf`;
const original=Buffer.from('%PDF-1.7\noriginal invoice\n%%EOF');
const edited=Buffer.from('%PDF-1.7\nchanged invoice\n%%EOF');
const checksum=(b:Buffer)=>createHash('md5').update(b).digest('hex');
const pdf=(id:string,name:string,bytes=original)=>({id,name,parents:[parent],mimeType:'application/pdf',md5Checksum:checksum(bytes),size:String(bytes.length)});
function fixture(initial:any[]=[]) {
  const records=new Map<string,any>([[parent,{id:parent,name:'Facturi',mimeType:'application/vnd.google-apps.folder',parents:[root]}],...initial.map(f=>[f.id,f] as [string,any])]);
  const writes:any[]=[];let remembered:{fileId:string|null;copies:InvoicePdfCopy[]}={fileId:null,copies:[]};let lose=false;let corrupt=false;
  const save=async(args:any)=>{
    writes.push(args);
    const id=args.fileId||'new_invoice_123';
    let row={...(records.get(id)||{id,mimeType:'application/pdf'}),...args.requestBody};
    if(args.addParents)row.parents=[args.addParents];
    if(args.media){const chunks:Buffer[]=[];for await(const b of args.media.body)chunks.push(b);const bytes=Buffer.concat(chunks);row={...row,size:String(bytes.length),md5Checksum:corrupt?'incorrect':checksum(bytes)}}
    records.set(id,row);
    if(lose){lose=false;throw new Error('response lost')}
    return {data:{...row}};
  };
  const drive={files:{
    get:async({fileId}:any)=>{if(!records.has(fileId))throw new Error('missing');return {data:{...records.get(fileId)}}},
    list:async({q}:any)=>({data:{files:[...records.values()].filter(f=>{
      if(f.trashed)return false;
      if(q.includes(' in parents'))return q.includes(`'${f.parents?.[0]}' in parents`);
      return q.includes(`name='${f.name}'`)||[...q.matchAll(/name contains '([^']+)'/g)].some(m=>f.name.startsWith(m[1]));
    })}}),
    create:save,update:save,
  }};
  const input={rootId:root,parentId:parent,filenames:[short,old],buffer:original,sourceId,invoiceId:42,assertCurrent:()=>{},
    remember:(fileId:string|null,copies:InvoicePdfCopy[])=>{remembered={fileId,copies}}};
  const run=()=>syncSingleInvoicePdf(drive,{...input,fileId:remembered.fileId,previousCopies:remembered.copies});
  return {records,drive,input,writes,run,remembered:()=>remembered,known:(fileId:string)=>{remembered.fileId=fileId},lose:()=>{lose=true},corrupt:()=>{corrupt=true}};
}

test('new invoices create only Invoice_NUMBER.pdf and an unchanged save does not write again',async()=>{
  const f=fixture();const first=await f.run();await f.run();
  assert.equal(first.fileId,'new_invoice_123');assert.equal(f.writes.length,1);
  assert.equal(f.records.get(first.fileId).name,short);
  f.input.buffer=edited;const next=await f.run();assert.equal(next.fileId,first.fileId);assert.equal(f.writes.length,2);
});
test('legacy readable invoice is renamed/moved in place, without a technical copy',async()=>{
  const f=fixture([{...pdf('legacy_invoice_123',old),parents:[root]}]);
  const result=await f.run();assert.equal(result.fileId,'legacy_invoice_123');
  assert.equal(f.records.get(result.fileId).name,short);assert.deepEqual(f.records.get(result.fileId).parents,[parent]);
  assert.equal(f.writes.length,1);assert.equal(f.remembered().copies.length,0);
});
test('migration preserves the published technical ID and defers retirement of the verified duplicate',async()=>{
  const f=fixture([pdf('published_invoice_123',technical),pdf('readable_invoice_123',old)]);f.known('published_invoice_123');
  const result=await f.run();assert.equal(result.fileId,'published_invoice_123');assert.equal(f.records.get(result.fileId).name,short);
  assert.equal(f.records.get('readable_invoice_123').trashed,undefined);
  assert.deepEqual(f.remembered().copies.map(x=>x.id),['readable_invoice_123']);
  f.input.buffer=edited;await f.run();await f.run(); // retry after rename + subsequent edit
  assert.equal(f.writes.length,2);
  await trashConfirmedInvoiceCopy(f.drive,root,f.remembered().copies[0],()=>{});
  assert.equal(f.records.get('readable_invoice_123').trashed,true);
  assert.equal(f.records.get(result.fileId).trashed,undefined);
});
test('response loss during create or technical rename recovers the same ID and pending cleanup',async()=>{
  for(const initial of [[],[pdf('published_invoice_123',technical),pdf('readable_invoice_123',old)]]){
    const f=fixture(initial);f.lose();await assert.rejects(f.run(),/response lost/);
    const result=await f.run();assert.equal(f.records.get(result.fileId).name,short);
    assert.equal(f.writes.length,1);assert.equal(f.remembered().copies.length,initial.length?1:0);
  }
});
test('other Writer/invoice snapshots are untouched and ambiguous or mismatched readable files fail closed',async()=>{
  const stranger=technical.replace('_42_','_420_');
  const f=fixture([pdf('other_invoice_123',stranger)]);await f.run();assert.equal(f.records.get('other_invoice_123').name,stranger);
  for(const rows of [[pdf('first_invoice_123',old),pdf('second_invoice_123',short)],
    [pdf('published_invoice_123',technical),pdf('readable_invoice_123',old,edited)]]){
    const bad=fixture(rows);await assert.rejects(bad.run(),/mai multe|conținut diferit/);assert.equal(bad.writes.length,0);
  }
});
test('stale Writer, missing associated ID, and failed content verification cannot report successful publication',async()=>{
  const stale=fixture([pdf('published_invoice_123',technical)]);stale.input.assertCurrent=()=>{throw new Error('stale')};
  await assert.rejects(stale.run(),/stale/);assert.equal(stale.writes.length,0);
  const missing=fixture();missing.known('missing_invoice_123');await assert.rejects(missing.run(),/lipsește/);assert.equal(missing.writes.length,0);
  const bad=fixture();bad.corrupt();await assert.rejects(bad.run(),/Checksum/);
});
test('cleanup is recoverable/idempotent and stops on changed metadata or publication/role guard',async()=>{
  const f=fixture([pdf('published_invoice_123',technical),pdf('readable_invoice_123',old)]);await f.run();const copy=f.remembered().copies[0];
  await assert.rejects(trashConfirmedInvoiceCopy(f.drive,root,copy,()=>{throw new Error('not published')}),/not published/);
  f.records.get(copy.id).name='Changed.pdf';await assert.rejects(trashConfirmedInvoiceCopy(f.drive,root,copy,()=>{}),/s-a schimbat/);
  f.records.get(copy.id).name=copy.name;f.lose();await assert.rejects(trashConfirmedInvoiceCopy(f.drive,root,copy,()=>{}),/response lost/);
  const count=f.writes.length;await trashConfirmedInvoiceCopy(f.drive,root,copy,()=>{});assert.equal(f.writes.length,count);
});
test('global name search excludes other roots and refuses truncated discovery or invalid PDF before writes',async()=>{
  const other='unrelated_root_123';
  const f=fixture([{id:other,name:'Other',mimeType:'application/vnd.google-apps.folder',parents:[]},{...pdf('unrelated_pdf_123',short),parents:[other]}]);
  await f.run();assert.equal(f.records.get('unrelated_pdf_123').name,short);assert.equal(f.records.get('unrelated_pdf_123').md5Checksum,checksum(original));
  assert.equal(f.remembered().copies.length,0);assert.equal(f.remembered().fileId,'new_invoice_123');
  const truncated=fixture();truncated.drive.files.list=async()=>({data:{files:[],nextPageToken:'more'}});
  await assert.rejects(truncated.run(),/Prea multe/);assert.equal(truncated.writes.length,0);
  const invalid=fixture();invalid.input.buffer=Buffer.from('not PDF');await assert.rejects(invalid.run(),/nu este valid/);assert.equal(invalid.writes.length,0);assert.equal(invalid.remembered().fileId,null);
});
