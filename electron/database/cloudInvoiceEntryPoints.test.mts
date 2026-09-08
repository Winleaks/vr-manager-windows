import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { legacyInvoiceFilenames } from '../integrations/invoiceDriveFolder.ts';
import { generateInvoicePDF } from '../../src/utils/pdfGenerator.ts';
import { assertUploadedFileMatches } from './cloudSyncPolicy.ts';

const requireBuiltin = createRequire(import.meta.url);
const source = readFileSync(new URL('./cloudSync.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;

// Execute the real cloudSync module, including its imports. All external IO and
// credentials are synthetic; a missing runtime db binding must fail this test.
function fixture() {
  let buffer = Buffer.from('%PDF-1.7\nsynthetic invoice\n%%EOF');
  const row = { id: 1, invoice_number: 'TGB-42', document_revision: 3,
    pdf_path: '/test/invoice.pdf', company_name: 'Fixture Company', drive_file_id: null as string | null };
  let role = 'writer'; let tokens = true; let corrupt = false;
  let afterList = () => {}; let afterMetadata = () => {};
  let files = [{ id: 'existing_pdf_123', name: 'Factura_TGB-42.pdf' }];
  const writes: unknown[][] = [];
  const connection = { open: true, prepare: (sql: string) => ({
    get: () => sql.includes('app_settings') ? { value: 'invoice_root_123' } : undefined,
    all: () => row.drive_file_id ? [] : [{ ...row }],
    run: (...args: unknown[]) => {
      assert.match(sql, /document_revision=\? AND drive_file_id IS NULL/);
      if (row.drive_file_id || row.document_revision !== args[2]) return { changes: 0 };
      row.drive_file_id = String(args[0]); writes.push(args); return { changes: 1 };
    },
  }) };
  const databaseModule = { db: connection, dbPath: '/test/fixture.db' };
  const mocks: Record<string, unknown> = {
    './db': databaseModule,
    '../integrations/driveFolderLock': { withDriveFolderLock: async (_parent: unknown, _name: unknown, action: () => unknown) => action() },
    './documentSyncQueue': { trackDocumentUpload: async (_db: unknown, _kind: unknown, _id: number, current: () => boolean, action: () => unknown) => current() ? action() : {success:false} },
    '../integrations/documentSyncErrors': { documentSyncFailure: () => ({success:false,error:'Controlled failure'}) },
    fs: { existsSync: (p: string) => p === row.pdf_path,
      statSync: () => ({ size: buffer.length }), readFileSync: () => buffer },
    electron: { app: { isPackaged: true, getPath: () => '/test' } },
    googleapis: { google: { auth: { OAuth2: class { on() {} setCredentials() {} } },
      drive: () => ({ files: { get: async () => { afterMetadata(); return { data: {
        md5Checksum: corrupt ? 'different' : createHash('md5').update(buffer).digest('hex'), size: String(buffer.length),
      } }; } } }) } },
    'google-auth-library': {},
    '../security/credentialStore': { getCredential: () => tokens ? '{}' : null },
    '../device/deviceRole': { getDeviceRole: () => role },
    '../integrations/invoiceDriveFolder': { legacyInvoiceFilenames,
      resolveExistingInvoiceFolder: async () => 'invoice_root_123',
      listInvoiceTree: async () => { afterList(); return files; } },
    '../integrations/invoiceDriveDocument': { withInvoiceDriveLock: async (_id: number, fn: () => unknown) => fn(),
      InvoiceDriveDocumentError: class extends Error {} },
    './repositories/billingRepo': { getInvoiceById: () => ({ status: 'cancelled' }) },
    '../../src/utils/pdfGenerator': {},
    '../security/fileValidation': { resolvePdfPath: (...parts: string[]) => parts.join('/') },
    '../reports/clientDocumentStorage': { localClientDocumentDirectory: () => '/test/company' },
    './cloudBackupSelection': {}, './cloudSyncPolicy': {},
  };
  const exports: Record<string, (...args: any[]) => Promise<any>> = {};
  runInNewContext(compiled, { exports, Buffer, console, process: { cwd: () => '/test' },
    __VR_HUB_GOOGLE_CLIENT_ID__: 'fixture', __VR_HUB_GOOGLE_CLIENT_SECRET__: 'fixture',
    require: (id: string) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (['path', 'crypto', 'http', 'stream', 'node:crypto', 'node:stream'].includes(id)) return requireBuiltin(id);
      throw new Error(`Unexpected module dependency: ${id}`);
    },
  });
  return { api: exports, writes, row,
    enableValidUpload: () => {
      let snapshot: any; let loseResponse = true; let created = 0; let workingWrites = 0;
      const originalPrepare = connection.prepare;
      connection.prepare = ((sql: string) => {
        if(sql.includes('app_settings')) return {get:()=>({value:'invoice_root_123'})};
        if(sql.includes('source_id')) return {get:()=>({source_id:'synthetic-source'})};
        if(sql.startsWith('SELECT document_revision')) return {get:()=>({...row,status:'issued'})};
        if(sql.startsWith('UPDATE invoices SET drive_file_id')) return {run:(id: string)=>{row.drive_file_id=id;return {changes:1}}};
        return originalPrepare(sql);
      }) as any;
      mocks['./repositories/billingRepo']={getInvoiceById:()=>({...row,status:'issued',invoice_date:'2026-09-08',issuer_settings:{invoiceSeries:'FIX'},items:[{productName:'Bread',quantity:1,unitPrice:2,totalPrice:2}],total_amount:2}),getAppSetting:()=>''};
      mocks['../../src/utils/pdfGenerator']={generateInvoicePDF:(...args: Parameters<typeof generateInvoicePDF>)=>{buffer=Buffer.from(generateInvoicePDF(...args));return buffer}};
      Object.assign(mocks['../integrations/invoiceDriveFolder'] as object,{resolveCompanyInvoiceFolder:async()=> 'company_folder_123'});
      Object.assign(mocks['../integrations/invoiceDriveDocument'] as object,{updateInvoiceDriveDocument:async()=>{workingWrites++}});
      // Imported module objects must retain identity; the production adapter reads
      // these fields after its async imports, just as in the real process.
      Object.assign(mocks['./cloudSyncPolicy'] as object,{assertUploadedFileMatches});
      const google=(mocks.googleapis as any).google;
      google.drive=()=>({files:{
        list:async({q}:any)=>({data:{files:snapshot && q.includes(snapshot.name)?[{id:snapshot.id}]:[]}}),
        create:async(input:any)=>{created++;snapshot={id:'snapshot_file_123',name:input.requestBody.name,parents:input.requestBody.parents,md5Checksum:createHash('md5').update(buffer).digest('hex'),size:String(buffer.length)};if(loseResponse){loseResponse=false;throw new Error('response lost')}return {data:{id:snapshot.id}}},
        get:async()=>({data:snapshot}),
      }});
      return { counts:()=>({created,workingWrites}) };
    },
    setRole: (value: string) => { role = value; }, disconnect: () => { tokens = false; },
    corrupt: () => { corrupt = true; }, duplicate: () => { files = [...files, { ...files[0], id: 'duplicate_pdf_123' }]; },
    switchDatabase: () => { afterList = () => { databaseModule.db = { ...connection }; }; },
    changeRevision: () => { afterMetadata = () => { row.document_revision++; }; },
    changeRoleDuringRead: () => { afterMetadata = () => { role = 'viewer'; }; },
  };
}

test('real PDF reconciliation entry point imports db, associates verified existing PDF and is repeatable', async () => {
  const f = fixture();
  assert.equal((await f.api.reconcileInvoicePdfs()).linked, 1);
  assert.equal(f.row.drive_file_id, 'existing_pdf_123');
  assert.equal((await f.api.reconcileInvoicePdfs()).linked, 0);
  assert.equal(f.writes.length, 1);
});

test('real valid upload retries response loss using the identical revision snapshot and confirms metadata', async () => {
  const f=fixture();const upload=f.enableValidUpload();
  assert.equal((await f.api.uploadInvoicePdf(1)).success,false);
  const result=await f.api.uploadInvoicePdf(1);
  assert.equal(result.success,true);
  assert.equal(f.row.drive_file_id,'snapshot_file_123');
  assert.deepEqual(upload.counts(),{created:1,workingWrites:2});
});

test('real upload entry point has a db binding and returns a controlled failure for cancelled invoice', async () => {
  const f = fixture();
  const result = await f.api.uploadInvoicePdf(1);
  assert.equal(result.success, false);
  assert.equal(f.writes.length, 0);
});

test('PDF reconciliation refuses Viewer/disconnected Writer without writes', async () => {
  for (const mode of ['viewer', 'disconnected']) {
    const f = fixture(); if (mode === 'viewer') f.setRole('viewer'); else f.disconnect();
    await assert.rejects(f.api.reconcileInvoicePdfs(), /Writer conectat/);
    assert.equal(f.writes.length, 0);
  }
});

test('PDF reconciliation does not link duplicate names or mismatched contents', async () => {
  for (const mode of ['duplicate', 'corrupt']) {
    const f = fixture(); f[mode as 'duplicate' | 'corrupt']();
    const result = await f.api.reconcileInvoicePdfs();
    assert.equal(result.linked, 0); assert.equal(result.unresolved[0], 1);
    assert.equal(f.writes.length, 0);
  }
});

test('PDF reconciliation preserves live database, Writer and revision guards across async work', async () => {
  const switched = fixture(); switched.switchDatabase();
  await assert.rejects(switched.api.reconcileInvoicePdfs(), /Baza de date s-a schimbat/);
  const viewer = fixture(); viewer.changeRoleDuringRead();
  await assert.rejects(viewer.api.reconcileInvoicePdfs(), /rolul s-a schimbat/);
  const revised = fixture(); revised.changeRevision();
  assert.equal((await revised.api.reconcileInvoicePdfs()).linked, 0);
  for (const f of [switched, viewer, revised]) assert.equal(f.writes.length, 0);
});
