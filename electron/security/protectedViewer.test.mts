import { validateProtectedStatement } from '../protectedRegistry/statement.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createEmptyProtectedVault } from '../protectedRegistry/types.ts';
import { createPinVerifier, verifyPin, encryptVault, decryptVault, recoverVaultKey, parseEnvelope, generateVaultKey, generateRecoveryKey, wrapViewerKey, unwrapViewerKey } from '../protectedRegistry/crypto.ts';
import { registerFailedPinAttempt } from '../protectedRegistry/policy.ts';
import { isChannelAllowedForRole } from '../device/viewerPolicy.ts';

test('Viewer allowlist admits only explicit read/document/unlock operations from all protected handlers', () => {
  const allowed = new Set(['status', 'refreshViewer', 'unlock', 'lock', 'touch', 'getOverview', 'getCompanies', 'getInvoices', 'getPayments', 'getCreditNotes', 'getCreditBalances', 'getCreditApplications', 'openDocument', 'shareDocument', 'printDocument', 'statementDocument']);
  const handlers = readFileSync(new URL('../ipc/protectedRegistryHandlers.ts', import.meta.url), 'utf8');
  for (const match of handlers.matchAll(/handleTrustedIpc\('protectedRegistry:([^']+)'/g)) {
    assert.equal(isChannelAllowedForRole('viewer', `protectedRegistry:${match[1]}`), allowed.has(match[1]), match[1]);
  }
  assert.equal(isChannelAllowedForRole('viewer', 'protectedRegistry:activateViewer'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'protectedRegistry:futureMutation'), false);
});

const VIEWER_ACCESS_FILE = 'registru-separat.viewer-access';

function fixture() {
  const source = ts.createSourceFile('service.ts', readFileSync(new URL('../protectedRegistry/service.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const names = new Set(['registryCredential', 'keyBuffer', 'readAuthState', 'saveAuthState', 'freshSession', 'assertWriter', 'publishViewerAccess', 'unlockViewer', 'changeProtectedRegistryPin', 'recoverProtectedRegistry', 'configureProtectedRegistry', 'refreshProtectedViewer', 'unlockProtectedRegistry', 'protectedPdfToTemporaryFile', 'storeTemporaryProtectedPdf', 'openProtectedDocument', 'printProtectedDocument', 'shareProtectedDocument', 'protectedStatementDocument']);
  const code = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text || '')).map(node => node.getText(source)).join('\n').replaceAll('export ', '');
  const vault = createEmptyProtectedVault();
  vault.invoices.push({ id: 'invoice', status: 'unpaid', reference: 'TEST-1', companyName: 'Synthetic', companyKey: 'a' } as any);
  vault.creditNotes.push({ id: 'note', status: 'issued', reference: 'CN-1' } as any);
  const recovery = generateRecoveryKey(), key = generateVaultKey();
  const envelope = encryptVault(Buffer.from(JSON.stringify(vault)), key, recovery, vault.revision);
  const state = { role: 'viewer', secure: true, reads: 0, files: 0, opened: 0, writes: 0, interrupt: false, revision: vault.revision, available: true, failAfterWrite: false };
  const writerAuth = { version: 1, pin: createPinVerifier('482719'), failedAttempts: 0, lockUntil: null };
  const credentials = new Map([['key', key.toString('base64')], ['auth', JSON.stringify(writerAuth)]]);
  let access: { buffer: Buffer; version: string; fileId: string } | null = null;
  let storedVault: typeof envelope | null = envelope;
  const vaultFile = () => storedVault && ({ buffer: Buffer.from(JSON.stringify(storedVault)), version: '1', fileId: 'vault' });
  const sessions = new Map<number, any>(), sessionGenerations = new Map<number, number>();
  const forbidden = () => { state.writes++; throw Error('Unexpected Writer side effect'); };
  const bindings = {
    validateProtectedStatement, protectedStatementReport: () => ({}), generateStatementPdf: () => Buffer.from('%PDF-synthetic'),
    Buffer, wrapViewerKey, unwrapViewerKey, VIEWER_ACCESS_FILE, FOLDER: ['Duplicat'], VAULT_FILE: 'vault', ENABLED_CREDENTIAL: 'enabled',
    randomBytes: () => Buffer.alloc(18), initializeProtectedCloudScope: async () => 'scope', protectedCloudAccountScope: () => 'scope',
    deleteCredential: (name: string) => credentials.delete(name), protectedOutbox: { hasPending: () => false, discardIncompleteWrites() {}, read: () => [] },
    getCloudStatus: async () => ({ connectionHealthy: true }), generateRecoveryKey, generateVaultKey, encryptVault, createEmptyProtectedVault,
    encode: (value: unknown) => Buffer.from(JSON.stringify(value)), addAudit: () => {}, uploadManifest: () => {}, ensureNormalBillingVisibility: async () => {},
    mutate: async () => { assert.equal(state.role, 'writer'); },
    readVerifiedPrivateCloudFile: async (_folder: unknown, name: string) => { assert.equal(state.role, 'writer'); return name === VIEWER_ACCESS_FILE ? access : vaultFile(); },
    writeVerifiedPrivateCloudFile: async (input: any) => {
      assert.equal(state.role, 'writer');
      if (input.filename === 'vault') { storedVault = parseEnvelope(input.buffer); return; }
      assert.equal(input.filename, VIEWER_ACCESS_FILE);
      assert.equal(input.expectedVersion, access?.version ?? null);
      assert.equal(input.accountScope, 'scope');
      access = { buffer: input.buffer, version: String(Number(access?.version || 0) + 1), fileId: 'access' };
      state.writes++;
      if (state.failAfterWrite) throw Error('Confirmarea Drive a eșuat.');
    },
    readProtectedViewerAccess: async () => { if (!state.available) throw Error('Drive offline'); return access; },
    KEY_CREDENTIAL: 'key', AUTH_CREDENTIAL: 'auth', SESSION_MS: 60000, MAX_ATTEMPTS: 5, LOCKOUT_MS: 900000,
    getDeviceRole: () => state.role, getCredential: (id: string) => credentials.get(id), setCredential: (id: string, value: string) => credentials.set(id, value),
    isCredentialStorageAvailable: () => state.secure, createPinVerifier, verifyPin, recoverVaultKey, decryptVault, parseEnvelope, registerFailedPinAttempt,
    parseVault: (bytes: Uint8Array) => JSON.parse(Buffer.from(bytes).toString()), sessions, sessionGenerations,
    setSession: (session: any) => { session.role ??= state.role; sessions.set(session.webContentsId, session); },
    lockProtectedRegistry: (id: number) => sessions.delete(id),
    isProtectedRegistryEnabled: () => credentials.has('auth'),
    protectedRegistryStatus: async () => ({ readOnly: true, unlocked: sessions.has(1) }),
    withRegistryRoutingLock: (operation: () => Promise<unknown>) => operation(),
    assertProtectedCloudSettled: () => undefined,
    readProtectedViewerVault: async () => { state.reads++; if (state.interrupt) sessionGenerations.set(1, 1); return vaultFile(); },
    loadVaultFromCloud: async () => { state.reads++; if (state.interrupt) sessions.delete(1); return { vault: { ...structuredClone(vault), revision: state.revision }, envelope: storedVault!, cloudScope: 'scope', driveVersion: '1' }; },
    reconcilePending: async () => { assert.equal(state.role, 'writer'); }, uploadProtectedInvoicePdf: forbidden, uploadProtectedCreditNotePdf: forbidden, refreshProtectedInvoiceDocument: forbidden, readProtectedDocumentPdf: forbidden,
    renderProtectedInvoicePdf: () => Buffer.from('%PDF-synthetic'), renderProtectedCreditNotePdf: () => Buffer.from('%PDF-synthetic'),
    path: { join: (...parts: string[]) => parts.join('/') }, app: { getPath: () => '/synthetic' }, randomUUID: () => 'synthetic-id',
    fs: { writeFileSync: () => { state.files++; } }, temporaryFiles: new Map(), toValidatedPdfBuffer: (buffer: Uint8Array) => buffer,
    requireText: (value: unknown) => String(value), shell: { openPath: async () => { state.opened++; return ''; } },
    openWindowsDocument: async () => { state.opened++; return { success: true }; },
  };
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const api = new Function(...Object.keys(bindings), compiled + '\nreturn {configureProtectedRegistry, recoverProtectedRegistry, changeProtectedRegistryPin, unlockProtectedRegistry, refreshProtectedViewer, openProtectedDocument, printProtectedDocument, shareProtectedDocument, protectedStatementDocument};')(...Object.values(bindings));
  const prepare = async () => {
    state.role = 'writer';
    await api.unlockProtectedRegistry(1, '482719');
    sessions.clear();
    state.role = 'viewer';
  };
  return { api, state, credentials, sessions, recovery, prepare, clearVault: () => { storedVault = null; } };
}

test('one Writer unlock prepares a fresh Viewer and replaces legacy local access', async () => {
  const f = fixture(), writerCredentials = [...f.credentials];
  await assert.rejects(f.api.unlockProtectedRegistry(1, '482719'), /o dată pe Writer/);
  await f.prepare();
  await f.api.unlockProtectedRegistry(1, '482719');
  f.sessions.clear();
  f.credentials.set('auth-viewer', JSON.stringify({ version: 1, pin: createPinVerifier('111111'), failedAttempts: 0, lockUntil: null }));
  f.credentials.set('key-viewer', f.credentials.get('key')!);
  await assert.rejects(f.api.unlockProtectedRegistry(1, '111111'), /PIN incorect/);
  await f.api.unlockProtectedRegistry(1, '482719');
  assert.equal(f.credentials.has('key-viewer'), false);
  for (const [name, value] of writerCredentials) assert.equal(f.credentials.get(name), value);
  for (const action of ['openProtectedDocument', 'printProtectedDocument', 'shareProtectedDocument']) {
    await f.api[action](1, 'invoice', 'invoice');
    await f.api[action](1, 'credit-note', 'note');
  }
  await assert.rejects(f.api.openProtectedDocument(1, 'invoice', 'missing'), /nu există/);
  assert.equal(f.state.files, 6); assert.equal(f.state.opened, 6); assert.equal(f.state.writes, 1);
});

test('offline, missing, interrupted and insecure storage failures do not count as PIN attempts', async () => {
  for (const reason of ['offline', 'storage', 'missing', 'interrupted']) {
    const f = fixture(); await f.prepare();
    if (reason === 'storage') f.state.secure = false;
    if (reason === 'offline') f.state.available = false;
    if (reason === 'missing') f.clearVault();
    if (reason === 'interrupted') f.state.interrupt = true;
    await assert.rejects(f.api.unlockProtectedRegistry(1, '482719'));
    assert.equal(f.credentials.has('auth-viewer'), false);
    assert.equal(f.sessions.size, 0); assert.equal(f.state.writes, 1);
  }
});

test('Writer PIN change can retry after a lost Drive acknowledgement, and recovery replaces the grant', async () => {
  const f = fixture();
  await f.prepare();
  f.state.role = 'writer';
  await f.api.unlockProtectedRegistry(1, '482719');
  assert.equal(f.state.writes, 1);
  f.state.failAfterWrite = true;
  await assert.rejects(f.api.changeProtectedRegistryPin(1, '482719', '123456', '123456'), /Drive/);
  f.state.failAfterWrite = false;
  await f.api.changeProtectedRegistryPin(1, '482719', '123456', '123456');
  assert.equal(f.state.writes, 2);
  f.sessions.clear(); f.state.role = 'viewer';
  await assert.rejects(f.api.unlockProtectedRegistry(1, '482719'), /incorect/);
  await f.api.unlockProtectedRegistry(1, '123456');
  f.sessions.clear(); f.state.role = 'writer';
  await f.api.recoverProtectedRegistry(1, f.recovery, '012345', '012345');
  await f.api.unlockProtectedRegistry(1, '012345');
  f.sessions.clear(); f.state.role = 'viewer';
  await assert.rejects(f.api.unlockProtectedRegistry(1, '123456'), /incorect/);
  await f.api.unlockProtectedRegistry(1, '012345');
});

test('fresh Writer configuration publishes Viewer access and returns its recovery key', async () => {
  const f = fixture(); f.clearVault(); f.credentials.clear(); f.state.role = 'writer';
  const configured = await f.api.configureProtectedRegistry(1, '012345', '012345');
  assert.ok(configured.recoveryKey);
  f.sessions.clear(); f.state.role = 'viewer';
  await f.api.unlockProtectedRegistry(1, '012345');
});

test('PIN attempts, locked sessions, role change, stale cloud and late document reads fail closed', async () => {
  const f = fixture(); await f.prepare(); await f.api.unlockProtectedRegistry(1, '482719');
  f.sessions.clear();
  for (let i = 0; i < 5; i++) await assert.rejects(f.api.unlockProtectedRegistry(1, '111111'));
  await assert.rejects(f.api.unlockProtectedRegistry(1, '482719'), /blocat/);
  await assert.rejects(f.api.openProtectedDocument(1, 'invoice', 'invoice'), /expirat/);
  const g = fixture(); await g.prepare(); await g.api.unlockProtectedRegistry(1, '482719');
  g.state.revision = -1;
  await assert.rejects(g.api.refreshProtectedViewer(1), /mai veche/);
  g.state.revision = 0; g.state.interrupt = true;
  await assert.rejects(g.api.openProtectedDocument(1, 'invoice', 'invoice'));
  assert.equal(g.state.files, 0); assert.equal(g.state.opened, 0); assert.equal(g.state.writes, 1);
  const h = fixture(); await h.prepare(); await h.api.unlockProtectedRegistry(1, '482719');
  h.state.role = 'writer';
  await assert.rejects(h.api.openProtectedDocument(1, 'invoice', 'invoice'), /expirat/);
});

const statementInput = { companyKey: 'a', issuerCode: 'goodness', storeInvoiceId: null, from: '2026-10-01', to: '2026-10-31', action: 'open' };
test('statement actions use verified Viewer session and temporary PDFs without cloud writes', async () => {
  const f = fixture(); await f.prepare(); await f.api.unlockProtectedRegistry(1, '482719');
  for (const action of ['open', 'print', 'share']) await f.api.protectedStatementDocument(1, { ...statementInput, action });
  assert.equal(f.state.files, 3); assert.equal(f.state.opened, 3); assert.equal(f.state.writes, 1);
});
test('statement rejects invalid requests, locked/expired/changed sessions and interrupted refresh without plaintext', async () => {
  for (const scenario of ['invalid', 'locked', 'expired', 'role', 'interrupt', 'stale']) {
    const f = fixture(); await f.prepare(); await f.api.unlockProtectedRegistry(1, '482719');
    if (scenario === 'locked') f.sessions.clear();
    if (scenario === 'expired') f.sessions.get(1).lastActivity = 0;
    if (scenario === 'role') f.state.role = 'writer';
    if (scenario === 'interrupt') f.state.interrupt = true;
    if (scenario === 'stale') f.state.revision = -1;
    await assert.rejects(f.api.protectedStatementDocument(1, { ...statementInput, action: scenario === 'invalid' ? 'delete' : 'open' }));
    assert.equal(f.state.files, 0, scenario); assert.equal(f.state.opened, 0, scenario); assert.equal(f.state.writes, 1, scenario);
  }
});
