import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ProtectedRegistryVault } from './types.ts';
import type { ProtectedEnvelope } from './crypto.ts';

// Only encrypted, unacknowledged work is persisted. Never part of the SQLite
// replica/backup and never readable through a renderer-supplied file path.
const AAD = Buffer.from('vr-hub-protected-outbox:v1');
const MAX_FILE = 42 * 1024 * 1024;
const MAX_TOTAL = 256 * 1024 * 1024;
const MAX_PENDING = 50;
export const vaultDigest = (vault: ProtectedRegistryVault) => createHash('sha256').update(JSON.stringify(vault)).digest('hex');
export interface PendingProtectedSave {
  version: 1;
  operationId: string;
  scope: string;
  fileId: string;
  baseDigest: string;
  vault: ProtectedRegistryVault;
  recovery: ProtectedEnvelope['recovery'];
  documents: Array<{ type: 'invoice' | 'credit-note'; id: string }>;
}
export interface ProtectedSyncStatus {
  state: 'synced' | 'pending' | 'syncing' | 'error';
  pending: number;
  error: string | null;
}

function seal(value: PendingProtectedSave, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const bytes = Buffer.from(JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }));
  if (bytes.length > MAX_FILE) throw Error('Registrul depășește limita salvării temporare.');
  return bytes;
}
function unseal(bytes: Buffer, key: Buffer): PendingProtectedSave {
  try {
    if (bytes.length > MAX_FILE) throw Error();
    const raw = JSON.parse(bytes.toString('utf8'));
    if (raw.version !== 1) throw Error();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv, 'base64'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(raw.tag, 'base64'));
    const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(raw.ciphertext, 'base64')), decipher.final()]).toString('utf8')) as PendingProtectedSave;
    if (value.version !== 1 || !/^[a-zA-Z0-9_-]{16,100}$/.test(value.operationId)
      || !/^[a-f0-9]{64}$/.test(value.scope) || !/^[a-f0-9]{64}$/.test(value.baseDigest)
      || !value.fileId || !Number.isSafeInteger(value.vault?.revision) || !value.recovery
      || !Array.isArray(value.documents)) throw Error();
    return value;
  } catch { throw Error('Salvarea temporară criptată nu poate fi verificată. Datele au fost păstrate; nu reemite documentele.'); }
}

export class ProtectedOutboxStore {
  private readonly directory: string;
  private readonly key: () => Buffer;
  constructor(directory: string, key: () => Buffer) { this.directory = directory; this.key = key; }
  hasPending() { return fs.existsSync(this.directory) && fs.readdirSync(this.directory).some(name => name.endsWith('.pending')); }
  count() { return fs.existsSync(this.directory) ? fs.readdirSync(this.directory).filter(name => name.endsWith('.pending')).length : 0; }
  discardIncompleteWrites() {
    if (!fs.existsSync(this.directory)) return;
    // These names were never renamed into accepted operations. Main is a single
    // instance and append is synchronous, so no live writer can own them here.
    for (const name of fs.readdirSync(this.directory)) if (/^[a-f0-9-]{36}\.pending\.tmp$/.test(name)) fs.unlinkSync(path.join(this.directory, name));
  }
  read(): Array<{ name: string; value: PendingProtectedSave }> {
    if (!fs.existsSync(this.directory)) return [];
    const names = fs.readdirSync(this.directory).filter(name => name.endsWith('.pending'));
    if (names.some(name => !/^[a-f0-9-]{36}\.pending$/.test(name))) throw Error('Salvare temporară necunoscută. Datele au fost păstrate.');
    const result = names.map(name => {
      const filename = path.join(this.directory, name);
      const stat = fs.lstatSync(filename);
      if (!stat.isFile() || stat.size > MAX_FILE) throw Error('Salvare temporară invalidă. Datele au fost păstrate.');
      return { name, value: unseal(fs.readFileSync(filename), this.key()) };
    }).sort((a, b) => a.value.vault.revision - b.value.vault.revision);
    for (let index = 1; index < result.length; index++) {
      const previous = result[index - 1].value, current = result[index].value;
      if (current.vault.revision !== previous.vault.revision + 1 || current.baseDigest !== vaultDigest(previous.vault)
        || current.scope !== previous.scope || current.fileId !== previous.fileId) throw Error('Ordinea salvărilor temporare nu poate fi verificată. Datele au fost păstrate.');
    }
    return result;
  }
  append(value: PendingProtectedSave) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (!fs.lstatSync(this.directory).isDirectory() || fs.lstatSync(this.directory).isSymbolicLink()) throw Error('Folderul salvărilor temporare nu este valid.');
    const files = fs.readdirSync(this.directory);
    const bytes = seal(value, this.key());
    const size = files.reduce((total, name) => total + fs.lstatSync(path.join(this.directory, name)).size, 0);
    if (files.filter(name => name.endsWith('.pending')).length >= MAX_PENDING || size + bytes.length > MAX_TOTAL) {
      throw Error('Coada de sincronizare este plină. Așteaptă confirmarea salvărilor din Drive.');
    }
    const name = `${randomUUID()}.pending`;
    const temporary = path.join(this.directory, `${name}.tmp`);
    const descriptor = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
    catch (error) { fs.closeSync(descriptor); fs.unlinkSync(temporary); throw error; }
    fs.closeSync(descriptor);
    // Once renamed this is an accepted operation, even if its IPC response is lost.
    fs.renameSync(temporary, path.join(this.directory, name));
    this.syncDirectory();
    return name;
  }
  acknowledge(name: string) {
    if (!/^[a-f0-9-]{36}\.pending$/.test(name)) throw Error('Identificator local invalid.');
    fs.unlinkSync(path.join(this.directory, name));
    this.syncDirectory();
  }
  private syncDirectory() {
    // Windows does not allow fsync on directory handles. File contents were
    // flushed before the same-directory atomic rename on both platforms.
    if (process.platform === 'win32') return;
    const fd = fs.openSync(this.directory, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
}

/** One ordered uploader; accepting the next local save never waits on this worker. */
export class ProtectedOutboxWorker {
  private active: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private lastError: string | null = null;
  private readonly store: ProtectedOutboxStore;
  private readonly commit: (value: PendingProtectedSave) => Promise<void>;
  private readonly onAcknowledged?: (value: PendingProtectedSave) => void;
  private stopped = false;
  constructor(store: ProtectedOutboxStore, commit: (value: PendingProtectedSave) => Promise<void>, onAcknowledged?: (value: PendingProtectedSave) => void) {
    this.store = store; this.commit = commit; this.onAcknowledged = onAcknowledged;
  }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; }
  status(): ProtectedSyncStatus {
    const pending = this.store.count();
    return { state: this.lastError ? 'error' : this.active ? 'syncing' : pending ? 'pending' : 'synced', pending, error: this.lastError };
  }
  assertWritable() {
    if (this.lastError) throw Error(this.lastError);
  }
  blockAfterLocalFailure() {
    this.lastError = 'Salvarea locală nu a putut fi confirmată complet. Datele existente sunt păstrate. Verifică sincronizarea și factura înainte de a reîncerca; nu emite un document nou.';
  }
  start() {
    if (this.stopped) return Promise.resolve();
    if (this.active) return this.active;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.active = this.flush().finally(() => {
      this.active = null;
      if (!this.stopped && !this.lastError && this.store.hasPending()) {
        this.timer = setTimeout(() => { this.timer = null; void this.start(); }, 0);
        this.timer.unref?.();
      }
    });
    return this.active;
  }
  private async flush() {
    try {
      for (;;) {
        if (this.stopped) return;
        const entry = this.store.read()[0];
        if (!entry) break;
        await this.commit(entry.value);
        this.store.acknowledge(entry.name);
        try { this.onAcknowledged?.(entry.value); } catch {}
      }
      this.failures = 0;
      this.lastError = null;
    } catch {
      // Never expose provider errors, paths, account IDs or protected payloads.
      this.lastError = 'Sincronizarea nu este confirmată. Salvările criptate sunt păstrate pe Writer; operațiunile noi sunt oprite. Verifică Drive și reîncearcă. Dacă eroarea persistă, nu reemite facturile.';
      this.failures++;
      if (!this.stopped) {
        this.timer = setTimeout(() => { this.timer = null; void this.start(); }, Math.min(120_000, 5_000 * 2 ** Math.min(this.failures - 1, 5)));
        this.timer.unref?.();
      }
    }
  }
}
