import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyInvoiceFilenames, resolveExistingInvoiceFolder } from './invoiceDriveFolder.ts';

const rootId='root_folder_123';
const invoiceId='invoice_folder_123';
test('configured existing folder uses its ID without discovery or creation',async()=>{
 const calls:any[]=[];
 const drive={files:{get:async(args:any)=>{calls.push(args);return {data:{mimeType:'application/vnd.google-apps.folder',trashed:false}};}}};
 assert.equal(await resolveExistingInvoiceFolder(drive,invoiceId),invoiceId);
 assert.equal(calls[0].fileId,invoiceId);
});
test('configured missing, trashed or non-folder resources are rejected',async()=>{
 await assert.rejects(resolveExistingInvoiceFolder({},"bad'id"));
 for(const data of [{trashed:true,mimeType:'application/vnd.google-apps.folder'},{mimeType:'application/pdf'}]){
  await assert.rejects(resolveExistingInvoiceFolder({files:{get:async()=>({data})}},invoiceId));
 }
});
test('discovers legacy root and existing Facturi without creating folders',async()=>{
 const queries:string[]=[];
 const drive={files:{list:async(args:any)=>{queries.push(args.q);return {data:{files:[{id:queries.length===1?rootId:invoiceId}]}};}}};
 assert.equal(await resolveExistingInvoiceFolder(drive),invoiceId);
 assert.match(queries[0],/VR - Management/);
 assert.match(queries[1],new RegExp(`'${rootId}' in parents`));
});
test('missing, ambiguous and truncated folder discovery fails closed',async()=>{
 for(const data of [{files:[]},{files:[{id:invoiceId},{id:'second_folder_123'}]},{files:[{id:invoiceId}],nextPageToken:'more'}]){
  let calls=0;
  await assert.rejects(resolveExistingInvoiceFolder({files:{list:async()=>({data:++calls===1?{files:[{id:rootId}]}:data})}}));
 }
});
test('legacy filename variants include observed historical format and reject paths',()=>{
 assert.ok(legacyInvoiceFilenames('TGB-1','TGB').includes('Factura_TGB-1.pdf'));
 assert.ok(legacyInvoiceFilenames('1','TGB').includes('Factura_TGB-1.pdf'));
 assert.ok(legacyInvoiceFilenames('1','TGB').includes('Factura_TGB_1.pdf'));
 assert.deepEqual(legacyInvoiceFilenames('../1','TGB'),[]);
});

test('new invoices reuse the existing company/Facturi layout',async()=>{
 const {resolveCompanyInvoiceFolder}=await import('./invoiceDriveFolder.ts');
 const queries:string[]=[];
 const folder=await resolveCompanyInvoiceFolder({files:{list:async(args:any)=>{queries.push(args.q);return {data:{files:[{id:queries.length===1?'company_folder_123':'client_invoices_123'}]}};}}},invoiceId,'Client One');
 assert.equal(folder,'client_invoices_123');assert.match(queries[0],/name='Client One'/);assert.match(queries[1],/name='Facturi'/);
});
test('historical inventory includes root and nested PDFs and ignores shortcuts',async()=>{
 const {listInvoiceTree}=await import('./invoiceDriveFolder.ts');
 const result=await listInvoiceTree({files:{list:async(args:any)=>({data:{files:args.q.includes(invoiceId)?[{id:'old_invoice_123',name:'old.pdf',mimeType:'application/pdf'},{id:'client_folder_123',name:'Client',mimeType:'application/vnd.google-apps.folder'}]:[{id:'new_invoice_123',name:'new.pdf',mimeType:'application/pdf'}]}})}},invoiceId);
 assert.deepEqual(result.map(f=>f.id),['old_invoice_123','new_invoice_123']);
});
