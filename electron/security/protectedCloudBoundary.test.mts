import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

test('Drive account scope survives same-account reauthentication, changes for another account, and denies Viewer', async () => {
  const source = ts.createSourceFile('cloudSync.ts', readFileSync(new URL('../database/cloudSync.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const names = new Set(['protectedCloudGrant', 'initializeProtectedCloudScope', 'protectedCloudAccountScope', 'probeProtectedCloudFile']);
  const code = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text || '')).map(node => node.getText(source)).join('\n').replaceAll('export ', '');
  const state = { role: 'writer', connected: true, user: 'account-one', reads: 0, changeWhileReading: false, fileName: 'registru-separat.vault', editable: true };
  const oauth2Client = { credentials: { refresh_token: 'synthetic-grant-one' } };
  const bindings = { createHash, oauth2Client, documentRequestOptions: {}, getDeviceRole: () => state.role, loadTokens: () => state.connected,
    google: { drive: () => ({ about: { get: async () => { state.reads++; if (state.changeWhileReading) oauth2Client.credentials.refresh_token = 'changed'; return { data: { user: { permissionId: state.user } } }; } },
      files: { get: async ({ fileId }: any) => ({ data: { id: fileId, name: state.fileName, capabilities: { canEdit: state.editable } } }) } }) } };
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const api = new Function(...Object.keys(bindings), 'let protectedAccount = null;\n' + compiled + '\nreturn {initializeProtectedCloudScope, protectedCloudAccountScope, probeProtectedCloudFile};')(...Object.values(bindings));
  const first = await api.initializeProtectedCloudScope();
  assert.equal(api.protectedCloudAccountScope(), first);
  await api.initializeProtectedCloudScope(); assert.equal(state.reads, 1, 'identity cache is bound to current grant');
  oauth2Client.credentials.refresh_token = 'reauthenticated-grant';
  assert.throws(() => api.protectedCloudAccountScope(), /reverificat/);
  assert.equal(await api.initializeProtectedCloudScope(), first, 'pending work remains recoverable after reconnecting');
  await api.probeProtectedCloudFile('fixed-vault', first);
  state.editable = false; await assert.rejects(api.probeProtectedCloudFile('fixed-vault', first), /verificată/); state.editable = true;
  oauth2Client.credentials.refresh_token = 'other-grant'; state.user = 'account-two';
  assert.notEqual(await api.initializeProtectedCloudScope(), first);
  await assert.rejects(api.probeProtectedCloudFile('fixed-vault', first), /schimbat/);
  oauth2Client.credentials.refresh_token = 'next-grant'; state.changeWhileReading = true;
  await assert.rejects(api.initializeProtectedCloudScope(), /verificată/);
  state.role = 'viewer'; await assert.rejects(api.initializeProtectedCloudScope(), /Writer/);
});
