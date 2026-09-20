import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as crypto from '../protectedRegistry/crypto.ts';
import { createEmptyProtectedVault } from '../protectedRegistry/types.ts';
import { registerFailedPinAttempt } from '../protectedRegistry/policy.ts';
import { isChannelAllowedForRole } from '../device/viewerPolicy.ts';

// Execute the actual service functions with synthetic, versioned Drive and
// credential adapters. No Electron process, real credentials or cloud access.
function fixture() {
  const source = ts.createSourceFile('service.ts', readFileSync(new URL('../protectedRegistry/service.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const names = new Set(['assertWriter', 'keyBuffer', 'registryCredential', 'readAuthState', 'saveAuthState', 'encode', 'parseVault', 'parseManifest', 'buildManifest', 'addAudit', 'uploadManifest', 'loadVaultFromCloud', 'reconcilePending', 'freshSession', 'withRegistryRoutingLock', 'mutate', 'rotateProtectedRecoveryKey', 'companyKey', 'setProtectedRegistryAssignment', 'ensureNormalBillingVisibility', 'loadProtectedRoutingPolicy']);
  const code = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text || '')).map(node => node.getText(source)).join('\n').replaceAll('export ', '');
  const key = crypto.generateVaultKey(), oldRecovery = crypto.generateRecoveryKey();
  const vault = createEmptyProtectedVault();
  vault.assignments.push({ companyKey: 'synthetic-company' } as any);
  vault.invoices.push({ id: 'invoice-1', sourceOrderIds: ['synthetic-order'], items: [{ quantity: 2, unitPrice: 3 }], totalAmount: 6, replacesInvoiceId: null, replacedByInvoiceId: null } as any);
  vault.payments.push({ id: 'payment-1', amount: 2, testEntry: true } as any);
  vault.creditEntries.push({ id: 'credit-1', availableAmount: 1, testEntry: true } as any);
  const envelope = crypto.encryptVault(Buffer.from(JSON.stringify(vault)), key, oldRecovery, vault.revision);
  const files = new Map<string, { buffer: Buffer; version: string }>([['Duplicat/registru-separat.vault', { buffer: Buffer.from(JSON.stringify(envelope)), version: '1' }]]);
  const auth = { version: 1, pin: crypto.createPinVerifier('482719'), failedAttempts: 0, lockUntil: null };
  const credentials = new Map([['key', key.toString('base64')], ['auth', JSON.stringify(auth)]]);
  const sessions = new Map<number, any>();
  const state = { role: 'writer', reads: 0, writes: 0, failAt: '', failAfterWrite: false, lockDuring: false, changeRoleDuring: false, visibilityReady: true, hiddenIds: [] as number[] };
  const session = () => sessions.set(1, { webContentsId: 1, role: 'writer', lastActivity: Date.now(), vault, envelope, driveVersion: '1' });
  session();
  const kind = (name: string) => name.includes('Backups') ? 'backup' : name.endsWith('.pending') ? 'pending' : name.endsWith('.manifest') ? 'manifest' : 'vault';
  const bindings = {
    deferredEvents: new Set(),
    assertProtectedCloudSettled: () => undefined,
    protectedCloudAccountScope: () => 'a'.repeat(64),
    initializeProtectedCloudScope: async () => 'a'.repeat(64),
    db: { prepare: () => ({ get: (id: number) => ({ id, name: `Company ${id}`, supabase_company_id: `company-${id}` }), all: () => [1,2].map(id => ({ id, supabase_company_id: `company-${id}` })) }) },
    requirePositiveInteger: (value: number) => { if (!Number.isSafeInteger(value) || value <= 0) throw Error('Invalid ID'); return value; },
    isProtectedRegistryEnabled: () => true,
    normalBillingVisibilityReady: () => state.visibilityReady,
    invalidateNormalBillingVisibility: () => { state.visibilityReady = false; },
    assertNormalBillingVisibilityReady: () => { if (!state.visibilityReady) throw Error('Visibility not verified'); },
    replaceNormalBillingVisibility: (_db: unknown, ids: number[]) => { state.hiddenIds = ids; state.visibilityReady = true; },
    ...crypto, Buffer, randomUUID, registerFailedPinAttempt, sessions,
    FOLDER: ['Duplicat'], VAULT_FILE: 'registru-separat.vault', MANIFEST_FILE: 'registru-separat.manifest', PENDING_FILE: 'registru-separat.pending',
    KEY_CREDENTIAL: 'key', AUTH_CREDENTIAL: 'auth', SESSION_MS: 600000, MAX_ATTEMPTS: 5, LOCKOUT_MS: 900000,
    getDeviceRole: () => state.role, getCredential: (id: string) => credentials.get(id), setCredential: (id: string, value: string) => credentials.set(id, value),
    setSession: (value: any) => { value.role ??= state.role; sessions.set(value.webContentsId, value); },
    lockProtectedRegistry: (id: number) => sessions.delete(id),
    requireText: (value: unknown) => String(value),
    withPrivateCloudOperation: (run: () => Promise<unknown>) => run(),
    readProtectedViewerVault: () => { throw Error('unexpected Viewer read'); },
    readVerifiedPrivateCloudFile: async (folder: string[], name: string) => { state.reads++; return files.get([...folder, name].join('/')) || null; },
    writeVerifiedPrivateCloudFile: async (input: any) => {
      state.writes++;
      const path = [...input.folderNames, input.filename].join('/');
      const current = files.get(path);
      if (input.expectedVersion !== undefined && input.expectedVersion !== (current?.version ?? null)) throw Error('version conflict');
      if (state.failAt === kind(path) && !state.failAfterWrite) throw Error('synthetic write failure');
      files.set(path, { buffer: Buffer.from(input.buffer), version: String(Number(current?.version || 0) + 1) });
      if (state.lockDuring) sessions.clear();
      if (state.changeRoleDuring) state.role = 'viewer';
      if (state.failAt === kind(path)) throw Error('synthetic lost acknowledgement');
      return { version: files.get(path)!.version };
    },
    deletePrivateCloudFile: async (folder: string[], name: string) => { if (state.failAt === 'delete') throw Error('synthetic delete failure'); files.delete([...folder, name].join('/')); },
  };
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const api = new Function(...Object.keys(bindings), 'let routingOperationQueue = Promise.resolve(); const recoveryRotations = new Set();\n' + compiled + '\nreturn {rotateProtectedRecoveryKey, reconcilePending, setProtectedRegistryAssignment, ensureNormalBillingVisibility};')(...Object.values(bindings));
  const currentEnvelope = () => crypto.parseEnvelope(files.get('Duplicat/registru-separat.vault')!.buffer);
  const current = () => JSON.parse(crypto.decryptVault(currentEnvelope(), key).toString());
  return { api, key, oldRecovery, vault, files, credentials, state, sessions, session, current, currentEnvelope };
}

const business = (vault: any) => Object.fromEntries(['assignments', 'invoices', 'payments', 'creditNotes', 'creditEntries', 'creditApplications', 'counters', 'mode', 'liveStartedAt'].map(name => [name, vault[name]]));

test('normal visibility follows serialized assignment commits/replay, remains readable offline and never grants Viewer cloud access', async () => {
  const f = fixture();
  const op = randomUUID();
  await f.api.setProtectedRegistryAssignment(1,1,true,op);
  assert.deepEqual(f.state.hiddenIds,[1]); assert.equal(f.state.visibilityReady,true);
  const revision = f.current().revision;
  await f.api.setProtectedRegistryAssignment(1,1,true,op);
  assert.equal(f.current().revision,revision);
  await Promise.all([f.api.setProtectedRegistryAssignment(1,2,true,randomUUID()), f.api.setProtectedRegistryAssignment(1,1,false,randomUUID())]);
  assert.deepEqual(f.state.hiddenIds,[2]);
  f.state.visibilityReady=false;
  await f.api.ensureNormalBillingVisibility();
  assert.deepEqual(f.state.hiddenIds,[2]);
  const reads = f.state.reads;
  f.state.role='viewer';
  await f.api.ensureNormalBillingVisibility();
  assert.equal(f.state.reads,reads);
  f.state.visibilityReady=false;
  await assert.rejects(f.api.ensureNormalBillingVisibility(),/Visibility/);
  await assert.rejects(f.api.setProtectedRegistryAssignment(1,1,true,randomUUID()),/Writer/);
  assert.equal(f.state.reads,reads);
});

test('interrupted assignment publication blocks normal reads until a verified retry restores the visibility snapshot', async () => {
  for (const stage of ['pending','vault','manifest','delete']) {
    const f = fixture(); f.state.failAt=stage; f.state.failAfterWrite=true;
    const op=randomUUID();
    await assert.rejects(f.api.setProtectedRegistryAssignment(1,1,true,op));
    assert.equal(f.state.visibilityReady,false);
    await assert.rejects(f.api.ensureNormalBillingVisibility(),/nefinalizată/);
    f.state.failAt='';
    await f.api.setProtectedRegistryAssignment(1,1,true,op);
    assert.equal(f.state.visibilityReady,true); assert.deepEqual(f.state.hiddenIds,[1]);
    assert.equal(f.current().invoices.length,1);
  }
});

test('new recovery opens the same vault; data, PIN, data key and routing identities are preserved', async () => {
  const f = fixture(), authBefore = f.credentials.get('auth');
  const result = await f.api.rotateProtectedRecoveryKey(1, '482719', true);
  assert.equal(result.success, true);
  assert.notEqual(result.recoveryKey, f.oldRecovery);
  assert.deepEqual(crypto.recoverVaultKey(f.currentEnvelope(), result.recoveryKey), f.key);
  assert.throws(() => crypto.recoverVaultKey(f.currentEnvelope(), f.oldRecovery));
  assert.deepEqual(business(f.current()), business(f.vault));
  assert.equal(f.credentials.get('auth'), authBefore);
  assert.equal(f.credentials.get('key'), f.key.toString('base64'));
  assert.equal(f.current().audit.at(-1).eventType, 'recovery_key_rotated');
  const manifestEnvelope = crypto.parseEnvelope(f.files.get('Duplicat/registru-separat.manifest')!.buffer);
  assert.deepEqual(manifestEnvelope.recovery, f.currentEnvelope().recovery);
  const manifest = JSON.parse(crypto.decryptVault(manifestEnvelope, f.key).toString());
  assert.deepEqual(manifest.companyHashes, [crypto.routingHash(f.key, 'company', 'synthetic-company')]);
  assert.deepEqual(manifest.protectedOrderHashes, [crypto.routingHash(f.key, 'order', 'synthetic-order')]);
  assert.equal([...f.files.keys()].filter(name => name.includes('/Backups/')).length, 1);
  for (const file of f.files.values()) assert.equal(file.buffer.toString().includes(result.recoveryKey), false);
  assert.equal(JSON.stringify(f.current()).includes(result.recoveryKey), false);
  assert.equal([...f.credentials.values()].some(value => value.includes(result.recoveryKey)), false);
});

test('confirmation, session, Writer role and current PIN are mandatory; failed PIN attempts lock out', async () => {
  assert.equal(isChannelAllowedForRole('viewer', 'protectedRegistry:rotateRecoveryKey'), false);
  for (const reason of ['viewer', 'locked', 'confirmation', 'pin']) {
    const f = fixture();
    if (reason === 'viewer') f.state.role = 'viewer';
    if (reason === 'locked') f.sessions.clear();
    await assert.rejects(f.api.rotateProtectedRecoveryKey(1, reason === 'pin' ? '000000' : '482719', reason !== 'confirmation'));
    assert.equal(f.state.writes, 0); assert.equal(f.state.reads, 0);
  }
  const f = fixture();
  for (let attempt = 0; attempt < 5; attempt++) await assert.rejects(f.api.rotateProtectedRecoveryKey(1, '000000', true));
  assert.equal(f.sessions.size, 0);
  assert.ok(JSON.parse(f.credentials.get('auth')!).lockUntil);
  f.session();
  await assert.rejects(f.api.rotateProtectedRecoveryKey(1, '482719', true), /blocat/);
  assert.equal(f.state.writes, 0);
});

test('failed and ambiguous writes at every commit stage retain data and permit a fresh verified key', async () => {
  for (const stage of ['backup', 'pending', 'vault', 'manifest', 'delete']) {
    for (const after of [false, true]) {
      const f = fixture(); f.state.failAt = stage; f.state.failAfterWrite = after;
      await assert.rejects(f.api.rotateProtectedRecoveryKey(1, '482719', true), /nu a putut fi confirmată/);
      assert.deepEqual(business(f.current()), business(f.vault));
      f.state.failAt = '';
      const result = await f.api.rotateProtectedRecoveryKey(1, '482719', true);
      assert.deepEqual(crypto.recoverVaultKey(f.currentEnvelope(), result.recoveryKey), f.key);
      assert.deepEqual(business(f.current()), business(f.vault));
      assert.equal(f.files.has('Duplicat/registru-separat.pending'), false);
    }
  }
});

test('concurrent rotation is rejected; lock/role changes during commit never disclose a key or reopen access', async () => {
  const f = fixture();
  const first = f.api.rotateProtectedRecoveryKey(1, '482719', true);
  await assert.rejects(f.api.rotateProtectedRecoveryKey(1, '482719', true), /deja în curs/);
  const result = await first;
  assert.deepEqual(crypto.recoverVaultKey(f.currentEnvelope(), result.recoveryKey), f.key);
  assert.equal(f.current().audit.filter((event: any) => event.eventType === 'recovery_key_rotated').length, 1);
  for (const reason of ['lockDuring', 'changeRoleDuring'] as const) {
    const g = fixture(); g.state[reason] = true;
    await assert.rejects(g.api.rotateProtectedRecoveryKey(1, '482719', true), /nu a putut fi confirmată/);
    assert.equal(g.sessions.size, 0);
    assert.deepEqual(business(g.current()), business(g.vault));
  }
});
