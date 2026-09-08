import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { updateInvoiceDriveDocument, withInvoiceDriveLock } from './invoiceDriveDocument.ts';

const rootId = 'invoice_root_123';
const companyId = 'company_folder_123';
const parentId = 'client_invoices_123';
const name = 'Factura_TGB-42.pdf';
const buffer = Buffer.from('%PDF-1.7\nfixture updated invoice\n%%EOF');
const md5 = createHash('md5').update(buffer).digest('hex');
const folder = (id: string, parents: string[] = []) => ({ id, parents, mimeType: 'application/vnd.google-apps.folder' });
const pdf = (id: string, parent = rootId, filename = name) => ({ id, parents: [parent], name: filename, mimeType: 'application/pdf', size: '1', md5Checksum: 'old' });

function fixture(initial: any[] = [pdf('existing_pdf_123')]) {
  const records = new Map<string, any>([
    [companyId, folder(companyId, [rootId])], [parentId, folder(parentId, [companyId])],
    ['other_root_123', folder('other_root_123')], ...initial.map(row => [row.id, row] as [string, any]),
  ]);
  const writes: {kind: string; args: any}[] = [];
  let listError: Error | undefined;
  let truncated = false;
  let responseLost = false;
  let wrongChecksum = false;
  const commit = async (kind: string, args: any) => {
    writes.push({kind,args});
    const chunks: Buffer[] = [];
    for await (const chunk of args.media.body) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), buffer);
    const id = args.fileId || 'created_pdf_123';
    const row = records.get(id) || { id, ...args.requestBody, mimeType: 'application/pdf' };
    records.set(id, { ...row, parents: args.addParents ? [args.addParents] : row.parents,
      size: String(buffer.length), md5Checksum: wrongChecksum ? 'different' : md5 });
    if (responseLost) { responseLost = false; throw new Error('response lost'); }
    return {data:{id}};
  };
  const drive = { files: {
    list: async (args: any) => {
      if (listError) throw listError;
      assert.match(args.q, /trashed=false/);
      return {data:{files: [...records.values()].filter(row => row.name && args.q.includes(`name='${row.name}'`)), nextPageToken: truncated ? 'more' : undefined}};
    },
    get: async ({fileId}: any) => {
      if (!records.has(fileId)) throw new Error('missing resource');
      return {data:{...records.get(fileId)}};
    },
    update: async (args: any) => commit('update',args),
    create: async (args: any) => commit('create',args),
  }};
  const input = {rootId,parentId,filenames:[name,'Factura_TGB_42.pdf'],buffer,assertCurrent:()=>{}};
  return {drive,input,writes,records,
    failList:()=>{listError=new Error('permission denied');},
    truncate:()=>{truncated=true;}, loseResponse:()=>{responseLost=true;}, corrupt:()=>{wrongChecksum=true;},
  };
}

test('existing legacy root PDF is updated and moved in one request, retaining ID/name/link',async()=>{
  const f=fixture();
  const result=await updateInvoiceDriveDocument(f.drive,f.input);
  assert.equal(result.fileId,'existing_pdf_123');
  assert.equal(result.md5Checksum,md5);
  assert.equal(f.writes.length,1);
  assert.equal(f.writes[0].kind,'update');
  assert.equal(f.writes[0].args.fileId,'existing_pdf_123');
  assert.equal(f.writes[0].args.addParents,parentId);
  assert.equal(f.writes[0].args.removeParents,rootId);
  assert.equal(f.writes[0].args.requestBody,undefined);
  assert.equal(f.records.get(result.fileId).name,name);
});

test('Credit Note in a resolved legacy issuer folder moves without replacing its ID',async()=>{
  const legacy='legacy_credits_123'; const filename='Credit_Note_CN-1.pdf';
  const f=fixture([pdf('old_credit_123',legacy,filename)]);
  const result=await updateInvoiceDriveDocument(f.drive,{...f.input,filenames:[filename],legacyRootIds:[legacy]});
  assert.equal(result.fileId,'old_credit_123');
  assert.equal(f.writes.length,1);
  assert.equal(f.writes[0].kind,'update');
  assert.equal(f.writes[0].args.addParents,parentId);
  assert.equal(f.writes[0].args.removeParents,legacy);
});

test('PDF already in client folder is updated without moving or creating',async()=>{
  const f=fixture([pdf('existing_pdf_123',parentId)]);
  await updateInvoiceDriveDocument(f.drive,f.input);
  assert.equal(f.writes[0].kind,'update');
  assert.equal(f.writes[0].args.addParents,undefined);
  assert.equal(f.writes[0].args.removeParents,undefined);
});

test('historical issuer subfolder and separate series filename retain the same file',async()=>{
  const f=fixture([folder('issuer_folder_123',[rootId]),pdf('existing_pdf_123','issuer_folder_123','Factura_TGB_42.pdf')]);
  const result=await updateInvoiceDriveDocument(f.drive,f.input);
  assert.equal(result.fileId,'existing_pdf_123');
  assert.equal(f.records.get(result.fileId).name,'Factura_TGB_42.pdf');
  assert.equal(f.writes[0].args.removeParents,'issuer_folder_123');
});

test('new invoice creates one readable PDF; subsequent save updates the same ID',async()=>{
  const f=fixture([]);
  const first=await updateInvoiceDriveDocument(f.drive,f.input);
  const second=await updateInvoiceDriveDocument(f.drive,f.input);
  assert.equal(first.fileId,second.fileId);
  assert.deepEqual(f.writes.map(row=>row.kind),['create','update']);
  assert.equal(f.writes[0].args.requestBody.name,name);
});

test('same name outside configured invoice root is never overwritten or moved',async()=>{
  const f=fixture([pdf('unrelated_pdf_123','other_root_123')]);
  await updateInvoiceDriveDocument(f.drive,f.input);
  assert.equal(f.writes[0].kind,'create');
  assert.equal(f.records.get('unrelated_pdf_123').md5Checksum,'old');
});

test('duplicate or truncated matching files stop before any write',async()=>{
  for (const rows of [[pdf('existing_pdf_123'),pdf('duplicate_pdf_123',parentId)],
    [pdf('existing_pdf_123'),pdf('variant_pdf_123',parentId,'Factura_TGB_42.pdf')]]) {
    const f=fixture(rows);
    await assert.rejects(updateInvoiceDriveDocument(f.drive,f.input),/mai multe PDF-uri/);
    assert.equal(f.writes.length,0);
  }
  const f=fixture();f.truncate();
  await assert.rejects(updateInvoiceDriveDocument(f.drive,f.input),/Prea multe/);
  assert.equal(f.writes.length,0);
});

test('missing permission, non-PDF and unverifiable destination never create replacement duplicates',async()=>{
  const denied=fixture();denied.failList();
  const nonPdf=fixture([{...pdf('existing_pdf_123'),mimeType:'application/vnd.google-apps.shortcut'}]);
  const outside=fixture();outside.input.parentId='other_root_123';
  for (const f of [denied,nonPdf,outside]) {
    await assert.rejects(updateInvoiceDriveDocument(f.drive,f.input));
    assert.equal(f.writes.length,0);
  }
});

test('invalid generated PDF and stale invoice/Writer stop before mutation',async()=>{
  const invalid=fixture();invalid.input.buffer=Buffer.from('not a pdf');
  const stale=fixture();stale.input.assertCurrent=()=>{throw new Error('stale invoice');};
  for (const f of [invalid,stale]) {
    await assert.rejects(updateInvoiceDriveDocument(f.drive,f.input));
    assert.equal(f.writes.length,0);
  }
});

test('remote checksum mismatch is not reported as a successful upload',async()=>{
  const f=fixture();f.corrupt();
  await assert.rejects(updateInvoiceDriveDocument(f.drive,f.input),/Checksum/);
});

test('response loss after provider create or update recovers without duplicate files',async()=>{
  for (const initial of [[],[pdf('existing_pdf_123')]]) {
    const f=fixture(initial);f.loseResponse();
    await assert.rejects(updateInvoiceDriveDocument(f.drive,f.input),/response lost/);
    const result=await updateInvoiceDriveDocument(f.drive,f.input);
    assert.ok(result.fileId);
    assert.equal(f.writes[1].kind,'update');
    assert.equal([...f.records.values()].filter(row=>row.name===name).length,1);
  }
});

test('invoice uploads serialize including authoritative reads and recover after a failed upload',async()=>{
  const order:string[]=[];
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const first=withInvoiceDriveLock(1,async()=>{order.push('first read');await gate;order.push('first write');throw new Error('failed');});
  const rejected=assert.rejects(first,/failed/);
  const second=withInvoiceDriveLock(1,async()=>{order.push('second read');order.push('second write');return 'ok';});
  await withInvoiceDriveLock(2,async()=>{order.push('unrelated');});
  assert.deepEqual(order,['first read','unrelated']);
  release();await rejected;
  assert.equal(await second,'ok');
  assert.deepEqual(order,['first read','unrelated','first write','second read','second write']);
});

test('main keeps current document checks, verified working copy, and separate platform revision references',()=>{
  const source=readFileSync(new URL('../database/cloudSync.ts',import.meta.url),'utf8');
  const upload=source.slice(source.indexOf('export async function uploadInvoicePdf'),source.indexOf('export async function reconcileInvoicePdfs'));
  assert.match(upload,/withInvoiceDriveLock\(invoiceId, \(\) => trackDocumentUpload/);
  assert.match(upload,/\(\) => uploadCurrentInvoicePdf\(invoiceId\)/);
  assert.match(upload,/getDeviceRole\(\) !== 'writer'/);
  assert.match(upload,/current.document_revision !== inv.document_revision/);
  assert.ok(upload.indexOf('await updateInvoiceDriveDocument') < upload.indexOf('UPDATE invoices SET drive_file_id'));
  assert.match(upload,/Invoice_\$\{source_id\}_\$\{invoiceId\}_\$\{inv.document_revision\}_\$\{hash\}/);
});
