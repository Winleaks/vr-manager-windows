import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createEmptyProtectedVault } from '../protectedRegistry/types.ts';
import { createPinVerifier, verifyPin, encryptVault, decryptVault, recoverVaultKey, parseEnvelope, generateVaultKey, generateRecoveryKey } from '../protectedRegistry/crypto.ts';
import { registerFailedPinAttempt } from '../protectedRegistry/policy.ts';
import { isChannelAllowedForRole } from '../device/viewerPolicy.ts';

test('Viewer allowlist admits only explicit read/document/activation operations from all protected handlers', () => {
  const allowed = new Set(['status', 'activateViewer', 'refreshViewer', 'unlock', 'lock', 'touch', 'getOverview', 'getCompanies', 'getInvoices', 'getPayments', 'getCreditNotes', 'getCreditBalances', 'getCreditApplications', 'openDocument', 'shareDocument', 'printDocument']);
  const handlers = readFileSync(new URL('../ipc/protectedRegistryHandlers.ts', import.meta.url), 'utf8');
  for (const match of handlers.matchAll(/handleTrustedIpc\('protectedRegistry:([^']+)'/g)) {
    assert.equal(isChannelAllowedForRole('viewer', `protectedRegistry:${match[1]}`), allowed.has(match[1]), match[1]);
  }
  assert.equal(isChannelAllowedForRole('viewer', 'protectedRegistry:futureMutation'), false);
});

function fixture() {
  const source = ts.createSourceFile('service.ts', readFileSync(new URL('../protectedRegistry/service.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const names = new Set(['registryCredential', 'keyBuffer', 'readAuthState', 'saveAuthState', 'freshSession', 'activateProtectedViewer', 'refreshProtectedViewer', 'unlockProtectedRegistry', 'protectedPdfToTemporaryFile', 'storeTemporaryProtectedPdf', 'openProtectedDocument', 'printProtectedDocument', 'shareProtectedDocument']);
  const code = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text || '')).map(node => node.getText(source)).join('\n').replaceAll('export ', '');
  const vault = createEmptyProtectedVault();
  vault.invoices.push({ id: 'invoice', status: 'unpaid', reference: 'TEST-1', companyName: 'Synthetic', companyKey: 'a' } as any);
  vault.creditNotes.push({ id: 'note', status: 'issued', reference: 'CN-1' } as any);
  const recovery = generateRecoveryKey(), key = generateVaultKey();
  const envelope = encryptVault(Buffer.from(JSON.stringify(vault)), key, recovery, vault.revision);
  const state = { role: 'viewer', secure: true, reads: 0, files: 0, opened: 0, writes: 0, interrupt: false, revision: vault.revision, available: true };
  const credentials = new Map([['key', 'writer-credential-preserved'], ['auth', 'writer-auth-preserved']]);
  const sessions = new Map<number, any>(), sessionGenerations = new Map<number, number>();
  const forbidden = () => { state.writes++; throw Error('Unexpected Writer side effect'); };
  const bindings = {
    Buffer, KEY_CREDENTIAL: 'key', AUTH_CREDENTIAL: 'auth', SESSION_MS: 60000, MAX_ATTEMPTS: 5, LOCKOUT_MS: 900000,
    getDeviceRole: () => state.role, getCredential: (id: string) => credentials.get(id), setCredential: (id: string, value: string) => credentials.set(id, value),
    isCredentialStorageAvailable: () => state.secure, createPinVerifier, verifyPin, recoverVaultKey, decryptVault, parseEnvelope, registerFailedPinAttempt,
    parseVault: (bytes: Uint8Array) => JSON.parse(Buffer.from(bytes).toString()), sessions, sessionGenerations,
    setSession: (session: any) => { session.role ??= state.role; sessions.set(session.webContentsId, session); },
    lockProtectedRegistry: (id: number) => sessions.delete(id),
    isProtectedRegistryEnabled: () => false,
    protectedRegistryStatus: async () => ({ readOnly: true, unlocked: sessions.has(1) }),
    readProtectedViewerVault: async () => { state.reads++; if (state.interrupt) sessionGenerations.set(1, 1); return state.available ? { buffer: Buffer.from(JSON.stringify(envelope)), version: '1' } : null; },
    loadVaultFromCloud: async () => { state.reads++; if (state.interrupt) sessions.delete(1); return { vault: { ...structuredClone(vault), revision: state.revision }, envelope, driveVersion: '1' }; },
    reconcilePending: forbidden, uploadProtectedInvoicePdf: forbidden, uploadProtectedCreditNotePdf: forbidden, refreshProtectedInvoiceDocument: forbidden, readProtectedDocumentPdf: forbidden, assertWriter: forbidden,
    renderProtectedInvoicePdf: () => Buffer.from('%PDF-synthetic'), renderProtectedCreditNotePdf: () => Buffer.from('%PDF-synthetic'),
    path: { join: (...parts: string[]) => parts.join('/') }, app: { getPath: () => '/synthetic' }, randomUUID: () => 'synthetic-id',
    fs: { writeFileSync: () => { state.files++; } }, temporaryFiles: new Map(), toValidatedPdfBuffer: (buffer: Uint8Array) => buffer,
    requireText: (value: unknown) => String(value), shell: { openPath: async () => { state.opened++; return ''; } },
    openWindowsDocument: async () => { state.opened++; return { success: true }; },
  };
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const api = new Function(...Object.keys(bindings), compiled + '\nreturn {activateProtectedViewer, unlockProtectedRegistry, refreshProtectedViewer, openProtectedDocument, printProtectedDocument, shareProtectedDocument};')(...Object.values(bindings));
  return { api, state, credentials, sessions, recovery };
}

test('activation and PIN unlock keep Writer credentials and cloud unchanged; document actions are read-only', async () => {
  const f = fixture();
  await f.api.activateProtectedViewer(1, f.recovery, '482719', '482719');
  assert.equal(f.credentials.get('key'), 'writer-credential-preserved');
  assert.equal(f.credentials.get('auth'), 'writer-auth-preserved');
  assert.ok(f.credentials.has('key-viewer'));
  f.sessions.clear();
  await assert.rejects(f.api.unlockProtectedRegistry(1, '111111'), /PIN incorect/);
  await f.api.unlockProtectedRegistry(1, '482719');
  for (const action of ['openProtectedDocument', 'printProtectedDocument', 'shareProtectedDocument']) {
    await f.api[action](1, 'invoice', 'invoice');
    await f.api[action](1, 'credit-note', 'note');
  }
  await assert.rejects(f.api.openProtectedDocument(1, 'invoice', 'missing'), /nu există/);
  assert.equal(f.state.files, 6); assert.equal(f.state.opened, 6); assert.equal(f.state.writes, 0);
});

test('activation fails closed with wrong recovery, unavailable storage/cloud or interrupted access', async () => {
  for (const reason of ['wrong-key', 'storage', 'missing', 'interrupted']) {
    const f = fixture();
    if (reason === 'storage') f.state.secure = false;
    if (reason === 'missing') f.state.available = false;
    if (reason === 'interrupted') f.state.interrupt = true;
    await assert.rejects(f.api.activateProtectedViewer(1, reason === 'wrong-key' ? generateRecoveryKey() : f.recovery, '482719', '482719'));
    assert.equal(f.credentials.size, 2); assert.equal(f.sessions.size, 0); assert.equal(f.state.writes, 0);
  }
});

test('PIN attempts, locked sessions, role change, stale cloud and late document reads fail closed', async () => {
  const f = fixture(); await f.api.activateProtectedViewer(1, f.recovery, '482719', '482719');
  f.sessions.clear();
  for (let i = 0; i < 5; i++) await assert.rejects(f.api.unlockProtectedRegistry(1, '111111'));
  await assert.rejects(f.api.unlockProtectedRegistry(1, '482719'), /blocat/);
  await assert.rejects(f.api.openProtectedDocument(1, 'invoice', 'invoice'), /expirat/);
  const g = fixture(); await g.api.activateProtectedViewer(1, g.recovery, '482719', '482719');
  g.state.revision = -1;
  await assert.rejects(g.api.refreshProtectedViewer(1), /mai veche/);
  g.state.revision = 0; g.state.interrupt = true;
  await assert.rejects(g.api.openProtectedDocument(1, 'invoice', 'invoice'));
  assert.equal(g.state.files, 0); assert.equal(g.state.opened, 0); assert.equal(g.state.writes, 0);
  const h = fixture(); await h.api.activateProtectedViewer(1, h.recovery, '482719', '482719');
  h.state.role = 'writer';
  await assert.rejects(h.api.openProtectedDocument(1, 'invoice', 'invoice'), /expirat/);
});
