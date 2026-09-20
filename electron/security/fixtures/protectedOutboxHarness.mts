import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as invoiceEditing from '../../protectedRegistry/invoiceEditing.ts';
import * as issuerChange from '../../protectedRegistry/issuerChange.ts';
import { applyAutomaticProtectedCredit } from '../../protectedRegistry/automaticCredit.ts';
import * as crypto from '../../protectedRegistry/crypto.ts';
import { ProtectedOutboxStore, ProtectedOutboxWorker, vaultDigest } from '../../protectedRegistry/outbox.ts';
import { createEmptyProtectedVault } from '../../protectedRegistry/types.ts';

// Actual service orchestration + actual encrypted, fsynced filesystem queue.
// Only Google, Electron sessions and PDF upload are synthetic adapters.
const source = ts.createSourceFile('service.ts', fs.readFileSync(new URL('../../protectedRegistry/service.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const names = new Set(['assertWriter', 'encode', 'parseVault', 'parseManifest', 'buildManifest', 'addAudit', 'uploadManifest',
  'loadVaultFromCloud', 'reconcilePending', 'freshSession', 'withRegistryRoutingLock', 'mutate', 'stageProtectedMutation',
  'getProtectedInvoiceForEdit', 'updateProtectedInvoice', 'changeProtectedInvoiceIssuer', 'assertProtectedCloudSettled', 'commitPendingProtectedSave', 'protectedRegistrySyncStatus', 'retryProtectedRegistrySync', 'unlockProtectedRegistry']);
const code = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text || '')).map(node => node.getText(source)).join('\n').replaceAll('export ', '');
const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

export function protectedOutboxHarness(t: any, previous?: any, initialVault?: any, extraBindings: Record<string, unknown> = {}) {
  const directory = previous?.directory || fs.mkdtempSync(path.join(os.tmpdir(), 'vr-outbox-test-'));
  const key = previous?.key || crypto.generateVaultKey();
  const vault = initialVault ? structuredClone(initialVault) : createEmptyProtectedVault();
  if (!initialVault) vault.counters.TGBL = 1;
  const recovery = crypto.encryptVault(Buffer.from(JSON.stringify(vault)), key, crypto.generateRecoveryKey(), 0).recovery;
  const envelope = crypto.encryptVaultWithExistingRecovery(Buffer.from(JSON.stringify(vault)), key, 0, recovery);
  const scope = 'a'.repeat(64);
  const files: Map<string, any> = previous?.files || new Map([['registru-separat.vault', { buffer: Buffer.from(JSON.stringify(envelope)), version: '1', fileId: 'vault-id' }]]);
  const sessions = new Map<number, any>([[1, { webContentsId: 1, role: 'writer', lastActivity: Date.now(), vault, envelope, driveVersion: '1', driveFileId: 'vault-id', cloudScope: scope }]]);
  const state = { role: 'writer', scope, offline: false, failAt: '', afterWrite: false, gate: null as Promise<void> | null, probes: 0, writes: [] as string[], documents: [] as string[], lockOnProbe: false };
  const store = new ProtectedOutboxStore(directory, () => key);
  let worker: ProtectedOutboxWorker;
  const bindings = {
    ...crypto, ...invoiceEditing, ...issuerChange, applyAutomaticProtectedCredit, activeCreditApplied: () => 0, Buffer, randomUUID, vaultDigest, sessions, sessionGenerations: new Map(), SESSION_MS: 600000,
    FOLDER: ['Duplicat'], VAULT_FILE: 'registru-separat.vault', MANIFEST_FILE: 'registru-separat.manifest', PENDING_FILE: 'registru-separat.pending',
    deferredEvents: new Set(['protected_manual_invoice_issued', 'protected_invoice_updated', 'protected_invoice_issuer_changed']),
    keyBuffer: () => key, getDeviceRole: () => state.role, protectedCloudAccountScope: () => state.scope, initializeProtectedCloudScope: async () => state.scope,
    protectedOutbox: store,
    protectedUploader: { start: () => worker.start(), status: () => worker.status(), assertWritable: () => worker.assertWritable(), blockAfterLocalFailure: () => worker.blockAfterLocalFailure() },
    requireText: (value: unknown) => String(value),
    withPrivateCloudOperation: (operation: () => Promise<unknown>) => operation(),
    setSession: (session: any) => { session.role ??= state.role; sessions.set(session.webContentsId, session); },
    lockProtectedRegistry: (id: number) => sessions.delete(id),
    readAuthState: () => ({ pin: {}, failedAttempts: 0, lockUntil: null }), saveAuthState: () => {}, verifyPin: () => true,
    isProtectedRegistryEnabled: () => true, protectedRegistryStatus: () => ({ unlocked: sessions.has(1) }),
    probeProtectedCloudFile: async (fileId: string, expectedScope: string) => {
      state.probes++;
      if (state.offline) throw Error('offline');
      if (state.scope !== expectedScope || fileId !== 'vault-id') throw Error('scope');
      if (state.lockOnProbe) sessions.clear();
    },
    readVerifiedPrivateCloudFile: async (_folders: string[], name: string) => {
      if (state.gate) await state.gate;
      if (state.offline) throw Error('offline');
      return files.get(name) || null;
    },
    writeVerifiedPrivateCloudFile: async (input: any) => {
      const name = input.filename;
      if (state.offline || (state.failAt === name && !state.afterWrite)) throw Error('synthetic upload failure');
      assert.equal(input.accountScope, state.scope);
      const existing = files.get(name);
      if (input.expectedFileId) assert.equal(existing?.fileId, input.expectedFileId);
      assert.equal(input.expectedVersion, existing?.version || null);
      state.writes.push(name);
      files.set(name, { buffer: Buffer.from(input.buffer), version: String(Number(existing?.version || 0) + 1), fileId: existing?.fileId || name });
      if (state.failAt === name) throw Error('synthetic lost response');
    },
    deletePrivateCloudFile: async (_folders: string[], name: string, assertScope?: () => void) => {
      assertScope?.(); if (state.failAt === 'delete') throw Error('synthetic delete failure'); files.delete(name);
    },
    uploadProtectedInvoicePdf: async (invoice: any) => { if (state.failAt === 'pdf') throw Error('synthetic PDF failure'); state.documents.push(invoice.id); },
    uploadProtectedCreditNotePdf: async () => { throw Error('unexpected credit note'); },
    ...extraBindings,
  };
  const api = new Function(...Object.keys(bindings), 'let routingOperationQueue = Promise.resolve();\n' + compiled
    + '\nreturn {getProtectedInvoiceForEdit, updateProtectedInvoice, changeProtectedInvoiceIssuer, mutate, commitPendingProtectedSave, assertProtectedCloudSettled, protectedRegistrySyncStatus, retryProtectedRegistrySync, unlockProtectedRegistry};')(...Object.values(bindings));
  worker = new ProtectedOutboxWorker(store, api.commitPendingProtectedSave);
  t.after(() => { worker.stop(); if (!previous) fs.rmSync(directory, { recursive: true, force: true }); });
  const issue = (operationId = randomUUID()) => api.mutate(1, operationId, 'protected_manual_invoice_issued', (next: any, op: string) => {
    next.invoices.push({ id: op, reference: `TGBL-${next.counters.TGBL++}`, sourceOrderIds: [], items: [], status: 'issued', replacesInvoiceId: null, replacedByInvoiceId: null });
  });
  const current = () => JSON.parse(crypto.decryptVault(crypto.parseEnvelope(files.get('registru-separat.vault')!.buffer), key).toString());
  const replaceCloud = (value: any) => {
    const file = files.get('registru-separat.vault');
    const prior = crypto.parseEnvelope(file.buffer);
    file.buffer = Buffer.from(JSON.stringify(crypto.encryptVaultWithExistingRecovery(Buffer.from(JSON.stringify(value)), key, value.revision, prior.recovery)));
    file.version = String(Number(file.version) + 1);
  };
  return { directory, key, files, sessions, state, store, worker, api, issue, current, replaceCloud };
}
