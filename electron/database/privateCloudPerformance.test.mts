import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import ts from 'typescript';
import { withPrivateCloudOperation, resolvePrivateFolderInOperation } from '../integrations/privateCloudOperation.ts';
import { assertUploadedFileMatches } from './cloudSyncPolicy.ts';

function harness() {
  const source = readFileSync(new URL('./cloudSync.ts', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('async function fetchUploadedMetadata'), source.indexOf('export async function saveToCloud')).replaceAll('export ', '');
  const state = { folders: 0, creates: 0, lists: 0, uploads: 0, role: 'writer', corrupt: false, version: '1', tokens: true };
  let bytes = Buffer.from('encrypted fixture');
  const metadata = () => ({ id: 'file', name: 'fixture.vault', mimeType: 'application/octet-stream', version: state.version, parents: ['folder'], md5Checksum: state.corrupt ? 'wrong' : createHash('md5').update(bytes).digest('hex'), size: String(bytes.length) });
  const drive = { files: {
    list: async () => { state.lists++; return { data: { files: [metadata()] } }; },
    get: async (args: any) => ({ data: args.alt === 'media' ? bytes : metadata() }),
    update: async (args: any) => { const chunks = []; for await (const chunk of args.media.body) chunks.push(chunk); bytes = Buffer.concat(chunks); state.uploads++; state.version = String(Number(state.version) + 1); return { data: { id: 'file' } }; },
  } };
  const oauth2Client = { credentials: { refresh_token: 'synthetic-account' } };
  const bindings = {
    createHash, Readable, Buffer, resolvePrivateFolderInOperation, oauth2Client,
    findFolder: async () => { state.folders++; return 'folder'; }, getOrCreateFolder: async () => { state.folders++; state.creates++; return 'folder'; },
    getDeviceRole: () => state.role, loadTokens: () => state.tokens,
    google: { drive: () => drive }, CLOUD_ROOT_FOLDER_NAME: 'VR - Management',
    escapeDriveQueryValue: (s: string) => s, InvoiceDriveDocumentError: Error,
    publicGoogleDriveError: (_error: unknown, fallback: string) => fallback,
    assertUploadedFileMatches, documentRequestOptions: { timeout: 30000, retry: false },
  };
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const api = new Function(...Object.keys(bindings), compiled + '\nreturn {readVerifiedPrivateCloudFile, writeVerifiedPrivateCloudFile, readProtectedViewerVault};')(...Object.values(bindings));
  const read = () => api.readVerifiedPrivateCloudFile(['Duplicat'], 'fixture.vault');
  const write = (expectedVersion: string) => api.writeVerifiedPrivateCloudFile({ folderNames: ['Duplicat'], filename: 'fixture.vault', mimeType: 'application/octet-stream', buffer: Buffer.from(`next encrypted fixture ${expectedVersion}`), expectedVersion });
  const writeSame = (expectedVersion: string) => api.writeVerifiedPrivateCloudFile({ folderNames: ['Duplicat'], filename: 'fixture.vault', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes), expectedVersion });
  return { state, oauth2Client, read, write, writeSame, readViewer: () => api.readProtectedViewerVault() };
}

test('Viewer reads the fixed encrypted vault without creating folders or uploading, and cannot use Writer primitives', async () => {
  const h = harness(); h.state.role = 'viewer';
  const file = await h.readViewer(); assert.ok(file.buffer.length);
  assert.equal(h.state.creates, 0); assert.equal(h.state.uploads, 0);
  await assert.rejects(h.read(), /Viewer/);
  await assert.rejects(h.write('1'), /Viewer/);
  h.state.corrupt = true; await assert.rejects(h.readViewer());
  assert.equal(h.state.creates, 0); assert.equal(h.state.uploads, 0);
});

test('real private Drive adapter resolves folders once per operation, but reads file versions afresh', async () => {
  const h = harness();
  await withPrivateCloudOperation(async () => {
    for (let i = 0; i < 5; i++) await h.read();
    await h.write('1'); await h.write('2'); await h.write('3');
  });
  assert.equal(h.state.folders, 2, 'root and Duplicat resolved once, not 16 folder requests');
  assert.equal(h.state.lists, 8, 'one fresh file lookup per read/write, not 11');
  assert.equal(h.state.uploads, 3);
  await withPrivateCloudOperation(() => h.read());
  assert.equal(h.state.folders, 4, 'no folder IDs carried into the next operation');
});

test('verified private Drive upload reuses an identical file without rewriting it', async () => {
  const h = harness();
  const result = await h.writeSame('1');
  assert.equal(result.fileId, 'file');
  assert.equal(h.state.uploads, 0);
  assert.equal(h.state.lists, 1);
});

test('private Drive retains version/checksum/Writer guards and isolates changed accounts', async () => {
  const h = harness();
  await assert.rejects(h.write('stale'), /Registrul a fost modificat/);
  assert.equal(h.state.uploads, 0);
  h.state.corrupt = true;
  await assert.rejects(h.read());
  h.state.corrupt = false;
  await withPrivateCloudOperation(async () => {
    await h.read(); const count = h.state.folders;
    h.oauth2Client.credentials.refresh_token = 'different-synthetic-account';
    await h.read(); assert.equal(h.state.folders, count + 2);
    h.state.role = 'viewer';
    await assert.rejects(h.read(), /Viewer/); await assert.rejects(h.write('1'), /Viewer/);
  });
  assert.equal(h.state.uploads, 0);
});
