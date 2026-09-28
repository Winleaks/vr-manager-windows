import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { withPrivateCloudOperation } from '../integrations/privateCloudOperation.ts';
import type { InvoiceIssuerChangeInput, InvoiceIssuerChangeOptions } from '../../src/shared/invoiceIssuerChange.ts';
import { applyProtectedIssuerChange, protectedIssuerChangeBlock, protectedIssuerChangeReplay, validateProtectedIssuerChange } from './issuerChange.ts';
import { applyProtectedInvoiceEdit, protectedInvoiceEditBlock, protectedInvoiceEditReplay, protectedInvoiceVersion, validateProtectedInvoiceEdit } from './invoiceEditing.ts';
import type { ProtectedInvoiceEditInput } from '../../src/shared/protectedInvoiceEdit.ts';
import { protectedInvoiceOutstanding } from './invoiceOutstanding.ts';
import { protectedPaymentDisplay } from './paymentDisplay.ts';
import { publishProtectedBillingVault, queueNormalPublicationAfterProtected } from './billingPublication.ts';
import { protectedRegistryOverview } from './overview.ts';
import { applyAutomaticProtectedCredit } from './automaticCredit.ts';
import { localInvoiceCatalog, priceInvoiceCatalog } from '../integrations/invoiceCatalogPricing.ts';
import fs from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';
import ExcelJS from 'exceljs';
import {
  deletePrivateCloudFile,
  getCloudStatus,
  readVerifiedPrivateCloudFile,
  readProtectedViewerVault,
  writeVerifiedPrivateCloudFile,
  protectedCloudAccountScope,
  initializeProtectedCloudScope,
  probeProtectedCloudFile,
} from '../database/cloudSync.ts';
import { ProtectedOutboxStore, ProtectedOutboxWorker, vaultDigest, type PendingProtectedSave } from './outbox.ts';
import { db } from '../database/db.ts';
import { normalBillingVisibilityReady, invalidateNormalBillingVisibility, replaceNormalBillingVisibility, assertNormalBillingVisibilityReady } from '../database/normalBillingVisibility.ts';
import { getDeviceRole } from '../device/deviceRole.ts';
import {
  getCredential,
  isCredentialStorageAvailable,
  setCredential,
} from '../security/credentialStore.ts';
import { requirePositiveInteger, requireText } from '../database/businessValidation.ts';
import { aggregateWeeklyOrders } from '../integrations/weeklyInvoiceImport.ts';
import { createVrBakerClient } from '../integrations/vrBakerIntegration.ts';
import * as billingRepo from '../database/repositories/billingRepo.ts';
import { protectedCloudDocumentFolders } from '../reports/clientDocumentStorage.ts';
import {
  createPinVerifier,
  decryptVault,
  encryptVault,
  encryptVaultWithExistingRecovery,
  generateRecoveryKey,
  generateVaultKey,
  parseEnvelope,
  recoverVaultKey,
  routingHash,
  verifyPin,
  type PinVerifier,
  type ProtectedEnvelope,
} from './crypto.ts';
import {
  createEmptyProtectedVault,
  type ProtectedAuditEvent,
  type ProtectedRegistryVault,
  type ProtectedRoutingManifest,
  type ProtectedInvoice,
  type ProtectedInvoiceItem,
  type ProtectedIssuerCode,
  type ProtectedPayment,
  type ProtectedCreditNote,
  type ProtectedCreditNoteItem,
  type ProtectedCreditApplication,
  type ProtectedCreditEntry,
} from './types.ts';
import { isIssuerReady, issuerSnapshot, type BillingIssuerRow } from '../database/billingIssuers.ts';
import { validateWeeklyPeriod } from '../integrations/vrBakerApiClient.ts';
import { generateInvoicePDF } from '../../src/utils/pdfGenerator.ts';
import { generateCreditNotePdf } from '../reports/creditNotePdf.ts';
import { openWindowsDocument } from '../reports/windowsDocuments.ts';
import { stopWindowsDocumentProcessesForFile } from '../reports/windowsDocumentProcess.ts';
import { toValidatedPdfBuffer } from '../security/fileValidation.ts';
import {
  assertCanGoLive,
  nextProtectedCreditNoteCounter,
  nextProtectedInvoiceCounter,
  registerFailedPinAttempt,
} from './policy.ts';

const FOLDER = ['Duplicat'];
const VAULT_FILE = 'registru-separat.vault';
const MANIFEST_FILE = 'registru-separat.manifest';
const PENDING_FILE = 'registru-separat.pending';
const KEY_CREDENTIAL = 'protected-registry-vault-key-v1';
const AUTH_CREDENTIAL = 'protected-registry-auth-v1';
const ENABLED_CREDENTIAL = 'protected-registry-enabled-v1';
const SESSION_MS = 10 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

interface AuthState {
  version: 1;
  pin: PinVerifier;
  failedAttempts: number;
  lockUntil: string | null;
}

interface Session {
  role?: 'writer' | 'viewer';
  webContentsId: number;
  lastActivity: number;
  vault: ProtectedRegistryVault;
  envelope: ProtectedEnvelope;
  driveVersion: string | null;
  driveFileId?: string;
  cloudScope?: string;
}

const sessions = new Map<number, Session>();
const sessionGenerations = new Map<number, number>();
const temporaryFiles = new Map<number, Set<string>>();
const sessionTimers = new Map<number, ReturnType<typeof setTimeout>>();
const recoveryRotations = new Set<number>();
let routingOperationQueue: Promise<void> = Promise.resolve();
const protectedOutbox = new ProtectedOutboxStore(path.join(app.getPath('userData'), 'protected-pending-v1'), keyBuffer);
const protectedUploader = new ProtectedOutboxWorker(protectedOutbox, commitPendingProtectedSave, () => scheduleProtectedBillingPublication());
let protectedBillingPublishing = false;
let protectedBillingQueued = false;
let protectedBillingTimer: ReturnType<typeof setInterval> | null = null;
let protectedBillingDebounce: ReturnType<typeof setTimeout> | null = null;
const deferredEvents = new Set([
  'protected_invoice_batch_issued', 'protected_manual_invoice_issued', 'protected_invoice_updated',
  'protected_invoice_issuer_changed', 'protected_invoice_cancelled', 'protected_invoice_reissued',
  'protected_payment_recorded', 'protected_payment_reversed', 'protected_credit_applied', 'protected_credit_reversed',
  'protected_credit_note_issued', 'protected_credit_note_cancelled',
]);

export function stopProtectedRegistrySync() {
  protectedUploader.stop();
  if (protectedBillingTimer) clearInterval(protectedBillingTimer);
  if (protectedBillingDebounce) clearTimeout(protectedBillingDebounce);
  protectedBillingTimer = null;
  protectedBillingDebounce = null;
  protectedBillingQueued = false;
}

async function publishProtectedBilling() {
  if (protectedBillingPublishing || getDeviceRole() !== 'writer' || !isProtectedRegistryEnabled()) {
    if (protectedBillingPublishing) protectedBillingQueued = true;
    return;
  }
  protectedBillingPublishing = true;
  try {
    if (protectedOutbox.hasPending()) return;
    const latest = await withRegistryRoutingLock(() => withPrivateCloudOperation(async () => {
      if (protectedOutbox.hasPending()) return null;
      const key = keyBuffer();
      await reconcilePending(key);
      return loadVaultFromCloud(key);
    }));
    if (!latest || getDeviceRole() !== 'writer' || protectedOutbox.hasPending()) return;
    await publishProtectedBillingVault(db, latest.vault, createVrBakerClient());
  } catch {
    // The encrypted vault and PDF synchronization are authoritative and must
    // never fail because the read-only client mirror is temporarily offline.
    // The same immutable revision is retried on the next schedule.
  } finally {
    protectedBillingPublishing = false;
    if (protectedBillingQueued) {
      protectedBillingQueued = false;
      scheduleProtectedBillingPublication();
    }
  }
}

export function scheduleProtectedBillingPublication() {
  if (getDeviceRole() !== 'writer') return;
  protectedBillingQueued = true;
  if (protectedBillingDebounce) return;
  protectedBillingDebounce = setTimeout(() => {
    protectedBillingDebounce = null;
    protectedBillingQueued = false;
    void publishProtectedBilling();
  }, 250);
  protectedBillingDebounce.unref();
}

export function startProtectedBillingPublisher() {
  if (getDeviceRole() !== 'writer' || protectedBillingTimer) return;
  scheduleProtectedBillingPublication();
  protectedBillingTimer = setInterval(scheduleProtectedBillingPublication, 300000);
  protectedBillingTimer.unref();
}

function assertProtectedCloudSettled() {
  if (protectedOutbox.hasPending()) throw Error('Registrul are salvări în curs. Așteaptă confirmarea sincronizării înainte de această operațiune.');
}

export async function protectedRegistrySyncStatus(webContentsId: number) {
  assertWriter();
  const session = sessions.get(webContentsId);
  if (!session || session.role !== 'writer' || Date.now() - session.lastActivity >= SESSION_MS) {
    lockProtectedRegistry(webContentsId);
    throw Error('Sesiunea registrului a expirat.');
  }
  return protectedUploader.status();
}

export async function retryProtectedRegistrySync(webContentsId: number) {
  assertWriter();
  await freshSession(webContentsId);
  void protectedUploader.start();
  return protectedUploader.status();
}

async function commitPendingProtectedSave(pending: PendingProtectedSave) {
  await withPrivateCloudOperation(async () => {
    await initializeProtectedCloudScope();
    const assertScope = () => {
      assertWriter();
      if (protectedCloudAccountScope() !== pending.scope) throw Error('Contul Drive s-a schimbat.');
    };
    assertScope();
    const key = keyBuffer();
    const latest = await loadVaultFromCloud(key);
    assertScope();
    const targetDigest = vaultDigest(pending.vault);
    const currentDigest = vaultDigest(latest.vault);
    if (latest.driveFileId !== pending.fileId || ![pending.baseDigest, targetDigest].includes(currentDigest)) {
      throw Error('Conflict de versiune. Salvarea locală nu a înlocuit datele din Drive.');
    }
    const remotePending = await readVerifiedPrivateCloudFile(FOLDER, PENDING_FILE);
    assertScope();
    if (remotePending && vaultDigest(parseVault(decryptVault(parseEnvelope(remotePending.buffer), key))) !== targetDigest) {
      throw Error('Altă operațiune este în curs în Drive.');
    }
    const envelope = encryptVaultWithExistingRecovery(encode(pending.vault), key, pending.vault.revision, pending.recovery);
    if (currentDigest !== targetDigest) {
      if (!remotePending) await writeVerifiedPrivateCloudFile({ folderNames: FOLDER, filename: PENDING_FILE,
        mimeType: 'application/octet-stream', buffer: encode(envelope), expectedVersion: null, accountScope: pending.scope });
      assertScope();
      await writeVerifiedPrivateCloudFile({ folderNames: FOLDER, filename: VAULT_FILE, mimeType: 'application/octet-stream',
        buffer: encode(envelope), expectedVersion: latest.driveVersion, expectedFileId: pending.fileId, accountScope: pending.scope });
    }
    assertScope();
    const manifest = await readVerifiedPrivateCloudFile(FOLDER, MANIFEST_FILE);
    assertScope();
    await uploadManifest(pending.vault, key, pending.recovery, manifest?.version ?? null, pending.scope);
    assertScope();
    await deletePrivateCloudFile(FOLDER, PENDING_FILE, assertScope);
    for (const job of pending.documents) {
      assertScope();
      if (job.type === 'invoice') {
        const invoice = pending.vault.invoices.find(row => row.id === job.id);
        if (invoice && invoice.status !== 'cancelled') await uploadProtectedInvoicePdf(invoice, pending.vault, pending.scope);
      } else {
        const note = pending.vault.creditNotes.find(row => row.id === job.id);
        if (note && note.status !== 'cancelled') await uploadProtectedCreditNotePdf(note, pending.vault, pending.scope);
      }
    }
    assertScope();
  });
}

async function stageProtectedMutation(webContentsId: number, operationId: string, eventType: string,
  apply: (vault: ProtectedRegistryVault, operationId: string) => void, findReplay?: (vault: ProtectedRegistryVault) => boolean) {
  protectedUploader.assertWritable();
  const session = await freshSession(webContentsId);
  if (!session.driveFileId || !session.cloudScope) throw Error('Redeschide registrul pentru a verifica destinația salvării.');
  // No offline issuance: every accepted operation checks the fixed remote file.
  await probeProtectedCloudFile(session.driveFileId, session.cloudScope);
  assertWriter();
  if (await freshSession(webContentsId) !== session) throw Error('Registrul a fost blocat.');
  protectedUploader.assertWritable();
  const latest = session.vault;
  if (findReplay?.(latest)) return latest;
  if (findReplay && latest.processedOperations.includes(operationId)) throw Error('Identificatorul operației a fost deja utilizat.');
  if (latest.processedOperations.includes(operationId)) return latest;
  const next = structuredClone(latest);
  apply(next, operationId);
  next.revision++;
  next.updatedAt = new Date().toISOString();
  next.processedOperations.push(operationId);
  if (next.processedOperations.length > 10000) next.processedOperations.splice(0, next.processedOperations.length - 10000);
  addAudit(next, eventType, operationId, { revision: next.revision });
  // Generate the envelope before accepting locally, enforcing the same size and
  // cryptographic limits as Drive. PDF jobs are part of the durable acceptance.
  const envelope = encryptVaultWithExistingRecovery(encode(next), keyBuffer(), next.revision, session.envelope.recovery);
  const previousInvoices = new Map(latest.invoices.map(row => [row.id, JSON.stringify(row)]));
  const previousNotes = new Map(latest.creditNotes.map(row => [row.id, JSON.stringify(row)]));
  const documents: PendingProtectedSave['documents'] = [
    ...next.invoices.filter(row => previousInvoices.get(row.id) !== JSON.stringify(row)).map(row => ({ type: 'invoice' as const, id: row.id })),
    ...next.creditNotes.filter(row => previousNotes.get(row.id) !== JSON.stringify(row)).map(row => ({ type: 'credit-note' as const, id: row.id })),
  ];
  try {
    protectedOutbox.append({ version: 1, operationId, scope: session.cloudScope, fileId: session.driveFileId,
      baseDigest: vaultDigest(latest), vault: next, recovery: envelope.recovery, documents });
  } catch (error) {
    // A directory flush can fail after the atomic rename. Never build another
    // revision on stale RAM in that ambiguous case: recover the accepted tail.
    if (protectedOutbox.hasPending()) {
      protectedUploader.blockAfterLocalFailure();
      const tail = protectedOutbox.read().at(-1)?.value;
      if (tail?.operationId === operationId && vaultDigest(tail.vault) === vaultDigest(next)) {
        for (const current of sessions.values()) if (current.role === 'writer') {
          current.vault = next; current.envelope = envelope;
        }
      }
      void protectedUploader.start();
      throw Error('Salvarea poate fi deja în așteptare. Verifică factura și sincronizarea înainte de a reîncerca; nu emite un document nou.');
    }
    throw error;
  }
  // No await between durable acceptance and updating every Writer session.
  for (const current of sessions.values()) if (current.role === 'writer') {
    current.vault = next; current.envelope = envelope;
  }
  void protectedUploader.start();
  return next;
}

function setSession(session: Session) {
  session.role ??= getDeviceRole();
  const prior = sessionTimers.get(session.webContentsId);
  if (prior) clearTimeout(prior);
  session.lastActivity = Date.now();
  sessions.set(session.webContentsId, session);
  sessionTimers.set(session.webContentsId, setTimeout(() => lockProtectedRegistry(session.webContentsId), SESSION_MS + 50));
}

export async function withRegistryRoutingLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = routingOperationQueue;
  let release!: () => void;
  routingOperationQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await operation(); } finally { release(); }
}

function assertWriter() {
  if (getDeviceRole() !== 'writer') throw new Error('Registrul separat este disponibil numai pe calculatorul Writer.');
}

function keyBuffer() {
  const value = getCredential(registryCredential(KEY_CREDENTIAL));
  if (!value) throw new Error('Cheia locală a registrului lipsește. Folosește cheia de recuperare.');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('Cheia locală a registrului este invalidă.');
  return key;
}

function readAuthState(): AuthState | null {
  const raw = getCredential(registryCredential(AUTH_CREDENTIAL));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthState;
    if (parsed.version !== 1 || !parsed.pin || !Number.isSafeInteger(parsed.failedAttempts) || parsed.failedAttempts < 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveAuthState(state: AuthState) {
  setCredential(registryCredential(AUTH_CREDENTIAL), JSON.stringify(state));
}

function registryCredential(name: string) {
  return getDeviceRole() === 'viewer' ? `${name}-viewer` : name;
}

function encode(value: unknown) {
  return new Uint8Array(Buffer.from(JSON.stringify(value), 'utf8'));
}

function parseVault(payload: Uint8Array): ProtectedRegistryVault {
  let vault: ProtectedRegistryVault;
  try { vault = JSON.parse(Buffer.from(payload).toString('utf8')) as ProtectedRegistryVault; } catch { throw new Error('Conținutul seifului este invalid.'); }
  if (vault.version !== 1 || !Number.isSafeInteger(vault.revision) || vault.revision < 0) throw new Error('Versiunea seifului nu este acceptată.');
  vault.creditApplications ||= [];
  vault.creditEntries ||= [];
  for (const application of vault.creditApplications) application.allocations ||= [];
  for (const payment of vault.payments || []) payment.testEntry ??= vault.mode === 'test' && !vault.liveStartedAt;
  for (const application of vault.creditApplications || []) application.testEntry ??= vault.mode === 'test' && !vault.liveStartedAt;
  for (const entry of vault.creditEntries || []) entry.testEntry ??= vault.mode === 'test' && !vault.liveStartedAt;
  for (const invoice of vault.invoices || []) {
    invoice.replacesInvoiceId ||= null;
    invoice.replacedByInvoiceId ||= null;
  }
  for (const note of vault.creditNotes || []) {
    note.backdateReason ||= null;
    for (const item of note.items || []) item.stockReturnApplied ||= false;
  }
  if (vault.mode !== 'test' && vault.mode !== 'live') throw new Error('Modul registrului este invalid.');
  for (const field of ['assignments', 'invoices', 'payments', 'creditNotes', 'creditApplications', 'creditEntries', 'audit', 'processedOperations'] as const) {
    if (!Array.isArray(vault[field])) throw new Error('Structura seifului este incompletă.');
  }
  if (vault.assignments.length > 10000 || vault.invoices.length > 200000 || vault.payments.length > 500000 || vault.creditNotes.length > 200000 || vault.audit.length > 1000000) {
    throw new Error('Seiful depășește limitele operaționale.');
  }
  const counters = vault.counters;
  for (const name of ['TGBL', 'VRL', 'CN-TGBL', 'CN-VRL'] as const) {
    if (!Number.isSafeInteger(counters?.[name]) || counters[name] < 1) throw new Error(`Contorul ${name} este invalid.`);
  }
  return vault;
}

function parseManifest(payload: Uint8Array): ProtectedRoutingManifest {
  let manifest: ProtectedRoutingManifest;
  try { manifest = JSON.parse(Buffer.from(payload).toString('utf8')) as ProtectedRoutingManifest; } catch { throw new Error('Manifestul registrului este invalid.'); }
  if (manifest.version !== 1 || !Number.isSafeInteger(manifest.vaultRevision) || !Array.isArray(manifest.companyHashes) || !Array.isArray(manifest.protectedOrderHashes)) {
    throw new Error('Manifestul registrului este incomplet.');
  }
  if (manifest.companyHashes.some((value) => typeof value !== 'string' || value.length !== 43)
    || manifest.protectedOrderHashes.some((value) => typeof value !== 'string' || value.length !== 43)) {
    throw new Error('Manifestul registrului conține identificatori invalizi.');
  }
  return manifest;
}

function buildManifest(vault: ProtectedRegistryVault, key: Uint8Array): ProtectedRoutingManifest {
  return {
    version: 1,
    vaultRevision: vault.revision,
    companyHashes: [...new Set(vault.assignments.map((entry) => routingHash(key, 'company', entry.companyKey)))].sort(),
    protectedOrderHashes: [...new Set(vault.invoices.flatMap((invoice) => invoice.sourceOrderIds).map((id) => routingHash(key, 'order', id)))].sort(),
    updatedAt: vault.updatedAt,
  };
}

function companyKey(company: { id: number; supabase_company_id?: string | null }) {
  return company.supabase_company_id ? `vrbaker:${company.supabase_company_id}` : `local:${company.id}`;
}

function addAudit(vault: ProtectedRegistryVault, eventType: string, operationId: string, details: Record<string, unknown>, resourceType: string | null = null, resourceId: string | null = null) {
  const event: ProtectedAuditEvent = {
    id: randomUUID(),
    eventType,
    operationId,
    resourceType,
    resourceId,
    details,
    createdAt: new Date().toISOString(),
  };
  vault.audit.push(event);
  if (vault.audit.length > 1000000) throw new Error('Jurnalul registrului a atins limita permisă.');
}

async function uploadManifest(vault: ProtectedRegistryVault, key: Buffer, recovery: ProtectedEnvelope['recovery'], expectedVersion?: string | null, accountScope?: string) {
  const envelope = encryptVaultWithExistingRecovery(encode(buildManifest(vault, key)), key, vault.revision, recovery);
  return writeVerifiedPrivateCloudFile({
    folderNames: FOLDER,
    filename: MANIFEST_FILE,
    mimeType: 'application/octet-stream',
    buffer: encode(envelope),
    expectedVersion,
    accountScope,
  });
}

async function loadVaultFromCloud(key: Buffer) {
  const scope = getDeviceRole() === 'writer' ? await initializeProtectedCloudScope() : undefined;
  const file = getDeviceRole() === 'viewer' ? await readProtectedViewerVault() : await readVerifiedPrivateCloudFile(FOLDER, VAULT_FILE);
  if (!file) throw new Error('Seiful registrului separat nu există în Google Drive.');
  const envelope = parseEnvelope(file.buffer);
  if (scope && protectedCloudAccountScope() !== scope) throw Error('Contul Drive s-a schimbat în timpul citirii.');
  return { vault: parseVault(decryptVault(envelope, key)), envelope, driveVersion: file.version, driveFileId: file.fileId,
    cloudScope: scope };
}

async function backupCurrentVault(webContentsId: number, label: string) {
  assertProtectedCloudSettled();
  await freshSession(webContentsId);
  const key = keyBuffer();
  await reconcilePending(key);
  const latest = await loadVaultFromCloud(key);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = label.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 30);
  const filename = `registru-separat-${stamp}-${safeLabel}-${randomBytes(4).toString('hex')}.vault`;
  await writeVerifiedPrivateCloudFile({ folderNames: ['Duplicat', 'Backups'], filename, mimeType: 'application/octet-stream', buffer: encode(latest.envelope), expectedVersion: null });
  return filename;
}

async function reconcilePending(key: Buffer) {
  const pendingFile = await readVerifiedPrivateCloudFile(FOLDER, PENDING_FILE);
  if (!pendingFile) return;
  const pendingEnvelope = parseEnvelope(pendingFile.buffer);
  const pendingVault = parseVault(decryptVault(pendingEnvelope, key));
  const currentFile = await readVerifiedPrivateCloudFile(FOLDER, VAULT_FILE);
  const currentEnvelope = currentFile ? parseEnvelope(currentFile.buffer) : null;
  const currentVault = currentEnvelope ? parseVault(decryptVault(currentEnvelope, key)) : null;
  if (!currentVault || pendingVault.revision > currentVault.revision) {
    await writeVerifiedPrivateCloudFile({
      folderNames: FOLDER,
      filename: VAULT_FILE,
      mimeType: 'application/octet-stream',
      buffer: encode(pendingEnvelope),
      expectedVersion: currentFile?.version ?? null,
    });
  }
  const manifestFile = await readVerifiedPrivateCloudFile(FOLDER, MANIFEST_FILE);
  const finalVault = !currentVault || pendingVault.revision > currentVault.revision ? pendingVault : currentVault;
  const finalEnvelope = !currentVault || pendingVault.revision > currentVault.revision ? pendingEnvelope : currentEnvelope!;
  await uploadManifest(finalVault, key, finalEnvelope.recovery, manifestFile?.version ?? null);
  await deletePrivateCloudFile(FOLDER, PENDING_FILE);
}

async function freshSession(webContentsId: number) {
  const current = sessions.get(webContentsId);
  if (!current || current.role !== getDeviceRole() || Date.now() - current.lastActivity >= SESSION_MS) {
    lockProtectedRegistry(webContentsId);
    throw new Error('Sesiunea registrului a expirat. Deblochează din nou modulul.');
  }
  setSession(current);
  return current;
}

async function mutate(
  webContentsId: number,
  operationIdInput: unknown,
  eventType: string,
  apply: (vault: ProtectedRegistryVault, operationId: string) => void,
  findReplay?: (vault: ProtectedRegistryVault) => boolean,
  rotateRecovery?: () => string,
  onCommitted?: (vault: ProtectedRegistryVault) => void,
  deferCloud = true,
) {
  return withRegistryRoutingLock(() => withPrivateCloudOperation(async () => {
    assertWriter();
    const validatedOperationId = requireText(operationIdInput, 'Identificatorul operației', 100);
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(validatedOperationId)) throw Error('Identificatorul operației este invalid.');
    if (deferCloud && deferredEvents.has(eventType) && !rotateRecovery && !onCommitted) {
      return stageProtectedMutation(webContentsId, validatedOperationId, eventType, apply, findReplay);
    }
    assertProtectedCloudSettled();
    const initialSession = await freshSession(webContentsId);
    // Only the dedicated Writer operation supplies this callback. Reauthenticate
    // inside the same queue as the cloud commit, never in the renderer.
    const newRecoveryKey = rotateRecovery?.();
    const operationId = requireText(operationIdInput, 'Identificatorul operației', 100);
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(operationId)) throw new Error('Identificatorul operației este invalid.');
    const key = keyBuffer();
    await reconcilePending(key);
    const latest = await loadVaultFromCloud(key);
    if (await freshSession(webContentsId) !== initialSession) throw new Error('Sesiunea registrului s-a schimbat. Reîncearcă.');
    if (getDeviceRole() !== 'writer') throw new Error('Operațiunea este disponibilă numai pe Writer.');
    const restoreLatestSession = () => {
      onCommitted?.(latest.vault);
      setSession({ ...initialSession, vault: latest.vault, envelope: latest.envelope, driveVersion: latest.driveVersion });
      return latest.vault;
    };
    if (findReplay?.(latest.vault)) return restoreLatestSession();
    if (findReplay && latest.vault.processedOperations.includes(operationId)) throw new Error('Identificatorul operației a fost deja utilizat.');
    if (latest.vault.processedOperations.includes(operationId)) return restoreLatestSession();
    const next = structuredClone(latest.vault);
    apply(next, operationId);
    next.revision += 1;
    next.updatedAt = new Date().toISOString();
    next.processedOperations.push(operationId);
    if (next.processedOperations.length > 10000) next.processedOperations.splice(0, next.processedOperations.length - 10000);
    addAudit(next, eventType, operationId, { revision: next.revision });
    const nextEnvelope = newRecoveryKey
      ? encryptVault(encode(next), key, newRecoveryKey, next.revision)
      : encryptVaultWithExistingRecovery(encode(next), key, next.revision, latest.envelope.recovery);
    if (newRecoveryKey) {
      // Keep an encrypted recovery point. Never write the recovery string or
      // change the data key/PIN: existing Writer and Viewer access must survive.
      await writeVerifiedPrivateCloudFile({ folderNames: ['Duplicat', 'Backups'],
        filename: `registru-separat-recovery-${randomUUID()}.vault`, mimeType: 'application/octet-stream',
        buffer: encode(latest.envelope), expectedVersion: null });
    }
    const pendingExisting = await readVerifiedPrivateCloudFile(FOLDER, PENDING_FILE);
    await writeVerifiedPrivateCloudFile({
      folderNames: FOLDER,
      filename: PENDING_FILE,
      mimeType: 'application/octet-stream',
      buffer: encode(nextEnvelope),
      expectedVersion: pendingExisting?.version ?? null,
    });
    await writeVerifiedPrivateCloudFile({
      folderNames: FOLDER,
      filename: VAULT_FILE,
      mimeType: 'application/octet-stream',
      buffer: encode(nextEnvelope),
      expectedVersion: latest.driveVersion,
    });
    const manifestExisting = await readVerifiedPrivateCloudFile(FOLDER, MANIFEST_FILE);
    await uploadManifest(next, key, nextEnvelope.recovery, manifestExisting?.version ?? null);
    await deletePrivateCloudFile(FOLDER, PENDING_FILE);
    // A cloud commit may finish after the user locks the register. Do not reopen
    // it or return protected data to an expired/replaced session.
    if (await freshSession(webContentsId) !== initialSession) throw new Error('Sesiunea registrului s-a schimbat. Deblochează din nou modulul.');
    if (getDeviceRole() !== 'writer') throw new Error('Operațiunea este disponibilă numai pe Writer.');
    setSession({ ...initialSession, webContentsId, lastActivity: Date.now(), vault: next, envelope: nextEnvelope,
      driveVersion: null, driveFileId: latest.driveFileId, cloudScope: latest.cloudScope });
    onCommitted?.(next);
    return next;
  }));
}

export function isProtectedRegistryEnabled() {
  return getCredential(ENABLED_CREDENTIAL) === '1';
}

export async function protectedRegistryStatus(webContentsId: number) {
  const readOnly = getDeviceRole() === 'viewer';
  const auth = readAuthState();
  const session = sessions.get(webContentsId);
  const sessionValid = Boolean(session && session.role === getDeviceRole() && Date.now() - session.lastActivity < SESSION_MS);
  if (session && !sessionValid) lockProtectedRegistry(webContentsId);
  const lockedUntil = auth?.lockUntil && Date.parse(auth.lockUntil) > Date.now() ? auth.lockUntil : null;
  let remoteVaultExists = false;
  if (!auth && !readOnly) {
    try { remoteVaultExists = Boolean(await readVerifiedPrivateCloudFile(FOLDER, VAULT_FILE)); } catch {}
  }
  return {
    readOnly,
    configured: readOnly || (isProtectedRegistryEnabled() && Boolean(auth)) || remoteVaultExists,
    needsRecovery: (readOnly || remoteVaultExists) && !auth,
    secureStorageAvailable: isCredentialStorageAvailable(),
    unlocked: sessionValid,
    lockedUntil,
    attemptsRemaining: lockedUntil ? 0 : Math.max(0, MAX_ATTEMPTS - (auth?.failedAttempts || 0)),
    mode: sessionValid ? session!.vault.mode : null,
    sessionExpiresAt: sessionValid ? new Date(session!.lastActivity + SESSION_MS).toISOString() : null,
  };
}

export async function configureProtectedRegistry(webContentsId: number, pin: unknown, pinConfirmation: unknown) {
  assertWriter();
  assertProtectedCloudSettled();
  if (!isCredentialStorageAvailable()) throw new Error('Windows nu oferă stocarea securizată necesară registrului.');
  if (isProtectedRegistryEnabled()) throw new Error('Registrul separat este deja configurat.');
  if (pin !== pinConfirmation) throw new Error('Cele două PIN-uri nu coincid.');
  const cloud = await getCloudStatus();
  if (!cloud.connectionHealthy) {
    throw new Error(cloud.lastError || 'Conexiunea Google Drive nu este validă. Reconectează contul din Setări înainte de configurarea registrului.');
  }
  const verifier = createPinVerifier(String(pin));
  const existing = await readVerifiedPrivateCloudFile(FOLDER, VAULT_FILE);
  if (existing) throw new Error('În Google Drive există deja un registru. Folosește cheia de recuperare, nu inițializarea.');
  const key = generateVaultKey();
  const recoveryKey = generateRecoveryKey();
  const vault = createEmptyProtectedVault();
  addAudit(vault, 'registry_configured', randomBytes(18).toString('base64url'), { mode: 'test' });
  const envelope = encryptVault(encode(vault), key, recoveryKey, vault.revision);
  await writeVerifiedPrivateCloudFile({ folderNames: FOLDER, filename: VAULT_FILE, mimeType: 'application/octet-stream', buffer: encode(envelope), expectedVersion: null });
  await uploadManifest(vault, key, envelope.recovery, null);
  setCredential(KEY_CREDENTIAL, key.toString('base64'));
  saveAuthState({ version: 1, pin: verifier, failedAttempts: 0, lockUntil: null });
  setCredential(ENABLED_CREDENTIAL, '1');
  setSession({ webContentsId, lastActivity: Date.now(), ...(await loadVaultFromCloud(key)) });
  return { success: true, recoveryKey, status: await protectedRegistryStatus(webContentsId) };
}

export async function unlockProtectedRegistry(webContentsId: number, pinInput: unknown) {
  const role = getDeviceRole();
  const generation = sessionGenerations.get(webContentsId) || 0;
  const auth = readAuthState();
  if (!auth || (role === 'writer' && !isProtectedRegistryEnabled())) throw new Error('Registrul separat nu este activat pe acest calculator.');
  if (auth.lockUntil && Date.parse(auth.lockUntil) > Date.now()) throw new Error(`Acces blocat până la ${new Date(auth.lockUntil).toLocaleTimeString('ro-RO')}.`);
  const pin = String(pinInput ?? '');
  if (!verifyPin(pin, auth.pin)) {
    const failed = registerFailedPinAttempt(auth.failedAttempts, Date.now(), MAX_ATTEMPTS, LOCKOUT_MS);
    auth.failedAttempts = failed.failedAttempts;
    auth.lockUntil = failed.lockUntil;
    saveAuthState(auth);
    throw new Error(auth.lockUntil ? 'Prea multe încercări greșite. Accesul a fost blocat 15 minute.' : `PIN incorect. Mai ai ${MAX_ATTEMPTS - auth.failedAttempts} încercări.`);
  }
  auth.failedAttempts = 0;
  auth.lockUntil = null;
  saveAuthState(auth);
  return withRegistryRoutingLock(async () => {
    const key = keyBuffer();
    if (role === 'writer') {
      protectedOutbox.discardIncompleteWrites();
      if (protectedOutbox.hasPending()) await protectedUploader.start();
      else await reconcilePending(key);
    }
    const latest = await loadVaultFromCloud(key);
    const pending = role === 'writer' ? protectedOutbox.read() : [];
    if (pending.some(entry => entry.value.scope !== latest.cloudScope || entry.value.fileId !== latest.driveFileId)) {
      throw Error('Salvările temporare aparțin altui cont Drive sau altui seif. Datele au fost păstrate.');
    }
    const tail = pending.at(-1)?.value;
    if (tail) {
      latest.vault = parseVault(encode(tail.vault));
      latest.envelope = encryptVaultWithExistingRecovery(encode(latest.vault), key, latest.vault.revision, tail.recovery);
    }
    if (getDeviceRole() !== role || (sessionGenerations.get(webContentsId) || 0) !== generation) throw new Error('Accesul a fost închis. Deblochează din nou registrul.');
    setSession({ webContentsId, lastActivity: Date.now(), ...latest });
    return protectedRegistryStatus(webContentsId);
  });
}

export function lockProtectedRegistry(webContentsId: number) {
  sessionGenerations.set(webContentsId, (sessionGenerations.get(webContentsId) || 0) + 1);
  const timer = sessionTimers.get(webContentsId);
  if (timer) clearTimeout(timer);
  sessionTimers.delete(webContentsId);
  sessions.delete(webContentsId);
  for (const filePath of temporaryFiles.get(webContentsId) || []) {
    stopWindowsDocumentProcessesForFile(filePath);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  }
  temporaryFiles.delete(webContentsId);
  return { success: true };
}

export async function touchProtectedRegistrySession(webContentsId: number) {
  const session = await freshSession(webContentsId);
  return { success: true, sessionExpiresAt: new Date(session.lastActivity + SESSION_MS).toISOString() };
}

export function lockAllProtectedRegistrySessions() {
  for (const id of new Set([...sessions.keys(), ...temporaryFiles.keys()])) lockProtectedRegistry(id);
}

export function cleanupStaleProtectedRegistryTemporaryFiles() {
  const tempDirectory = app.getPath('temp');
  try {
    for (const name of fs.readdirSync(tempDirectory)) {
      if (/^vr-hub-protected-[0-9a-f-]{36}\.pdf$/i.test(name)) {
        try { fs.unlinkSync(path.join(tempDirectory, name)); } catch {}
      }
    }
  } catch {}
}

export async function activateProtectedViewer(webContentsId: number, recoveryKeyInput: unknown, newPin: unknown, confirmation: unknown) {
  if (getDeviceRole() !== 'viewer') throw new Error('Activarea este disponibilă numai pe Viewer.');
  if (!isCredentialStorageAvailable()) throw new Error('Stocarea securizată nu este disponibilă.');
  if (newPin !== confirmation) throw new Error('Cele două PIN-uri nu coincid.');
  const verifier = createPinVerifier(String(newPin));
  const generation = sessionGenerations.get(webContentsId) || 0;
  const file = await readProtectedViewerVault();
  if (!file) throw new Error('Registrul nu există în contul Google Drive conectat.');
  const envelope = parseEnvelope(file.buffer);
  const key = recoverVaultKey(envelope, String(recoveryKeyInput ?? ''));
  const vault = parseVault(decryptVault(envelope, key));
  if (getDeviceRole() !== 'viewer' || (sessionGenerations.get(webContentsId) || 0) !== generation) throw new Error('Activarea a fost întreruptă.');
  // Separate OS-protected credentials; never replace Writer authentication or upload an audit/recovery mutation.
  setCredential(registryCredential(KEY_CREDENTIAL), key.toString('base64'));
  saveAuthState({ version: 1, pin: verifier, failedAttempts: 0, lockUntil: null });
  setSession({ webContentsId, lastActivity: Date.now(), vault, envelope, driveVersion: file.version });
  return protectedRegistryStatus(webContentsId);
}

export async function refreshProtectedViewer(webContentsId: number) {
  if (getDeviceRole() !== 'viewer') throw new Error('Operațiune disponibilă numai pe Viewer.');
  const session = await freshSession(webContentsId);
  const latest = await loadVaultFromCloud(keyBuffer());
  if (getDeviceRole() !== 'viewer' || await freshSession(webContentsId) !== session) throw new Error('Sesiunea s-a schimbat. Deblochează din nou.');
  if (latest.vault.revision < session.vault.revision) throw new Error('Drive a returnat o versiune mai veche a registrului. Reîncearcă.');
  Object.assign(session, latest);
  return { success: true, revision: session.vault.revision };
}

export async function recoverProtectedRegistry(webContentsId: number, recoveryKeyInput: unknown, newPin: unknown, newPinConfirmation: unknown) {
  assertProtectedCloudSettled();
  assertWriter();
  if (newPin !== newPinConfirmation) throw new Error('Cele două PIN-uri nu coincid.');
  const verifier = createPinVerifier(String(newPin));
  const file = await readVerifiedPrivateCloudFile(FOLDER, VAULT_FILE);
  if (!file) throw new Error('Seiful registrului nu a fost găsit în Google Drive.');
  const envelope = parseEnvelope(file.buffer);
  const key = recoverVaultKey(envelope, String(recoveryKeyInput ?? ''));
  const vault = parseVault(decryptVault(envelope, key));
  setCredential(KEY_CREDENTIAL, key.toString('base64'));
  saveAuthState({ version: 1, pin: verifier, failedAttempts: 0, lockUntil: null });
  setCredential(ENABLED_CREDENTIAL, '1');
  setSession({ webContentsId, lastActivity: Date.now(), vault, envelope, driveVersion: file.version });
  await mutate(webContentsId, randomBytes(18).toString('base64url'), 'registry_recovered', () => invalidateNormalBillingVisibility(db));
  await ensureNormalBillingVisibility();
  return protectedRegistryStatus(webContentsId);
}

export async function changeProtectedRegistryPin(webContentsId: number, currentPinInput: unknown, newPinInput: unknown, confirmationInput: unknown) {
  assertWriter();
  await freshSession(webContentsId);
  const auth = readAuthState();
  if (!auth || !verifyPin(String(currentPinInput ?? ''), auth.pin)) throw new Error('PIN-ul actual este incorect.');
  if (newPinInput !== confirmationInput) throw new Error('Cele două PIN-uri noi nu coincid.');
  await mutate(webContentsId, randomBytes(18).toString('base64url'), 'pin_changed', () => undefined);
  auth.pin = createPinVerifier(String(newPinInput));
  auth.failedAttempts = 0;
  auth.lockUntil = null;
  saveAuthState(auth);
  return { success: true };
}

export async function rotateProtectedRecoveryKey(webContentsId: number, currentPinInput: unknown, confirmed: unknown) {
  assertWriter();
  if (confirmed !== true) throw new Error('Confirmă înlocuirea cheii de recuperare.');
  if (recoveryRotations.size) throw new Error('Generarea unei chei este deja în curs. Așteaptă finalizarea.');
  recoveryRotations.add(webContentsId);
  let recoveryKey = '';
  let authorized = false;
  try {
    await mutate(webContentsId, randomUUID(), 'recovery_key_rotated', () => undefined, undefined, () => {
      const auth = readAuthState();
      if (!auth) throw new Error('Autentificarea Writer lipsește. Deblochează din nou registrul.');
      if (auth.lockUntil && Date.parse(auth.lockUntil) > Date.now()) throw new Error('Acces blocat temporar. Încearcă după expirarea blocării.');
      if (typeof currentPinInput !== 'string' || !/^\d{6}$/.test(currentPinInput) || !verifyPin(currentPinInput, auth.pin)) {
        const failed = registerFailedPinAttempt(auth.failedAttempts, Date.now(), MAX_ATTEMPTS, LOCKOUT_MS);
        Object.assign(auth, failed);
        saveAuthState(auth);
        if (auth.lockUntil) lockProtectedRegistry(webContentsId);
        throw new Error(auth.lockUntil ? 'Prea multe încercări greșite. Accesul a fost blocat 15 minute.' : 'PIN-ul actual este incorect.');
      }
      auth.failedAttempts = 0; auth.lockUntil = null;
      saveAuthState(auth);
      authorized = true;
      recoveryKey = generateRecoveryKey();
      return recoveryKey;
    });
    await freshSession(webContentsId);
    assertWriter();
    return { success: true as const, recoveryKey };
  } catch (error) {
    if (!authorized) throw error;
    // A lost cloud response can leave a committed pending envelope. The next
    // attempt reconciles it and generates another key; never show an unverified
    // key, persist plaintext for replay or claim a failed commit was rolled back.
    throw new Error('Noua cheie nu a putut fi confirmată și nu este afișată. Deblochează registrul dacă este necesar și reîncearcă generarea. Accesul existent cu PIN nu este schimbat.');
  } finally {
    recoveryKey = '';
    recoveryRotations.delete(webContentsId);
  }
}

export async function getProtectedRegistryOverview(webContentsId: number, from?: unknown, to?: unknown) {
  const session = await freshSession(webContentsId);
  return protectedRegistryOverview(session.vault, from, to);
}

export async function listProtectedRegistryCompanies(webContentsId: number) {
  const session = await freshSession(webContentsId);
  if (session.role === 'viewer') {
    const keys = new Set([...session.vault.assignments.map(row => row.companyKey), ...session.vault.invoices.map(row => row.companyKey)]);
    return [...keys].map(key => {
      const assignment = session.vault.assignments.find(row => row.companyKey === key);
      const invoices = session.vault.invoices.filter(row => row.companyKey === key);
      const last = invoices.at(-1);
      const stores = new Map(invoices.map(row => [row.storeId, { id: row.storeId, name: row.storeName, address: row.storeSnapshot.address }]));
      return { id: assignment?.localCompanyId ?? last?.companyId, companyKey: key, name: assignment?.companyName || last?.companyName || 'Companie istorică',
        address: last?.companySnapshot.address, stores: [...stores.values()], assigned: Boolean(assignment) };
    });
  }
  const companies = billingRepo.getAllCompaniesAndStoresForRouting() as any[];
  const assigned = new Set(session.vault.assignments.map((entry) => entry.companyKey));
  return companies.map((company) => ({
    id: company.id,
    name: company.name,
    companyKey: companyKey(company),
    address: company.address,
    cui: company.cui,
    reg_com: company.reg_com,
    issuerName: company.issuer_name,
    issuerCode: company.issuer_code,
    stores: company.stores.map((store: any) => ({ id: store.id, name: store.name, address: store.address })),
    assigned: assigned.has(companyKey(company)),
  }));
}

export async function setProtectedRegistryAssignment(webContentsId: number, companyIdInput: unknown, assignedInput: unknown, operationId: unknown) {
  const companyId = requirePositiveInteger(companyIdInput, 'Compania');
  const company = db.prepare('SELECT id, name, supabase_company_id FROM companies WHERE id = ? AND is_active = 1').get(companyId) as { id: number; name: string; supabase_company_id: string | null } | undefined;
  if (!company) throw new Error('Compania nu există sau este inactivă.');
  const assigned = assignedInput === true;
  const key = companyKey(company);
  const vault = await mutate(webContentsId, operationId, assigned ? 'company_assigned' : 'company_unassigned', (next, opId) => {
    // Fail closed across an interrupted/ambiguous cloud assignment commit.
    invalidateNormalBillingVisibility(db);
    const index = next.assignments.findIndex((entry) => entry.companyKey === key);
    if (assigned && index < 0) next.assignments.push({ companyKey: key, localCompanyId: company.id, companyName: company.name, assignedAt: new Date().toISOString() });
    if (!assigned && index >= 0) next.assignments.splice(index, 1);
    addAudit(next, assigned ? 'assignment_changed_to_protected' : 'assignment_removed_from_protected', opId, { companyKey: routingHash(keyBuffer(), 'company', key) }, 'company', null);
  }, undefined, undefined, committed => {
    const assignedKeys = new Set(committed.assignments.map(entry => entry.companyKey));
    const companies = db.prepare('SELECT id,supabase_company_id FROM companies').all() as Array<{ id: number; supabase_company_id: string | null }>;
    replaceNormalBillingVisibility(db, companies.filter(company => assignedKeys.has(companyKey(company))).map(company => company.id));
    // `typeof` keeps the isolated legacy service harness independent from the
    // platform mirror adapter while the packaged app always has the import.
    if (!assigned && typeof queueNormalPublicationAfterProtected === 'function') queueNormalPublicationAfterProtected(db, committed, key);
  });
  return { success: true, revision: vault.revision };
}

/** One-time upgrade/invalidated snapshot refresh. Subsequent reads work offline. */
export async function ensureNormalBillingVisibility() {
  if (normalBillingVisibilityReady(db)) return;
  if (getDeviceRole() !== 'writer') { assertNormalBillingVisibilityReady(db); return; }
  return withRegistryRoutingLock(async () => {
    if (normalBillingVisibilityReady(db)) return;
    const connection = db;
    const policy = await loadProtectedRoutingPolicy();
    if (connection !== db || getDeviceRole() !== 'writer') throw Error('Baza de date sau rolul s-a schimbat. Reia verificarea facturării.');
    const companies = db.prepare('SELECT id,supabase_company_id FROM companies').all() as Array<{ id: number; supabase_company_id: string | null }>;
    replaceNormalBillingVisibility(db, companies.filter(company => policy.key && policy.companyHashes.has(routingHash(policy.key, 'company', companyKey(company)))).map(company => company.id));
  });
}

export async function setProtectedRegistryMode(webContentsId: number, modeInput: unknown, confirmationInput: unknown, operationId: unknown) {
  const mode = modeInput === 'live' ? 'live' : modeInput === 'test' ? 'test' : null;
  if (!mode) throw new Error('Modul selectat este invalid.');
  const confirmation = String(confirmationInput ?? '').trim().toUpperCase();
  const vault = await mutate(webContentsId, operationId, 'mode_changed', (next) => {
    if (next.mode === mode) return;
    if (mode === 'test') {
      if (next.liveStartedAt) throw new Error('Modul test nu mai poate fi reactivat după prima emitere live.');
      next.mode = 'test';
      return;
    }
    if (confirmation !== 'ACTIVEAZA LIVE') throw new Error('Scrie exact ACTIVEAZA LIVE pentru confirmare.');
    assertCanGoLive(next);
    next.mode = 'live';
  });
  return { success: true, mode: vault.mode };
}

export async function clearProtectedRegistryTestFinancialData(webContentsId: number, confirmationInput: unknown, operationId: unknown) {
  const confirmation = String(confirmationInput ?? '').trim().toUpperCase();
  if (confirmation !== 'CURATA TEST') throw new Error('Scrie exact CURATA TEST pentru confirmare.');
  await backupCurrentVault(webContentsId, 'clear-test-financial-data');
  const vault = await mutate(webContentsId, operationId, 'protected_test_financial_data_cleared', (next) => {
    if (next.mode !== 'test' || next.liveStartedAt) throw new Error('Curățarea este permisă numai în Modul test, înainte de prima emitere live.');
    if (next.invoices.some((invoice) => invoice.testDocument) || next.creditNotes.some((note) => note.testDocument)) {
      throw new Error('Șterge mai întâi toate facturile și Credit Notes de test.');
    }
    next.payments = next.payments.filter((payment) => !payment.testEntry);
    next.creditApplications = next.creditApplications.filter((application) => !application.testEntry);
    next.creditEntries = next.creditEntries.filter((entry) => !entry.testEntry);
  });
  return { success: true, revision: vault.revision };
}

export async function loadProtectedRoutingPolicy() {
  assertWriter();
  assertProtectedCloudSettled();
  if (!isProtectedRegistryEnabled()) {
    const remoteVault = await readVerifiedPrivateCloudFile(FOLDER, VAULT_FILE);
    if (!remoteVault) return { enabled: false, vaultRevision: 0, companyHashes: new Set<string>(), orderHashes: new Set<string>(), key: null as Buffer | null };
    throw new Error('În Google Drive există un registru separat. Recuperează accesul pe acest Writer înainte de facturare.');
  }
  const key = keyBuffer();
  const pending = await readVerifiedPrivateCloudFile(FOLDER, PENDING_FILE);
  if (pending) throw new Error('Registrul separat are o operație nefinalizată. Deblochează modulul pentru reconciliere.');
  const [vaultFile, manifestFile] = await Promise.all([
    readVerifiedPrivateCloudFile(FOLDER, VAULT_FILE),
    readVerifiedPrivateCloudFile(FOLDER, MANIFEST_FILE),
  ]);
  if (!vaultFile || !manifestFile) throw new Error('Registrul separat sau manifestul său lipsește din Google Drive.');
  const vaultEnvelope = parseEnvelope(vaultFile.buffer);
  const manifestEnvelope = parseEnvelope(manifestFile.buffer);
  const vault = parseVault(decryptVault(vaultEnvelope, key));
  const manifest = parseManifest(decryptVault(manifestEnvelope, key));
  if (manifest.vaultRevision !== vault.revision || vaultEnvelope.revision !== manifestEnvelope.revision) {
    throw new Error('Manifestul registrului separat nu corespunde versiunii autoritare din Google Drive.');
  }
  return {
    enabled: true,
    vaultRevision: vault.revision,
    companyHashes: new Set(manifest.companyHashes),
    orderHashes: new Set(manifest.protectedOrderHashes),
    key,
  };
}

export async function filterNormalWeeklyGroups<T extends { store: { company?: { id: string } | null }; sourceOrders: Array<{ id: string }> }>(groups: T[]) {
  const policy = await loadProtectedRoutingPolicy();
  if (!policy.enabled || !policy.key) return groups;
  return groups.filter((group) => {
    const companyExternalId = group.store.company?.id;
    if (companyExternalId && policy.companyHashes.has(routingHash(policy.key!, 'company', `vrbaker:${companyExternalId}`))) return false;
    return !group.sourceOrders.some((order) => policy.orderHashes.has(routingHash(policy.key!, 'order', order.id)));
  });
}

export async function assertNormalStoreAllowed(storeIdInput: unknown) {
  const policy = await loadProtectedRoutingPolicy();
  if (!policy.enabled || !policy.key) return;
  const storeId = requirePositiveInteger(storeIdInput, 'Magazinul');
  const company = db.prepare(`
    SELECT c.id, c.supabase_company_id FROM stores s JOIN companies c ON c.id = s.company_id WHERE s.id = ?
  `).get(storeId) as { id: number; supabase_company_id: string | null } | undefined;
  if (!company) throw new Error('Magazinul nu există.');
  if (policy.companyHashes.has(routingHash(policy.key, 'company', companyKey(company)))) {
    throw new Error('Clientul este atribuit registrului separat și nu poate fi facturat în registrul normal.');
  }
}

export async function getNormalManualInvoiceCompanies() {
  if (getDeviceRole() !== 'writer') return billingRepo.getAllCompaniesAndStores();
  const policy = await loadProtectedRoutingPolicy();
  const companies = billingRepo.getAllCompaniesAndStoresForRouting() as any[];
  if (!policy.enabled || !policy.key) return companies;
  return companies.filter((company) => !policy.companyHashes.has(routingHash(policy.key!, 'company', companyKey(company))));
}

export async function previewProtectedWeeklyInvoices(webContentsId: number, startDate: string, endDate: string) {
  const session = await freshSession(webContentsId);
  const client = createVrBakerClient();
  const snapshot = await client.fetchWeeklyBillingSnapshot(startDate, endDate);
  const stores = [...new Map(snapshot.orders.map((order) => [order.store.id, order.store])).values()];
  const companies = [...new Map(stores.flatMap((store) => store.company ? [[store.company.id, store.company] as const] : [])).values()];
  billingRepo.syncEntitiesFromVrBaker(companies, stores);
  const assigned = new Set(session.vault.assignments.map((entry) => entry.companyKey));
  const alreadyBilled = new Set(session.vault.invoices.flatMap((invoice) => invoice.sourceOrderIds));
  const groups = aggregateWeeklyOrders(snapshot.orders)
    .filter((group) => group.store.company && assigned.has(`vrbaker:${group.store.company.id}`))
    .map((group) => ({
      ...group,
      billingState: group.sourceOrders.some((order) => alreadyBilled.has(order.id)) ? 'invoiced' as const : 'ready' as const,
      issuer: billingRepo.getIssuerPreviewByStoreExternalId(group.store.id),
    }));
  return { ordersByStore: groups, zones: snapshot.zones };
}

function requireIsoDate(value: unknown, label: string) {
  const text = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new Error(`${label} nu este validă.`);
  return text;
}

function requireMoney(value: unknown, label: string, allowZero = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed <= 0) || parsed > 1_000_000_000) throw new Error(`${label} nu este validă.`);
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function protectedSeries(code: ProtectedIssuerCode) {
  return code === 'goodness' ? 'TGBL' as const : 'VRL' as const;
}

function readIssuer(issuerId: number) {
  const issuer = db.prepare('SELECT * FROM billing_issuers WHERE id = ?').get(issuerId) as BillingIssuerRow | undefined;
  if (!issuer || !isIssuerReady(issuer)) throw new Error('Societatea emitentă a clientului nu este activă sau configurată complet.');
  if (issuer.code !== 'goodness' && issuer.code !== 'vatra') throw new Error('Societatea emitentă nu este acceptată în registrul separat.');
  return issuer as BillingIssuerRow & { code: ProtectedIssuerCode };
}

function readStoreSnapshot(storeId: number) {
  const row = db.prepare(`
    SELECT s.id, s.name, s.address, s.postcode, s.phone, s.supabase_store_id,
           c.id AS company_id, c.name AS company_name, c.address AS company_address,
           c.cui AS company_cui, c.reg_com AS company_reg_com, c.supabase_company_id,
           c.issuer_id, cl.name AS client_name
    FROM stores s JOIN companies c ON c.id = s.company_id JOIN clients cl ON cl.id = c.client_id
    WHERE s.id = ? AND s.is_active = 1 AND c.is_active = 1
  `).get(storeId) as any;
  if (!row) throw new Error('Magazinul sau compania nu mai există ori este inactivă.');
  return row;
}

function createProtectedInvoiceRecord(input: {
  operationId: string;
  invoiceDate: string;
  store: any;
  issuer: BillingIssuerRow & { code: ProtectedIssuerCode };
  sequenceNumber: number;
  items: Array<{ externalProductId?: string | null; productName: string; name_ro?: string | null; unit?: string | null; quantity: number; unitPrice: number; totalPrice?: number; productOrder?: number | null }>;
  sourceOrders?: Array<{ id: string }>;
  sourceFingerprint?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  testDocument: boolean;
}): ProtectedInvoice {
  const series = protectedSeries(input.issuer.code);
  const items: ProtectedInvoiceItem[] = input.items.map((item) => {
    const quantity = requireMoney(item.quantity, `Cantitatea pentru ${item.productName}`);
    const unitPrice = requireMoney(item.unitPrice, `Prețul pentru ${item.productName}`, true);
    const externalProductId = item.externalProductId || null;
    const product = externalProductId
      ? db.prepare('SELECT id FROM finished_products WHERE external_product_id = ? LIMIT 1').get(externalProductId) as { id: number } | undefined
      : undefined;
    return {
      id: randomUUID(),
      externalProductId,
      finishedProductId: product?.id || null,
      productName: requireText(item.productName, 'Denumirea produsului', 300),
      productNameRo: item.name_ro ? requireText(item.name_ro, 'Denumirea produsului în română', 300) : null,
      unit: item.unit ? requireText(item.unit, 'Unitatea produsului', 50) : 'buc',
      quantity,
      unitPrice,
      totalPrice: Math.round(quantity * unitPrice * 100) / 100,
      productOrder: Number.isSafeInteger(item.productOrder) ? Number(item.productOrder) : null,
    };
  }).sort((left, right) => (left.productOrder ?? Number.MAX_SAFE_INTEGER) - (right.productOrder ?? Number.MAX_SAFE_INTEGER) || left.productName.localeCompare(right.productName, 'en-GB'));
  if (items.length === 0 || items.length > 1000) throw new Error('Factura trebuie să conțină între 1 și 1000 de poziții.');
  const totalAmount = Math.round(items.reduce((sum, item) => sum + item.totalPrice, 0) * 100) / 100;
  return {
    id: randomUUID(),
    operationId: input.operationId,
    reference: `${series}-${input.sequenceNumber}`,
    series,
    sequenceNumber: input.sequenceNumber,
    invoiceDate: input.invoiceDate,
    companyKey: companyKey({ id: input.store.company_id, supabase_company_id: input.store.supabase_company_id }),
    companyId: input.store.company_id,
    companyName: input.store.company_name,
    companySnapshot: {
      name: input.store.company_name,
      clientName: input.store.client_name,
      address: input.store.company_address,
      vatNumber: input.store.company_cui,
      registrationNumber: input.store.company_reg_com,
    },
    storeExternalId: input.store.supabase_store_id || null,
    storeId: input.store.id,
    storeName: input.store.name,
    storeSnapshot: { name: input.store.name, address: input.store.address, postcode: input.store.postcode, phone: input.store.phone },
    issuerId: input.issuer.id,
    issuerCode: input.issuer.code,
    issuerSnapshot: issuerSnapshot(input.issuer),
    items,
    sourceOrderIds: (input.sourceOrders || []).map((order) => requireText(order.id, 'ID comandă', 100)),
    sourceFingerprint: input.sourceFingerprint || null,
    periodStart: input.periodStart || null,
    periodEnd: input.periodEnd || null,
    totalAmount,
    paidAmount: 0,
    creditedAmount: 0,
    status: 'unpaid',
    testDocument: input.testDocument,
    createdAt: new Date().toISOString(),
    cancelledAt: null,
    cancellationReason: null,
    replacesInvoiceId: null,
    replacedByInvoiceId: null,
  };
}

function renderProtectedInvoicePdf(invoice: ProtectedInvoice, vault: ProtectedRegistryVault) {
  const snapshot = invoice.issuerSnapshot as any;
  const buffer = generateInvoicePDF(
    {
      ...snapshot,
      invoiceSeries: invoice.series,
      invoiceLogo: billingRepo.getAppSetting('invoice_logo') || '',
      testDocument: invoice.testDocument,
    },
    {
      invoiceNumber: invoice.reference,
      invoiceDate: invoice.invoiceDate,
      client: {
        name: String(invoice.companySnapshot.name || invoice.companyName),
        cui: String(invoice.companySnapshot.vatNumber || ''),
        regCom: String(invoice.companySnapshot.registrationNumber || ''),
        address: String(invoice.companySnapshot.address || ''),
      },
      store: {
        name: String(invoice.storeSnapshot.name || invoice.storeName),
        address: String(invoice.storeSnapshot.address || ''),
        postcode: String(invoice.storeSnapshot.postcode || ''),
        phone: String(invoice.storeSnapshot.phone || ''),
      },
      items: invoice.items.map((item) => ({ productName: item.productName, name_ro: item.productNameRo || undefined, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice, totalPrice: item.totalPrice })),
      totalAmount: invoice.totalAmount,
      accountOutstanding: protectedInvoiceOutstanding(vault, invoice),
    },
  );
  return buffer;
}

async function uploadProtectedInvoicePdf(invoice: ProtectedInvoice, vault: ProtectedRegistryVault, accountScope?: string) {
  assertWriter();
  const buffer = renderProtectedInvoicePdf(invoice, vault);
  const filename = `Factura_${invoice.reference}.pdf`;
  const folderNames = protectedCloudDocumentFolders(invoice.companyName, 'Facturi');
  await writeVerifiedPrivateCloudFile({ folderNames, filename, mimeType: 'application/pdf', buffer, accountScope });
  return { filename, folder: folderNames.join('/') };
}

function protectedDocumentFolders(type: 'invoice' | 'credit-note', record: ProtectedInvoice | ProtectedCreditNote) {
  return type === 'invoice'
    ? protectedCloudDocumentFolders(record.companyName, 'Facturi')
    : protectedCloudDocumentFolders(record.companyName, 'Credit Notes');
}

function legacyProtectedDocumentFolders(type: 'invoice' | 'credit-note', record: ProtectedInvoice | ProtectedCreditNote) {
  return type === 'invoice'
    ? ['Duplicat', 'Facturi', record.series]
    : ['Duplicat', 'Credit Notes', record.series];
}

async function readProtectedDocumentPdf(type: 'invoice' | 'credit-note', record: ProtectedInvoice | ProtectedCreditNote, filename: string) {
  return await readVerifiedPrivateCloudFile(protectedDocumentFolders(type, record), filename)
    || await readVerifiedPrivateCloudFile(legacyProtectedDocumentFolders(type, record), filename);
}

async function deleteProtectedDocumentPdf(type: 'invoice' | 'credit-note', record: ProtectedInvoice | ProtectedCreditNote, filename: string) {
  const deletedCurrent = await deletePrivateCloudFile(protectedDocumentFolders(type, record), filename);
  const deletedLegacy = await deletePrivateCloudFile(legacyProtectedDocumentFolders(type, record), filename);
  return deletedCurrent || deletedLegacy;
}

export async function createProtectedWeeklyInvoices(
  webContentsId: number,
  startDateInput: string,
  endDateInput: string,
  storeExternalIdsInput: unknown,
  operationId: unknown,
) {
  const { startDate, endDate } = validateWeeklyPeriod(startDateInput, endDateInput);
  if (!Array.isArray(storeExternalIdsInput) || storeExternalIdsInput.length === 0 || storeExternalIdsInput.length > 500) throw new Error('Selecția magazinelor este invalidă.');
  const requested = new Set(storeExternalIdsInput.map((value) => requireText(value, 'ID magazin', 100)));
  if (requested.size !== storeExternalIdsInput.length) throw new Error('Selecția conține magazine duplicate.');
  const preview = await previewProtectedWeeklyInvoices(webContentsId, startDate, endDate);
  const selected = preview.ordersByStore.filter((group) => requested.has(group.store.id));
  if (selected.length !== requested.size) throw new Error('Unele magazine nu mai sunt eligibile pentru registrul separat.');
  if (selected.some((group) => group.billingState !== 'ready')) throw new Error('Una dintre comenzile selectate a fost deja facturată.');
  for (const group of selected) {
    for (const order of group.sourceOrders) {
      if (db.prepare('SELECT 1 FROM invoice_source_orders WHERE external_order_id = ?').get(order.id)) {
        throw new Error('O comandă selectată există deja în registrul normal.');
      }
    }
  }
  const prepared = selected.map((group) => {
    const localId = billingRepo.getStoreBySupabaseId(group.store.id);
    if (!localId) throw new Error(`Magazinul „${group.store.name}” nu este mapat local.`);
    const store = readStoreSnapshot(localId);
    const issuer = readIssuer(store.issuer_id);
    return { group, store, issuer };
  });
  const created: ProtectedInvoice[] = [];
  const result = await mutate(webContentsId, operationId, 'protected_invoice_batch_issued', (next, opId) => {
    const assigned = new Set(next.assignments.map((entry) => entry.companyKey));
    const usedOrders = new Set(next.invoices.flatMap((invoice) => invoice.sourceOrderIds));
    const nextCounters = { ...next.counters };
    for (const row of prepared) {
      const key = companyKey({ id: row.store.company_id, supabase_company_id: row.store.supabase_company_id });
      if (!assigned.has(key)) throw new Error(`Clientul ${row.store.company_name} nu mai este atribuit registrului separat.`);
      if (row.group.sourceOrders.some((order) => usedOrders.has(order.id))) throw new Error('O comandă a fost facturată deja în registrul separat.');
      if (row.group.sourceOrders.some((order) => db.prepare('SELECT 1 FROM invoice_source_orders WHERE external_order_id = ?').get(order.id))) {
        throw new Error('O comandă selectată a fost facturată între timp în registrul normal.');
      }
      const series = protectedSeries(row.issuer.code);
      const invoice = createProtectedInvoiceRecord({
        operationId: opId,
        invoiceDate: new Date().toISOString().slice(0, 10),
        store: row.store,
        issuer: row.issuer,
        sequenceNumber: nextCounters[series],
        items: row.group.items,
        sourceOrders: row.group.sourceOrders,
        sourceFingerprint: row.group.sourceFingerprint,
        periodStart: startDate,
        periodEnd: endDate,
        testDocument: next.mode === 'test',
      });
      nextCounters[series] += 1;
      next.invoices.push(invoice);
      applyAutomaticProtectedCredit(next, invoice);
      if (!invoice.testDocument) next.liveStartedAt ||= invoice.createdAt;
      created.push(invoice);
      for (const source of invoice.sourceOrderIds) usedOrders.add(source);
    }
    next.counters = nextCounters;
  });
  const issued = created.length ? created : result.invoices.filter((invoice) => invoice.operationId === operationId);
  const pdfResults = issued.map(invoice => ({ invoiceId: invoice.id, success: true, pending: protectedOutbox.hasPending() }));
  return { success: true, invoices: issued, pdfResults };
}

export async function createProtectedWeeklyInvoicesByZone(
  webContentsId: number,
  startDate: string,
  endDate: string,
  zoneIdInput: unknown,
  operationId: unknown,
) {
  const zoneId = zoneIdInput === null ? null : requireText(zoneIdInput, 'Zona', 100);
  const preview = await previewProtectedWeeklyInvoices(webContentsId, startDate, endDate);
  if (zoneId !== null && !preview.zones.some((zone) => zone.id === zoneId)) throw new Error('Zona selectată nu mai există în exportul actual.');
  const stores = preview.ordersByStore.filter((group) => (group.store.zone?.id || null) === zoneId && group.billingState === 'ready').map((group) => group.store.id);
  if (!stores.length) throw new Error('Zona nu are facturi pregătite.');
  return createProtectedWeeklyInvoices(webContentsId, startDate, endDate, stores, operationId);
}

export async function createAllProtectedWeeklyInvoices(webContentsId: number, startDate: string, endDate: string, operationId: unknown) {
  const preview = await previewProtectedWeeklyInvoices(webContentsId, startDate, endDate);
  const stores = preview.ordersByStore.filter((group) => group.billingState === 'ready').map((group) => group.store.id);
  if (!stores.length) throw new Error('Nu există facturi pregătite în registrul separat.');
  return createProtectedWeeklyInvoices(webContentsId, startDate, endDate, stores, operationId);
}

export async function getProtectedManualInvoiceData(webContentsId: number) {
  const session = await freshSession(webContentsId);
  const assigned = new Set(session.vault.assignments.map((entry) => entry.companyKey));
  const companies = (billingRepo.getAllCompaniesAndStoresForRouting() as any[]).filter((company) => assigned.has(companyKey(company)));
  return { companies, products: billingRepo.getCloudProducts() };
}

export async function createProtectedManualInvoice(webContentsId: number, input: any, operationId: unknown) {
  await freshSession(webContentsId);
  const storeId = requirePositiveInteger(input?.storeId, 'Magazinul');
  const invoiceDate = requireIsoDate(input?.invoiceDate, 'Data facturii');
  if (!Array.isArray(input?.items) || input.items.length === 0 || input.items.length > 200) throw new Error('Factura manuală trebuie să conțină între 1 și 200 de produse.');
  const store = readStoreSnapshot(storeId);
  const issuer = readIssuer(store.issuer_id);
  const seen = new Set<number>();
  const items = input.items.map((line: any) => {
    const productId = requirePositiveInteger(line.productId, 'Produsul');
    if (seen.has(productId)) throw new Error('Același produs nu poate apărea de două ori.');
    seen.add(productId);
    const product = db.prepare('SELECT * FROM cloud_products WHERE id = ? AND available = 1').get(productId) as any;
    if (!product) throw new Error('Un produs nu mai este disponibil.');
    return {
      externalProductId: product.supabase_product_id,
      productName: product.name,
      name_ro: product.name_ro,
      unit: product.unit,
      quantity: requireMoney(line.quantity, `Cantitatea pentru ${product.name}`),
      unitPrice: requireMoney(line.unitPrice, `Prețul pentru ${product.name}`, true),
      productOrder: product.display_order,
    };
  });
  const created: ProtectedInvoice[] = [];
  const result = await mutate(webContentsId, operationId, 'protected_manual_invoice_issued', (next, opId) => {
    const key = companyKey({ id: store.company_id, supabase_company_id: store.supabase_company_id });
    if (!next.assignments.some((entry) => entry.companyKey === key)) throw new Error('Clientul nu mai este atribuit registrului separat.');
    const series = protectedSeries(issuer.code);
    const invoice = createProtectedInvoiceRecord({ operationId: opId, invoiceDate, store, issuer, sequenceNumber: next.counters[series], items, testDocument: next.mode === 'test' });
    next.counters[series] += 1;
    next.invoices.push(invoice);
    applyAutomaticProtectedCredit(next, invoice);
    if (!invoice.testDocument) next.liveStartedAt ||= invoice.createdAt;
    created.push(invoice);
  });
  const invoice = created[0] || result.invoices.find((row) => row.operationId === operationId);
  if (!invoice) throw new Error('Factura emisă nu a putut fi recitită.');
  return { success: true, invoice, pdf: { success: true, pending: protectedOutbox.hasPending() } };
}

export async function listProtectedInvoices(webContentsId: number) {
  const session = await freshSession(webContentsId);
  return [...session.vault.invoices].sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || b.sequenceNumber - a.sequenceNumber)
    .map(invoice => ({ ...invoice, appliedCredit: activeCreditApplied(session.vault, invoice.id),
      outstanding: invoice.status === 'cancelled' ? 0 : Math.max(0, invoice.totalAmount - invoice.paidAmount - invoice.creditedAmount - activeCreditApplied(session.vault, invoice.id)) }));
}

export async function getProtectedInvoiceForEdit(webContentsId: number, invoiceId: string) {
  assertWriter();
  const id = requireText(invoiceId, 'Factura', 100);
  return withRegistryRoutingLock(async () => {
    const session = await freshSession(webContentsId);
    if (!protectedOutbox.hasPending()) {
      const latest = await withPrivateCloudOperation(async () => {
        const key = keyBuffer(); await reconcilePending(key); return loadVaultFromCloud(key);
      });
      assertWriter();
      if (await freshSession(webContentsId) !== session) throw Error('Registrul a fost blocat.');
      Object.assign(session, latest);
    }
    const invoice = session.vault.invoices.find(row => row.id === id);
    if (!invoice) throw Error('Factura nu există în registrul separat.');
    return { ...invoice, expectedVersion: protectedInvoiceVersion(invoice), blockedReason: protectedInvoiceEditBlock(session.vault, invoice),
      appliedCredit: activeCreditApplied(session.vault, invoice.id) };
  });
}

export async function getProtectedInvoiceProducts(webContentsId: number, invoiceId: string, verifyPrices = true) {
  assertWriter();
  if (typeof verifyPrices !== 'boolean') throw Error('Opțiune de verificare invalidă.');
  const session = await freshSession(webContentsId);
  const invoice = session.vault.invoices.find(row => row.id === requireText(invoiceId, 'Factura', 100));
  if (!invoice) throw Error('Factura nu există în registrul separat.');
  const products = (billingRepo.getCloudProducts() as any[]).filter(row => row.available);
  const context = { storeExternalId: invoice.storeExternalId, products };
  if (!verifyPrices) return localInvoiceCatalog(context);
  const result = await priceInvoiceCatalog(context, id => createVrBakerClient().fetchInvoicePrices(id));
  assertWriter();
  if (await freshSession(webContentsId) !== session) throw Error('Registrul s-a schimbat. Reîncarcă produsele.');
  return result;
}

// Serialize document regeneration with vault mutations. Read the latest committed
// invoice, never a renderer snapshot or a previous revision captured before upload.
async function refreshProtectedInvoiceDocument(webContentsId: number, invoiceId: string) {
  // Caller owns the routing lock for the complete open/share/print preparation.
  return withPrivateCloudOperation(async () => {
    assertProtectedCloudSettled();
    assertWriter();
    const session = await freshSession(webContentsId);
    await reconcilePending(keyBuffer());
    const latest = await loadVaultFromCloud(keyBuffer());
    const invoice = latest.vault.invoices.find(row => row.id === invoiceId);
    if (!invoice || invoice.status === 'cancelled') throw Error('Factura nu există sau este anulată.');
    if (await freshSession(webContentsId) !== session) throw Error('Registrul a fost blocat.');
    assertWriter();
    const result = await uploadProtectedInvoicePdf(invoice, latest.vault);
    if (await freshSession(webContentsId) !== session) throw Error('Registrul a fost blocat.');
    return result;
  });
}

export async function updateProtectedInvoice(webContentsId: number, input: ProtectedInvoiceEditInput) {
  assertWriter();
  const request = validateProtectedInvoiceEdit(input);
  const vault = await mutate(webContentsId, request.operationId, 'protected_invoice_updated', next => {
    applyProtectedInvoiceEdit(next, request, productId => {
      const product = db.prepare('SELECT * FROM cloud_products WHERE id = ? AND available = 1').get(productId) as any;
      if (!product) throw Error('Produsul selectat nu mai este disponibil în catalog.');
      const finished = product.supabase_product_id ? db.prepare('SELECT id FROM finished_products WHERE external_product_id = ? LIMIT 1').get(product.supabase_product_id) as any : null;
      return { externalProductId: product.supabase_product_id || null, finishedProductId: finished?.id || null,
        productName: product.name, productNameRo: product.name_ro || null, unit: product.unit || 'pcs', productOrder: product.display_order ?? null };
    });
  }, next => protectedInvoiceEditReplay(next, request));
  const invoice = vault.invoices.find(row => row.id === request.invoiceId)!;
  return { success: true as const, invoice, pdf: { success: true, pending: protectedOutbox.hasPending() } };
}

export async function getProtectedIssuerChangeOptions(webContentsId: number, invoiceId: string): Promise<InvoiceIssuerChangeOptions> {
  const session = await freshSession(webContentsId);
  const source = session.vault.invoices.find((row) => row.id === requireText(invoiceId, 'Factura', 100));
  if (!source) throw new Error('Factura nu există.');
  return {
    reference: source.reference, issuerName: String(source.issuerSnapshot.issuerName || source.issuerCode),
    blockedReason: protectedIssuerChangeBlock(session.vault, source),
    issuers: billingRepo.getBillingIssuers().filter((issuer) => issuer.id !== source.issuerId && isIssuerReady(issuer) && (issuer.code === 'goodness' || issuer.code === 'vatra'))
      .map((issuer) => ({ id: issuer.id, name: issuer.legal_name, series: protectedSeries(issuer.code as ProtectedIssuerCode), nextNumber: session.vault.counters[protectedSeries(issuer.code as ProtectedIssuerCode)] })),
  };
}

export async function changeProtectedInvoiceIssuer(webContentsId: number, input: InvoiceIssuerChangeInput<string>) {
  const request = validateProtectedIssuerChange(input);
  const vault = await mutate(webContentsId, request.operationId, 'protected_invoice_issuer_changed', (next) => {
    const source = next.invoices.find((row) => row.id === request.invoiceId);
    if (!source?.storeId) throw new Error('Magazinul facturii nu mai este mapat local.');
    const store = readStoreSnapshot(source.storeId);
    if (store.company_id !== source.companyId || companyKey({ id: store.company_id, supabase_company_id: store.supabase_company_id }) !== source.companyKey) throw new Error('Asocierea magazinului s-a schimbat. Verifică factura înainte de continuare.');
    const replacement = applyProtectedIssuerChange(next, request, readIssuer(request.targetIssuerId));
    applyAutomaticProtectedCredit(next, replacement);
  }, (latest) => Boolean(protectedIssuerChangeReplay(latest, request)));
  const invoice = protectedIssuerChangeReplay(vault, request);
  if (!invoice) throw new Error('Înlocuitoarea nu a putut fi recitită.');
  return { success: true, invoice, pdf: { success: true, pending: protectedOutbox.hasPending() } };
}

export async function cancelProtectedInvoice(webContentsId: number, invoiceIdInput: unknown, reasonInput: unknown, operationId: unknown) {
  const invoiceId = requireText(invoiceIdInput, 'Factura', 100);
  const reason = requireText(reasonInput, 'Motivul anulării', 1000);
  const vault = await mutate(webContentsId, operationId, 'protected_invoice_cancelled', (next) => {
    const invoice = next.invoices.find((row) => row.id === invoiceId);
    if (!invoice) throw new Error('Factura nu există.');
    if (invoice.status === 'cancelled') return;
    if (invoice.paidAmount > 0.005 || invoice.creditedAmount > 0.005 || activeCreditApplied(next, invoice.id) > 0.005) throw new Error('Factura cu încasări, Credit Notes sau credit aplicat nu poate fi anulată direct.');
    invoice.status = 'cancelled';
    invoice.cancelledAt = new Date().toISOString();
    invoice.cancellationReason = reason;
  });
  return { success: true, invoice: vault.invoices.find((row) => row.id === invoiceId) };
}

export async function reissueProtectedInvoice(webContentsId: number, invoiceIdInput: unknown, operationId: unknown) {
  const invoiceId = requireText(invoiceIdInput, 'Factura', 100);
  const created: ProtectedInvoice[] = [];
  const vault = await mutate(webContentsId, operationId, 'protected_invoice_reissued', (next, opId) => {
    const source = next.invoices.find((invoice) => invoice.id === invoiceId);
    if (!source) throw new Error('Factura anulată nu există.');
    if (source.status !== 'cancelled') throw new Error('Numai o factură anulată poate fi reemisă.');
    if (source.replacedByInvoiceId) throw new Error('Factura a fost deja reemisă.');
    if (!source.storeId) throw new Error('Magazinul facturii istorice nu mai este mapat local.');
    const store = readStoreSnapshot(source.storeId);
    const key = companyKey({ id: store.company_id, supabase_company_id: store.supabase_company_id });
    if (!next.assignments.some((assignment) => assignment.companyKey === key)) throw new Error('Clientul nu mai este atribuit registrului separat.');
    const issuer = readIssuer(store.issuer_id);
    const series = protectedSeries(issuer.code);
    const replacement = createProtectedInvoiceRecord({
      operationId: opId,
      invoiceDate: new Date().toISOString().slice(0, 10),
      store,
      issuer,
      sequenceNumber: next.counters[series],
      items: source.items.map((item) => ({
        externalProductId: item.externalProductId,
        productName: item.productName,
        name_ro: item.productNameRo,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        productOrder: item.productOrder,
      })),
      sourceOrders: source.sourceOrderIds.map((id) => ({ id })),
      sourceFingerprint: source.sourceFingerprint,
      periodStart: source.periodStart,
      periodEnd: source.periodEnd,
      testDocument: next.mode === 'test',
    });
    replacement.replacesInvoiceId = source.id;
    source.replacedByInvoiceId = replacement.id;
    next.counters[series] += 1;
    next.invoices.push(replacement);
    applyAutomaticProtectedCredit(next, replacement);
    if (!replacement.testDocument) next.liveStartedAt ||= replacement.createdAt;
    created.push(replacement);
  });
  const invoice = created[0] || vault.invoices.find((row) => row.operationId === operationId);
  if (!invoice) throw new Error('Factura reemisă nu a putut fi recitită.');
  return { success: true, invoice, pdf: { success: true, pending: protectedOutbox.hasPending() } };
}

export async function deleteProtectedTestInvoice(webContentsId: number, invoiceIdInput: unknown, confirmationInput: unknown, operationId: unknown) {
  const invoiceId = requireText(invoiceIdInput, 'Factura', 100);
  const confirmation = String(confirmationInput ?? '').trim().toUpperCase();
  await backupCurrentVault(webContentsId, 'delete-test-invoice');
  let deleted: ProtectedInvoice | undefined;
  await mutate(webContentsId, operationId, 'protected_test_invoice_deleted', (next) => {
    if (next.mode !== 'test' || next.liveStartedAt) throw new Error('Ștergerea definitivă este permisă numai în Modul test, înainte de prima emitere live.');
    const index = next.invoices.findIndex((row) => row.id === invoiceId);
    const invoice = next.invoices[index];
    if (!invoice || !invoice.testDocument) throw new Error('Factura de test nu există.');
    if (confirmation !== `STERGE ${invoice.reference}`) throw new Error(`Scrie exact STERGE ${invoice.reference}.`);
    if (invoice.replacedByInvoiceId) throw new Error('Șterge mai întâi factura reemisă care înlocuiește acest document.');
    if (invoice.paidAmount > 0.005 || invoice.creditedAmount > 0.005 || activeCreditApplied(next, invoice.id) > 0.005) throw new Error('Reversează mai întâi încasările și aplicările de credit și șterge Credit Notes asociate.');
    if (next.creditNotes.some((note) => note.sourceInvoiceIds.includes(invoice.id))) throw new Error('Șterge mai întâi Credit Notes asociate facturii de test.');
    if (next.payments.some((payment) => payment.invoiceId === invoice.id && !payment.reversedAt)) throw new Error('Reversează mai întâi încasările facturii de test.');
    if (next.creditApplications.some((application) => application.invoiceId === invoice.id && !application.reversedAt)) throw new Error('Reversează mai întâi creditul aplicat facturii de test.');
    next.payments = next.payments.filter((payment) => payment.invoiceId !== invoice.id);
    next.creditApplications = next.creditApplications.filter((application) => application.invoiceId !== invoice.id);
    if (invoice.replacesInvoiceId) {
      const source = next.invoices.find((row) => row.id === invoice.replacesInvoiceId);
      if (source?.replacedByInvoiceId === invoice.id) source.replacedByInvoiceId = null;
    }
    deleted = invoice;
    next.invoices.splice(index, 1);
    next.counters[invoice.series] = nextProtectedInvoiceCounter(next, invoice.series);
  });
  if (deleted) await deleteProtectedDocumentPdf('invoice', deleted, `Factura_${deleted.reference}.pdf`);
  return { success: true };
}

export async function recordProtectedPayment(webContentsId: number, input: any, operationId: unknown) {
  const companyId = requirePositiveInteger(input?.companyId, 'Compania');
  const issuerCode = input?.issuerCode === 'goodness' || input?.issuerCode === 'vatra' ? input.issuerCode as ProtectedIssuerCode : null;
  if (!issuerCode) throw new Error('Societatea emitentă este invalidă.');
  const amount = requireMoney(input?.amount, 'Suma încasată');
  const paymentDate = requireIsoDate(input?.paymentDate, 'Data încasării');
  const method = requireText(input?.method, 'Metoda de plată', 100);
  const notes = input?.notes ? requireText(input.notes, 'Observațiile', 1000) : null;
  const company = db.prepare('SELECT id, supabase_company_id FROM companies WHERE id = ?').get(companyId) as any;
  if (!company) throw new Error('Compania nu există.');
  const key = companyKey(company);
  const created: ProtectedPayment[] = [];
  const vault = await mutate(webContentsId, operationId, 'protected_payment_recorded', (next, opId) => {
    if (!next.assignments.some((entry) => entry.companyKey === key)) throw new Error('Clientul nu este atribuit registrului separat.');
    let remaining = amount;
    const eligible = next.invoices.filter((invoice) => invoice.companyKey === key && invoice.issuerCode === issuerCode && invoice.status !== 'cancelled')
      .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.sequenceNumber - b.sequenceNumber);
    if (input?.invoiceId) {
      const selected = eligible.find((invoice) => invoice.id === input.invoiceId);
      if (!selected) throw new Error('Factura selectată nu aparține clientului și emitentului.');
      eligible.splice(eligible.indexOf(selected), 1);
      eligible.unshift(selected);
    }
    for (const invoice of eligible) {
      if (remaining <= 0.005) break;
      const due = Math.max(0, invoice.totalAmount - invoice.paidAmount - invoice.creditedAmount - activeCreditApplied(next, invoice.id));
      const allocated = Math.min(remaining, due);
      if (allocated <= 0.005) continue;
      invoice.paidAmount = Math.round((invoice.paidAmount + allocated) * 100) / 100;
      updateProtectedInvoiceStatus(next, invoice);
      const payment: ProtectedPayment = { id: randomUUID(), operationId: opId, companyKey: key, issuerCode, invoiceId: invoice.id, amount: allocated, paymentDate, method, notes, createdAt: new Date().toISOString(), reversedAt: null, reversalReason: null, testEntry: next.mode === 'test' };
      next.payments.push(payment); created.push(payment); remaining = Math.round((remaining - allocated) * 100) / 100;
    }
    if (remaining > 0.005) {
      const payment: ProtectedPayment = { id: randomUUID(), operationId: opId, companyKey: key, issuerCode, invoiceId: null, amount: remaining, paymentDate, method, notes, createdAt: new Date().toISOString(), reversedAt: null, reversalReason: null, testEntry: next.mode === 'test' };
      next.payments.push(payment); created.push(payment);
      const credit: ProtectedCreditEntry = { id: randomUUID(), companyKey: key, issuerCode, sourceType: 'payment_overpayment', sourceId: payment.id, originalAmount: remaining, availableAmount: remaining, createdAt: payment.createdAt, testEntry: next.mode === 'test' };
      next.creditEntries.push(credit);
    }
  });
  return { success: true, payments: created.length ? created : vault.payments.filter((row) => row.operationId === operationId) };
}

export async function listProtectedPayments(webContentsId: number) {
  const session = await freshSession(webContentsId);
  return protectedPaymentDisplay(session.vault);
}

export async function reverseProtectedPayment(webContentsId: number, paymentIdInput: unknown, reasonInput: unknown, operationId: unknown) {
  const paymentId = requireText(paymentIdInput, 'Încasarea', 100);
  const reason = requireText(reasonInput, 'Motivul reversării', 1000);
  await mutate(webContentsId, operationId, 'protected_payment_reversed', (next) => {
    const payment = next.payments.find((row) => row.id === paymentId);
    if (!payment) throw new Error('Încasarea nu există.');
    if (payment.reversedAt) return;
    const creditEntry = next.creditEntries.find((entry) => entry.sourceType === 'payment_overpayment' && entry.sourceId === payment.id);
    if (creditEntry && creditEntry.availableAmount < creditEntry.originalAmount - 0.005) throw new Error('Creditul provenit din această încasare a fost utilizat. Reversează mai întâi aplicările de credit.');
    if (payment.invoiceId) {
      const invoice = next.invoices.find((row) => row.id === payment.invoiceId);
      if (!invoice) throw new Error('Factura încasării nu mai există.');
      invoice.paidAmount = Math.max(0, Math.round((invoice.paidAmount - payment.amount) * 100) / 100);
      updateProtectedInvoiceStatus(next, invoice);
    }
    payment.reversedAt = new Date().toISOString();
    payment.reversalReason = reason;
    if (creditEntry) next.creditEntries.splice(next.creditEntries.indexOf(creditEntry), 1);
  });
  return { success: true };
}

function activeCreditApplied(vault: ProtectedRegistryVault, invoiceId: string) {
  return Math.round(vault.creditApplications.filter((entry) => entry.invoiceId === invoiceId && !entry.reversedAt).reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;
}

function availableCredit(vault: ProtectedRegistryVault, companyKeyValue: string, issuerCode: ProtectedIssuerCode) {
  return Math.round(vault.creditEntries.filter((entry) => entry.companyKey === companyKeyValue && entry.issuerCode === issuerCode).reduce((sum, entry) => sum + entry.availableAmount, 0) * 100) / 100;
}

function updateProtectedInvoiceStatus(vault: ProtectedRegistryVault, invoice: ProtectedInvoice) {
  if (invoice.status === 'cancelled') return;
  const settled = invoice.paidAmount + invoice.creditedAmount + activeCreditApplied(vault, invoice.id);
  invoice.status = settled >= invoice.totalAmount - 0.005 ? 'paid' : settled > 0.005 ? 'partial' : 'unpaid';
}

function creditNoteSeries(code: ProtectedIssuerCode) {
  return code === 'goodness' ? 'CN-TGBL' as const : 'CN-VRL' as const;
}

function renderProtectedCreditNotePdf(note: ProtectedCreditNote, vault: ProtectedRegistryVault) {
  const sourceInvoices = note.sourceInvoiceIds.map((id) => vault.invoices.find((invoice) => invoice.id === id)).filter(Boolean) as ProtectedInvoice[];
  const buffer = generateCreditNotePdf({
    reference: note.reference,
    issue_date: note.issueDate,
    created_at: note.createdAt,
    status: note.status,
    reason: note.reason,
    backdate_reason: note.backdateReason,
    issuerSnapshot: note.issuerSnapshot,
    customerSnapshot: {
      companyName: sourceInvoices[0]?.companyName || note.companyName,
      companyAddress: sourceInvoices[0]?.companySnapshot.address || '',
      companyRegistrationNumber: sourceInvoices[0]?.companySnapshot.registrationNumber || '',
      companyVatNumber: sourceInvoices[0]?.companySnapshot.vatNumber || '',
    },
    invoices: sourceInvoices.map((invoice) => ({ id: invoice.id, invoice_number: invoice.reference, invoice_date: invoice.invoiceDate })),
    items: note.items.map((item) => ({
      source_invoice_id: item.sourceInvoiceId,
      store_name: sourceInvoices.find((invoice) => invoice.id === item.sourceInvoiceId)?.storeName || '-',
      product_name: item.productName,
      product_name_ro: item.productNameRo,
      unit: item.unit,
      quantity: item.quantity,
      unit_amount: item.unitPrice,
      vat_rate: 0,
      vat_amount: 0,
      total_amount: item.totalPrice,
    })),
    net_amount: note.totalAmount,
    vat_amount: 0,
    total_amount: note.totalAmount,
    testDocument: note.testDocument,
  });
  return buffer;
}

async function uploadProtectedCreditNotePdf(note: ProtectedCreditNote, vault: ProtectedRegistryVault, accountScope?: string) {
  assertWriter();
  const buffer = renderProtectedCreditNotePdf(note, vault);
  const filename = `Credit_Note_${note.reference}.pdf`;
  const folderNames = protectedCloudDocumentFolders(note.companyName, 'Credit Notes');
  await writeVerifiedPrivateCloudFile({ folderNames, filename, mimeType: 'application/pdf', buffer, accountScope });
  return { filename, folder: folderNames.join('/') };
}

function applyProtectedStockReturns(note: ProtectedCreditNote, reverse = false) {
  const candidates = note.items.filter((item) => item.returnToStock && item.finishedProductId && (reverse ? item.stockReturnApplied : !item.stockReturnApplied));
  if (!candidates.length) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS protected_registry_stock_operations (
      operation_hash TEXT PRIMARY KEY,
      direction TEXT NOT NULL CHECK(direction IN ('return', 'reversal')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.transaction(() => {
    for (const item of candidates) {
      const marker = createHash('sha256').update(`${reverse ? 'reversal' : 'return'}:${note.id}:${item.id}`).digest('hex');
      if (db.prepare('SELECT 1 FROM protected_registry_stock_operations WHERE operation_hash = ?').get(marker)) continue;
      const product = db.prepare('SELECT current_stock FROM finished_products WHERE id = ?').get(item.finishedProductId) as { current_stock: number } | undefined;
      if (!product) throw new Error(`Produsul ${item.productName} nu mai este mapat în stoc.`);
      const before = Number(product.current_stock);
      const delta = reverse ? -item.quantity : item.quantity;
      const after = before + delta;
      db.prepare('UPDATE finished_products SET current_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(after, item.finishedProductId);
      db.prepare(`
        INSERT INTO finished_product_movements
          (finished_product_id, movement_type, quantity, stock_before, stock_after, reference_type, reference_id, notes, created_by)
        VALUES (?, ?, ?, ?, ?, 'protected_registry', NULL, 'Retur registru separat', 'system')
      `).run(item.finishedProductId, reverse ? 'protected_registry_return_reversal' : 'protected_registry_return', Math.abs(item.quantity), before, after);
      db.prepare('INSERT INTO protected_registry_stock_operations (operation_hash, direction) VALUES (?, ?)').run(marker, reverse ? 'reversal' : 'return');
    }
  })();
}

export async function getProtectedCreditNoteDraft(webContentsId: number) {
  const session = await freshSession(webContentsId);
  return session.vault.invoices.filter((invoice) => invoice.status !== 'cancelled' && invoice.creditedAmount < invoice.totalAmount - 0.005).map((invoice) => ({
    ...invoice,
    creditApplied: activeCreditApplied(session.vault, invoice.id),
    outstanding: Math.max(0, invoice.totalAmount - invoice.paidAmount - invoice.creditedAmount - activeCreditApplied(session.vault, invoice.id)),
    items: invoice.items.map((item) => {
      const credited = session.vault.creditNotes.filter((note) => note.status === 'issued').flatMap((note) => note.items).filter((entry) => entry.sourceInvoiceItemId === item.id);
      return {
        ...item,
        creditedQuantity: credited.reduce((sum, entry) => sum + entry.quantity, 0),
        creditedValue: credited.reduce((sum, entry) => sum + entry.totalPrice, 0),
      };
    }),
  }));
}

export async function createProtectedCreditNote(webContentsId: number, input: any, operationId: unknown) {
  await freshSession(webContentsId);
  const issueDate = requireIsoDate(input?.issueDate, 'Data Credit Note-ului');
  if (issueDate > localTodayIso()) throw new Error('Data Credit Note-ului nu poate fi în viitor.');
  const reason = requireText(input?.reason, 'Motivul Credit Note-ului', 1000);
  const backdateReason = issueDate < localTodayIso() ? requireText(input?.backdateReason, 'Motivul antedatării', 1000) : null;
  if (!Array.isArray(input?.items) || input.items.length === 0 || input.items.length > 500) throw new Error('Credit Note-ul trebuie să conțină între 1 și 500 de poziții.');
  const selections = input.items.map((row: any) => ({
    invoiceItemId: requireText(row.invoiceItemId, 'Poziția facturii', 100),
    quantity: requireMoney(row.quantity, 'Cantitatea creditată'),
    unitAmount: requireMoney(row.unitAmount, 'Valoarea unitară creditată', true),
    returnToStock: row.returnToStock === true,
  }));
  if (new Set(selections.map((row: any) => row.invoiceItemId)).size !== selections.length) throw new Error('Aceeași poziție a fost selectată de două ori.');
  const deferred = !selections.some((row: { returnToStock: boolean }) => row.returnToStock);
  const created: ProtectedCreditNote[] = [];
  const result = await mutate(webContentsId, operationId, 'protected_credit_note_issued', (next, opId) => {
    const sources = selections.map((selection: any) => {
      const invoice = next.invoices.find((candidate) => candidate.items.some((item) => item.id === selection.invoiceItemId));
      const item = invoice?.items.find((candidate) => candidate.id === selection.invoiceItemId);
      if (!invoice || !item || invoice.status === 'cancelled') throw new Error('O poziție sursă nu mai este eligibilă.');
      return { selection, invoice, item };
    });
    const first = sources[0].invoice;
    if (sources.some((row) => row.invoice.companyKey !== first.companyKey || row.invoice.issuerCode !== first.issuerCode)) throw new Error('Credit Note-ul poate reuni numai facturi ale aceleiași companii și aceluiași emitent.');
    const latestDate = sources.reduce((latest, row) => row.invoice.invoiceDate > latest ? row.invoice.invoiceDate : latest, '');
    if (issueDate < latestDate) throw new Error('Data Credit Note-ului nu poate fi înaintea celei mai recente facturi sursă.');
    const issuedItems = next.creditNotes.filter((note) => note.status === 'issued').flatMap((note) => note.items);
    const items: ProtectedCreditNoteItem[] = sources.map(({ selection, invoice, item }) => {
      const prior = issuedItems.filter((entry) => entry.sourceInvoiceItemId === item.id);
      const usedQuantity = prior.reduce((sum, entry) => sum + entry.quantity, 0);
      const usedValue = prior.reduce((sum, entry) => sum + entry.totalPrice, 0);
      const totalPrice = Math.round(selection.quantity * selection.unitAmount * 100) / 100;
      if (usedQuantity + selection.quantity > item.quantity + 0.005) throw new Error(`Cantitatea rămasă pentru ${item.productName} este insuficientă.`);
      if (selection.unitAmount > item.unitPrice + 0.005 || usedValue + totalPrice > item.totalPrice + 0.005) throw new Error(`Valoarea creditată pentru ${item.productName} depășește factura.`);
      if (selection.returnToStock && !item.finishedProductId) throw new Error(`Produsul ${item.productName} nu este mapat în stoc.`);
      return { ...item, id: randomUUID(), sourceInvoiceId: invoice.id, sourceInvoiceItemId: item.id, quantity: selection.quantity, unitPrice: selection.unitAmount, totalPrice, returnToStock: selection.returnToStock, stockReturnApplied: false };
    });
    const totalAmount = Math.round(items.reduce((sum, item) => sum + item.totalPrice, 0) * 100) / 100;
    if (totalAmount <= 0) throw new Error('Totalul Credit Note-ului trebuie să fie pozitiv.');
    const series = creditNoteSeries(first.issuerCode);
    const note: ProtectedCreditNote = {
      id: randomUUID(), operationId: opId, reference: `${series}-${next.counters[series]}`, series,
      sequenceNumber: next.counters[series], issueDate, companyKey: first.companyKey, companyId: first.companyId,
      companyName: first.companyName, issuerId: first.issuerId, issuerCode: first.issuerCode,
      issuerSnapshot: first.issuerSnapshot, reason, backdateReason, sourceInvoiceIds: [...new Set(items.map((item) => item.sourceInvoiceId))],
      items, totalAmount, status: 'issued', testDocument: next.mode === 'test', createdAt: new Date().toISOString(), cancelledAt: null, cancellationReason: null,
    };
    next.counters[series] += 1;
    next.creditNotes.push(note);
    if (!note.testDocument) next.liveStartedAt ||= note.createdAt;
    let generatedCashCredit = 0;
    for (const invoiceId of note.sourceInvoiceIds) {
      const invoice = next.invoices.find((row) => row.id === invoiceId)!;
      const cashExcessBefore = Math.max(0, invoice.paidAmount - Math.max(0, invoice.totalAmount - invoice.creditedAmount));
      invoice.creditedAmount = Math.round((invoice.creditedAmount + items.filter((item) => item.sourceInvoiceId === invoiceId).reduce((sum, item) => sum + item.totalPrice, 0)) * 100) / 100;
      let release = Math.min(Math.max(0, invoice.paidAmount + activeCreditApplied(next, invoice.id) + invoice.creditedAmount - invoice.totalAmount), activeCreditApplied(next, invoice.id));
      const applications = next.creditApplications.filter((entry) => entry.invoiceId === invoice.id && !entry.reversedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      for (const application of applications) {
        if (release <= 0.005) break;
        const restored = Math.min(release, application.amount);
        let allocationRemaining = restored;
        for (const allocation of [...application.allocations].reverse()) {
          if (allocationRemaining <= 0.005) break;
          const entry = next.creditEntries.find((candidate) => candidate.id === allocation.creditEntryId);
          const amount = Math.min(allocationRemaining, allocation.amount);
          if (entry) entry.availableAmount = Math.round((entry.availableAmount + amount) * 100) / 100;
          allocation.amount = Math.round((allocation.amount - amount) * 100) / 100;
          allocationRemaining = Math.round((allocationRemaining - amount) * 100) / 100;
        }
        application.allocations = application.allocations.filter((allocation) => allocation.amount > 0.005);
        application.amount = Math.round((application.amount - restored) * 100) / 100;
        if (application.amount <= 0.005) { application.reversedAt = new Date().toISOString(); application.reversalReason = `Eliberare automată la ${note.reference}`; }
        release = Math.round((release - restored) * 100) / 100;
      }
      const cashExcessAfter = Math.max(0, invoice.paidAmount - Math.max(0, invoice.totalAmount - invoice.creditedAmount));
      generatedCashCredit += Math.max(0, cashExcessAfter - cashExcessBefore);
      updateProtectedInvoiceStatus(next, invoice);
    }
    generatedCashCredit = Math.round(generatedCashCredit * 100) / 100;
    if (generatedCashCredit > 0.005) next.creditEntries.push({ id: randomUUID(), companyKey: note.companyKey, issuerCode: note.issuerCode, sourceType: 'credit_note_overpayment', sourceId: note.id, originalAmount: generatedCashCredit, availableAmount: generatedCashCredit, createdAt: note.createdAt, testEntry: note.testDocument });
    created.push(note);
  }, undefined, undefined, undefined, deferred);
  const note = created[0] || result.creditNotes.find((row) => row.operationId === operationId);
  if (!note) throw new Error('Credit Note-ul emis nu a putut fi recitit.');
  if (deferred) return { success: true, creditNote: note, pdf: { success: true, pending: protectedOutbox.hasPending() } };
  applyProtectedStockReturns(note, false);
  if (note.items.some((item) => item.returnToStock && !item.stockReturnApplied)) {
    const marked = await mutate(webContentsId, `${String(operationId)}_stock`, 'protected_stock_return_applied', (next) => {
      const target = next.creditNotes.find((row) => row.id === note.id)!;
      for (const item of target.items) if (item.returnToStock) item.stockReturnApplied = true;
    });
    Object.assign(note, marked.creditNotes.find((row) => row.id === note.id));
  }
  try { return { success: true, creditNote: note, pdf: { success: true, ...(await uploadProtectedCreditNotePdf(note, result)) } }; }
  catch (error) { return { success: true, creditNote: note, pdf: { success: false, error: error instanceof Error ? error.message : 'PDF-ul nu a putut fi încărcat.' } }; }
}

function localTodayIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export async function listProtectedCreditNotes(webContentsId: number) {
  const session = await freshSession(webContentsId);
  return [...session.vault.creditNotes].sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.sequenceNumber - a.sequenceNumber);
}

export async function deleteProtectedTestCreditNote(webContentsId: number, idInput: unknown, confirmationInput: unknown, operationId: unknown) {
  const id = requireText(idInput, 'Credit Note-ul', 100);
  const confirmation = String(confirmationInput ?? '').trim().toUpperCase();
  await backupCurrentVault(webContentsId, 'delete-test-credit-note');
  let deleted: ProtectedCreditNote | undefined;
  await mutate(webContentsId, operationId, 'protected_test_credit_note_deleted', (next) => {
    if (next.mode !== 'test' || next.liveStartedAt) throw new Error('Ștergerea definitivă este permisă numai în Modul test.');
    const index = next.creditNotes.findIndex((row) => row.id === id);
    const note = next.creditNotes[index];
    if (!note || !note.testDocument) throw new Error('Credit Note-ul de test nu există.');
    if (confirmation !== `STERGE ${note.reference}`) throw new Error(`Scrie exact STERGE ${note.reference}.`);
    if (note.status !== 'cancelled') throw new Error('Anulează mai întâi Credit Note-ul de test pentru a inversa efectele financiare și retururile de stoc.');
    if (note.items.some((item) => item.stockReturnApplied)) throw new Error('Returul de stoc nu a fost încă inversat. Reîncearcă anularea înainte de ștergere.');
    deleted = note;
    next.creditNotes.splice(index, 1);
    next.counters[note.series] = nextProtectedCreditNoteCounter(next, note.series);
  });
  if (deleted) await deleteProtectedDocumentPdf('credit-note', deleted, `Credit_Note_${deleted.reference}.pdf`);
  return { success: true };
}

export async function cancelProtectedCreditNote(webContentsId: number, idInput: unknown, reasonInput: unknown, acknowledge: unknown, operationId: unknown) {
  const id = requireText(idInput, 'Credit Note-ul', 100);
  const reason = requireText(reasonInput, 'Motivul anulării', 1000);
  if (acknowledge !== true) throw new Error('Confirmă avertismentul contabil înainte de anulare.');
  const session = await freshSession(webContentsId);
  const deferred = !session.vault.creditNotes.find(row => row.id === id)?.items.some(item => item.returnToStock);
  let cancelled: ProtectedCreditNote | undefined;
  const vault = await mutate(webContentsId, operationId, 'protected_credit_note_cancelled', (next) => {
    const note = next.creditNotes.find((row) => row.id === id);
    if (!note) throw new Error('Credit Note-ul nu există.');
    if (note.status !== 'cancelled') {
      const generatedCredit = next.creditEntries.find((entry) => entry.sourceType === 'credit_note_overpayment' && entry.sourceId === note.id);
      if (generatedCredit && generatedCredit.availableAmount < generatedCredit.originalAmount - 0.005) {
        throw new Error('Creditul creat de acest document a fost deja utilizat. Reversează aplicările înainte de anulare.');
      }
      if (generatedCredit) next.creditEntries.splice(next.creditEntries.indexOf(generatedCredit), 1);
      for (const invoiceId of note.sourceInvoiceIds) {
        const invoice = next.invoices.find((row) => row.id === invoiceId)!;
        invoice.creditedAmount = Math.max(0, Math.round((invoice.creditedAmount - note.items.filter((item) => item.sourceInvoiceId === invoiceId).reduce((sum, item) => sum + item.totalPrice, 0)) * 100) / 100);
      }
      note.status = 'cancelled'; note.cancelledAt = new Date().toISOString(); note.cancellationReason = reason;
      for (const invoiceId of note.sourceInvoiceIds) updateProtectedInvoiceStatus(next, next.invoices.find((row) => row.id === invoiceId)!);
    }
    cancelled = note;
  }, undefined, undefined, undefined, deferred);
  const note = cancelled || vault.creditNotes.find((row) => row.id === id);
  if (!note) throw new Error('Credit Note-ul nu a putut fi recitit.');
  if (deferred) return { success: true };
  applyProtectedStockReturns(note, true);
  if (note.items.some((item) => item.stockReturnApplied)) {
    await mutate(webContentsId, `${String(operationId)}_stock`, 'protected_stock_return_reversed', (next) => {
      const target = next.creditNotes.find((row) => row.id === note.id)!;
      for (const item of target.items) if (item.returnToStock) item.stockReturnApplied = false;
    });
  }
  return { success: true };
}

export async function applyProtectedCredit(webContentsId: number, input: any, operationId: unknown) {
  const invoiceId = requireText(input?.invoiceId, 'Factura', 100);
  const amount = requireMoney(input?.amount, 'Creditul aplicat');
  const reason = requireText(input?.reason, 'Motivul aplicării', 1000);
  const created: ProtectedCreditApplication[] = [];
  const vault = await mutate(webContentsId, operationId, 'protected_credit_applied', (next, opId) => {
    const invoice = next.invoices.find((row) => row.id === invoiceId && row.status !== 'cancelled');
    if (!invoice) throw new Error('Factura nu este eligibilă.');
    const outstanding = Math.max(0, invoice.totalAmount - invoice.paidAmount - invoice.creditedAmount - activeCreditApplied(next, invoice.id));
    if (amount > outstanding + 0.005) throw new Error('Creditul aplicat depășește restul facturii.');
    if (amount > availableCredit(next, invoice.companyKey, invoice.issuerCode) + 0.005) throw new Error('Creditul disponibil este insuficient.');
    let remaining = amount;
    const allocations: Array<{ creditEntryId: string; amount: number }> = [];
    const sources = next.creditEntries.filter((entry) => entry.companyKey === invoice.companyKey && entry.issuerCode === invoice.issuerCode && entry.availableAmount > 0.005).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const source of sources) {
      if (remaining <= 0.005) break;
      const used = Math.min(remaining, source.availableAmount);
      source.availableAmount = Math.round((source.availableAmount - used) * 100) / 100;
      allocations.push({ creditEntryId: source.id, amount: used });
      remaining = Math.round((remaining - used) * 100) / 100;
    }
    if (remaining > 0.005) throw new Error('Creditul disponibil s-a modificat. Reîncarcă datele.');
    const entry: ProtectedCreditApplication = { id: randomUUID(), operationId: opId, companyKey: invoice.companyKey, issuerCode: invoice.issuerCode, invoiceId, amount, allocations, reason, createdAt: new Date().toISOString(), reversedAt: null, reversalReason: null, testEntry: next.mode === 'test' };
    next.creditApplications.push(entry); created.push(entry); updateProtectedInvoiceStatus(next, invoice);
  });
  return { success: true, application: created[0] || vault.creditApplications.find((row) => row.operationId === operationId) };
}

export async function reverseProtectedCredit(webContentsId: number, idInput: unknown, reasonInput: unknown, operationId: unknown) {
  const id = requireText(idInput, 'Aplicarea creditului', 100);
  const reason = requireText(reasonInput, 'Motivul reversării', 1000);
  await mutate(webContentsId, operationId, 'protected_credit_reversed', (next) => {
    const entry = next.creditApplications.find((row) => row.id === id);
    if (!entry) throw new Error('Aplicarea creditului nu există.');
    if (!entry.reversedAt) {
      for (const allocation of entry.allocations) {
        const source = next.creditEntries.find((candidate) => candidate.id === allocation.creditEntryId);
        if (!source) throw new Error('Sursa creditului nu mai există.');
        source.availableAmount = Math.round((source.availableAmount + allocation.amount) * 100) / 100;
      }
      entry.reversedAt = new Date().toISOString(); entry.reversalReason = reason;
    }
    const invoice = next.invoices.find((row) => row.id === entry.invoiceId);
    if (invoice) updateProtectedInvoiceStatus(next, invoice);
  });
  return { success: true };
}

export async function getProtectedCreditBalances(webContentsId: number) {
  const session = await freshSession(webContentsId);
  return session.vault.assignments.flatMap((assignment) => (['goodness', 'vatra'] as ProtectedIssuerCode[]).map((issuerCode) => ({
    companyKey: assignment.companyKey,
    companyId: assignment.localCompanyId,
    companyName: assignment.companyName,
    issuerCode,
    available: availableCredit(session.vault, assignment.companyKey, issuerCode),
    entries: session.vault.creditEntries.filter(entry => entry.companyKey === assignment.companyKey && entry.issuerCode === issuerCode),
  }))).filter((row) => row.available > 0.005 || row.entries.length > 0);
}

export async function listProtectedCreditApplications(webContentsId: number) {
  const session = await freshSession(webContentsId);
  return [...session.vault.creditApplications]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((application) => ({
      ...application,
      companyName: session.vault.assignments.find((entry) => entry.companyKey === application.companyKey)?.companyName
        || session.vault.invoices.find((invoice) => invoice.companyKey === application.companyKey)?.companyName
        || 'Companie istorică',
      invoiceReference: session.vault.invoices.find((invoice) => invoice.id === application.invoiceId)?.reference || '-',
    }));
}

async function protectedPdfToTemporaryFile(webContentsId: number, type: 'invoice' | 'credit-note', id: string) {
  return withRegistryRoutingLock(async () => {
    if (getDeviceRole() === 'writer') assertProtectedCloudSettled();
    if (getDeviceRole() === 'viewer') await refreshProtectedViewer(webContentsId);
    const session = await freshSession(webContentsId);
    const record = type === 'invoice' ? session.vault.invoices.find((row) => row.id === id) : session.vault.creditNotes.find((row) => row.id === id);
    if (!record) throw new Error('Documentul nu există.');
    if (record.status === 'cancelled') throw Error('Documentul este anulat.');
    if (session.role === 'viewer') {
      const buffer = type === 'invoice' ? renderProtectedInvoicePdf(record as ProtectedInvoice, session.vault) : renderProtectedCreditNotePdf(record as ProtectedCreditNote, session.vault);
      return storeTemporaryProtectedPdf(webContentsId, session, buffer);
    }
    // A prior edit can commit even when its PDF upload fails. Never deliver that
    // old PDF: regenerate from the authoritative vault before reading it.
    if (type === 'invoice') await refreshProtectedInvoiceDocument(webContentsId, id);
    const filename = type === 'invoice' ? `Factura_${record.reference}.pdf` : `Credit_Note_${record.reference}.pdf`;
    let file = await readProtectedDocumentPdf(type, record, filename);
    if (!file) {
      if (type === 'invoice') await uploadProtectedInvoicePdf(record as ProtectedInvoice, session.vault);
      else await uploadProtectedCreditNotePdf(record as ProtectedCreditNote, session.vault);
      file = await readProtectedDocumentPdf(type, record, filename);
    }
    if (!file) throw new Error('PDF-ul nu a putut fi recitit din Google Drive.');
    // A cloud read can finish after the operator locks the registry. Do not
    // recreate plaintext files or start a transfer for that expired session.
    assertWriter();
    if (sessions.get(webContentsId) !== session) throw new Error('Registrul a fost blocat. Deblochează-l înainte de a deschide documentul.');
    return storeTemporaryProtectedPdf(webContentsId, session, file.buffer);
  });
}

function storeTemporaryProtectedPdf(webContentsId: number, session: Session, buffer: Uint8Array) {
  if (sessions.get(webContentsId) !== session || session.role !== getDeviceRole() || Date.now() - session.lastActivity >= SESSION_MS) throw new Error('Sesiunea registrului a expirat.');
  const tempPath = path.join(app.getPath('temp'), `vr-hub-protected-${randomUUID()}.pdf`);
  fs.writeFileSync(tempPath, toValidatedPdfBuffer(buffer), { flag: 'wx', mode: 0o600 });
  const paths = temporaryFiles.get(webContentsId) || new Set<string>(); paths.add(tempPath); temporaryFiles.set(webContentsId, paths);
  return tempPath;
}

export async function openProtectedDocument(webContentsId: number, type: 'invoice' | 'credit-note', idInput: unknown) {
  const id = requireText(idInput, 'Documentul', 100);
  if (type !== 'invoice' && type !== 'credit-note') throw new Error('Tipul documentului este invalid.');
  const filePath = await protectedPdfToTemporaryFile(webContentsId, type, id);
  const error = await shell.openPath(filePath);
  return error ? { success: false, message: error } : { success: true };
}

export async function shareProtectedDocument(webContentsId: number, type: 'invoice' | 'credit-note', idInput: unknown) {
  const id = requireText(idInput, 'Documentul', 100);
  if (type !== 'invoice' && type !== 'credit-note') throw new Error('Tipul documentului este invalid.');
  const filePath = await protectedPdfToTemporaryFile(webContentsId, type, id);
  const result = await openWindowsDocument('share', filePath);
  if (result.canceled) return result;
  if (!result.success) throw new Error(result.error || 'PDF-ul nu a putut fi atașat în Windows Share.');
  // The source process stays alive for deferred reads. This confirms preparation
  // in Windows Share, not WhatsApp delivery to the recipient.
  return result;
}

export async function printProtectedDocument(webContentsId: number, type: 'invoice' | 'credit-note', idInput: unknown) {
  const id = requireText(idInput, 'Documentul', 100);
  if (type !== 'invoice' && type !== 'credit-note') throw Error('Tipul documentului este invalid.');
  const filePath = await protectedPdfToTemporaryFile(webContentsId, type, id);
  return openWindowsDocument('print', filePath);
}

export async function exportProtectedRegistryMonth(webContentsId: number, monthInput: unknown) {
  assertProtectedCloudSettled();
  const session = await freshSession(webContentsId);
  const month = String(monthInput ?? '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Luna exportului este invalidă.');
  const invoices = session.vault.invoices.filter((invoice) => invoice.invoiceDate.startsWith(month));
  const creditNotes = session.vault.creditNotes.filter((note) => note.issueDate.startsWith(month));
  const payments = session.vault.payments.filter((payment) => payment.paymentDate.startsWith(month));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'VR - Hub Management'; workbook.created = new Date();
  const addSheet = (name: string, headers: string[], rows: unknown[][]) => {
    const sheet = workbook.addWorksheet(name); sheet.addRow(headers); for (const row of rows) sheet.addRow(row);
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    sheet.columns.forEach((column) => { column.width = 22; }); sheet.views = [{ state: 'frozen', ySplit: 1 }]; return sheet;
  };
  const summaryRows = (['goodness', 'vatra'] as ProtectedIssuerCode[]).map((issuerCode) => {
    const issuerInvoices = invoices.filter((invoice) => invoice.issuerCode === issuerCode && invoice.status !== 'cancelled');
    const issuerNotes = creditNotes.filter((note) => note.issuerCode === issuerCode && note.status === 'issued');
    const issuerPayments = payments.filter((payment) => payment.issuerCode === issuerCode && !payment.reversedAt);
    return [issuerCode === 'goodness' ? 'THE GOODNESS BAKER LTD' : 'VATRA ROMANEASCA LTD', issuerInvoices.reduce((sum, row) => sum + row.totalAmount, 0), issuerNotes.reduce((sum, row) => sum + row.totalAmount, 0), issuerPayments.reduce((sum, row) => sum + row.amount, 0), issuerCode === 'goodness' ? 'VAT 0%' : 'Not VAT registered'];
  });
  addSheet('Sumar', ['Emitent', 'Facturat brut', 'Creditat', 'Încasat', 'Tratament VAT'], summaryRows);
  addSheet('Facturi', ['Referință', 'Data', 'Emitent', 'Client', 'Magazin', 'Total', 'Plătit cash', 'Creditat', 'Credit aplicat', 'Rest', 'Status', 'Test'], invoices.map((invoice) => { const applied = activeCreditApplied(session.vault, invoice.id); return [invoice.reference, invoice.invoiceDate, invoice.issuerCode, invoice.companyName, invoice.storeName, invoice.totalAmount, invoice.paidAmount, invoice.creditedAmount, applied, Math.max(0, invoice.totalAmount - invoice.paidAmount - invoice.creditedAmount - applied), invoice.status, invoice.testDocument ? 'DA' : 'NU']; }));
  addSheet('Poziții facturi', ['Factură', 'Produs EN', 'Produs RO', 'Unitate', 'Cantitate', 'Preț unitar', 'Total'], invoices.flatMap((invoice) => invoice.items.map((item) => [invoice.reference, item.productName, item.productNameRo, item.unit, item.quantity, item.unitPrice, item.totalPrice])));
  addSheet('Credit Notes', ['Referință', 'Data', 'Emitent', 'Client', 'Facturi sursă', 'Motiv', 'Total', 'Status', 'Test'], creditNotes.map((note) => [note.reference, note.issueDate, note.issuerCode, note.companyName, note.sourceInvoiceIds.map((id) => session.vault.invoices.find((row) => row.id === id)?.reference).filter(Boolean).join(', '), note.reason, note.totalAmount, note.status, note.testDocument ? 'DA' : 'NU']));
  addSheet('Încasări', ['Data', 'Companie', 'Emitent', 'Factură', 'Metodă', 'Sumă', 'Stare'], payments.map((payment) => [payment.paymentDate, session.vault.assignments.find((row) => row.companyKey === payment.companyKey)?.companyName || payment.companyKey, payment.issuerCode, session.vault.invoices.find((row) => row.id === payment.invoiceId)?.reference || 'Credit disponibil', payment.method, payment.amount, payment.reversedAt ? 'Reversată' : 'Activă']));
  addSheet('Credite', ['Companie', 'Emitent', 'Tip sursă', 'Sursă', 'Valoare inițială', 'Disponibil', 'Creat'], session.vault.creditEntries.map((entry) => [session.vault.assignments.find((assignment) => assignment.companyKey === entry.companyKey)?.companyName || session.vault.invoices.find((invoice) => invoice.companyKey === entry.companyKey)?.companyName || 'Companie istorică', entry.issuerCode, entry.sourceType, entry.sourceType === 'payment_overpayment' ? 'Încasare / avans' : 'Surplus Credit Note', entry.originalAmount, entry.availableAmount, entry.createdAt]));
  addSheet('Aplicări credit', ['Companie', 'Emitent', 'Factură', 'Sumă', 'Motiv', 'Creat', 'Reversat'], session.vault.creditApplications.map((entry) => [session.vault.assignments.find((assignment) => assignment.companyKey === entry.companyKey)?.companyName || session.vault.invoices.find((invoice) => invoice.companyKey === entry.companyKey)?.companyName || 'Companie istorică', entry.issuerCode, session.vault.invoices.find((invoice) => invoice.id === entry.invoiceId)?.reference || '-', entry.amount, entry.reason, entry.createdAt, entry.reversedAt || '']));
  addSheet('Restanțe', ['Factură', 'Companie', 'Emitent', 'Rest'], invoices.filter((invoice) => invoice.status !== 'cancelled').map((invoice) => [invoice.reference, invoice.companyName, invoice.issuerCode, Math.max(0, invoice.totalAmount - invoice.paidAmount - invoice.creditedAmount - activeCreditApplied(session.vault, invoice.id))]).filter((row) => Number(row[3]) > 0.005));
  const excel = new Uint8Array(await workbook.xlsx.writeBuffer());
  const folder = ['Duplicat', 'Exporturi', month];
  const excelName = `Registru_separat_${month}.xlsx`;
  await writeVerifiedPrivateCloudFile({ folderNames: folder, filename: excelName, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: excel });
  let pdfCount = 0;
  for (const invoice of invoices) {
    const filename = `Factura_${invoice.reference}.pdf`;
    let source = await readProtectedDocumentPdf('invoice', invoice, filename);
    if (!source) {
      await uploadProtectedInvoicePdf(invoice, session.vault);
      source = await readProtectedDocumentPdf('invoice', invoice, filename);
    }
    if (source) { await writeVerifiedPrivateCloudFile({ folderNames: [...folder, 'PDF'], filename, mimeType: 'application/pdf', buffer: source.buffer }); pdfCount += 1; }
  }
  for (const note of creditNotes) {
    const filename = `Credit_Note_${note.reference}.pdf`;
    let source = await readProtectedDocumentPdf('credit-note', note, filename);
    if (!source) {
      await uploadProtectedCreditNotePdf(note, session.vault);
      source = await readProtectedDocumentPdf('credit-note', note, filename);
    }
    if (source) { await writeVerifiedPrivateCloudFile({ folderNames: [...folder, 'PDF'], filename, mimeType: 'application/pdf', buffer: source.buffer }); pdfCount += 1; }
  }
  return { success: true, month, excelName, pdfCount, invoiceCount: invoices.length, creditNoteCount: creditNotes.length };
}

export function newProtectedOperationId() {
  return randomBytes(18).toString('base64url');
}
