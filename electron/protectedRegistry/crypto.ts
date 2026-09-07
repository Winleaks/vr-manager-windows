import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const ENVELOPE_MAX_BYTES = 30 * 1024 * 1024;
const KEY_BYTES = 32;
const IV_BYTES = 12;

export interface ProtectedEnvelope {
  version: 1;
  kind: 'vr-hub-protected-registry';
  revision: number;
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
  recovery: {
    salt: string;
    iv: string;
    tag: string;
    wrappedKey: string;
  };
}

export interface PinVerifier {
  version: 1;
  salt: string;
  digest: string;
}

function decodeBase64(value: unknown, field: string, maximum: number) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length > Math.ceil(maximum * 4 / 3) + 4) {
    throw new Error(`Seiful conține un câmp ${field} invalid.`);
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length > maximum) throw new Error(`Câmpul ${field} depășește limita permisă.`);
  return decoded;
}

function aad(revision: number) {
  return Buffer.from(`vr-hub-protected-registry:v1:${revision}`, 'utf8');
}

function encryptBytes(key: Buffer, plaintext: Buffer, associatedData: Buffer) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(associatedData);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

function decryptBytes(key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer, associatedData: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(associatedData);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function generateVaultKey() {
  return randomBytes(KEY_BYTES);
}

export function generateRecoveryKey() {
  const compact = randomBytes(24).toString('base64url').toUpperCase();
  return `VRH-${compact.match(/.{1,4}/g)?.join('-')}`;
}

function recoveryMaterial(recoveryKey: string, salt: Buffer) {
  const normalized = recoveryKey.trim().toUpperCase();
  if (!/^VRH-(?:[A-Z0-9_-]{4}-){7}[A-Z0-9_-]{4}$/.test(normalized)) {
    throw new Error('Cheia de recuperare nu are formatul valid.');
  }
  return scryptSync(normalized, salt, KEY_BYTES, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function encryptVault(payload: Uint8Array, vaultKey: Uint8Array, recoveryKey: string, revision: number): ProtectedEnvelope {
  const key = Buffer.from(vaultKey);
  if (key.length !== KEY_BYTES) throw new Error('Cheia seifului este invalidă.');
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Revizia seifului este invalidă.');
  const body = Buffer.from(payload);
  if (body.length > ENVELOPE_MAX_BYTES) throw new Error('Seiful depășește limita de dimensiune.');
  const encrypted = encryptBytes(key, body, aad(revision));
  const recoverySalt = randomBytes(16);
  const wrapped = encryptBytes(recoveryMaterial(recoveryKey, recoverySalt), key, Buffer.from('vr-hub-recovery:v1'));
  return {
    version: 1,
    kind: 'vr-hub-protected-registry',
    revision,
    keyId: createHash('sha256').update(key).digest('base64url').slice(0, 22),
    iv: encrypted.iv.toString('base64'),
    tag: encrypted.tag.toString('base64'),
    ciphertext: encrypted.ciphertext.toString('base64'),
    recovery: {
      salt: recoverySalt.toString('base64'),
      iv: wrapped.iv.toString('base64'),
      tag: wrapped.tag.toString('base64'),
      wrappedKey: wrapped.ciphertext.toString('base64'),
    },
  };
}

export function encryptVaultWithExistingRecovery(
  payload: Uint8Array,
  vaultKey: Uint8Array,
  revision: number,
  recovery: ProtectedEnvelope['recovery'],
): ProtectedEnvelope {
  const key = Buffer.from(vaultKey);
  if (key.length !== KEY_BYTES) throw new Error('Cheia seifului este invalidă.');
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Revizia seifului este invalidă.');
  const body = Buffer.from(payload);
  if (body.length > ENVELOPE_MAX_BYTES) throw new Error('Seiful depășește limita de dimensiune.');
  const encrypted = encryptBytes(key, body, aad(revision));
  return {
    version: 1,
    kind: 'vr-hub-protected-registry',
    revision,
    keyId: createHash('sha256').update(key).digest('base64url').slice(0, 22),
    iv: encrypted.iv.toString('base64'),
    tag: encrypted.tag.toString('base64'),
    ciphertext: encrypted.ciphertext.toString('base64'),
    recovery: { ...recovery },
  };
}

export function parseEnvelope(input: Uint8Array): ProtectedEnvelope {
  if (input.byteLength > ENVELOPE_MAX_BYTES * 2) throw new Error('Seiful depășește limita permisă.');
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(input).toString('utf8')); } catch { throw new Error('Seiful nu este un document valid.'); }
  const value = parsed as Partial<ProtectedEnvelope>;
  if (value.version !== 1 || value.kind !== 'vr-hub-protected-registry' || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0) {
    throw new Error('Versiunea sau revizia seifului este invalidă.');
  }
  if (typeof value.keyId !== 'string' || !/^[A-Za-z0-9_-]{20,24}$/.test(value.keyId)) throw new Error('Identitatea cheii seifului este invalidă.');
  if (!value.recovery || typeof value.recovery !== 'object') throw new Error('Datele de recuperare lipsesc.');
  decodeBase64(value.iv, 'iv', IV_BYTES);
  decodeBase64(value.tag, 'tag', 16);
  decodeBase64(value.ciphertext, 'ciphertext', ENVELOPE_MAX_BYTES);
  decodeBase64(value.recovery.salt, 'recovery.salt', 16);
  decodeBase64(value.recovery.iv, 'recovery.iv', IV_BYTES);
  decodeBase64(value.recovery.tag, 'recovery.tag', 16);
  decodeBase64(value.recovery.wrappedKey, 'recovery.wrappedKey', KEY_BYTES);
  return value as ProtectedEnvelope;
}

export function decryptVault(envelope: ProtectedEnvelope, vaultKey: Uint8Array) {
  const key = Buffer.from(vaultKey);
  if (key.length !== KEY_BYTES) throw new Error('Cheia seifului este invalidă.');
  const keyId = createHash('sha256').update(key).digest('base64url').slice(0, 22);
  if (keyId !== envelope.keyId) throw new Error('Cheia nu corespunde seifului din Google Drive.');
  try {
    return decryptBytes(
      key,
      decodeBase64(envelope.iv, 'iv', IV_BYTES),
      decodeBase64(envelope.tag, 'tag', 16),
      decodeBase64(envelope.ciphertext, 'ciphertext', ENVELOPE_MAX_BYTES),
      aad(envelope.revision),
    );
  } catch {
    throw new Error('Integritatea seifului nu poate fi verificată.');
  }
}

export function recoverVaultKey(envelope: ProtectedEnvelope, recoveryKey: string) {
  try {
    const recovery = envelope.recovery;
    const key = decryptBytes(
      recoveryMaterial(recoveryKey, decodeBase64(recovery.salt, 'recovery.salt', 16)),
      decodeBase64(recovery.iv, 'recovery.iv', IV_BYTES),
      decodeBase64(recovery.tag, 'recovery.tag', 16),
      decodeBase64(recovery.wrappedKey, 'recovery.wrappedKey', KEY_BYTES),
      Buffer.from('vr-hub-recovery:v1'),
    );
    if (key.length !== KEY_BYTES) throw new Error('invalid key');
    return key;
  } catch {
    throw new Error('Cheia de recuperare este incorectă sau seiful a fost modificat.');
  }
}

export function createPinVerifier(pin: string): PinVerifier {
  if (!/^\d{6}$/.test(pin)) throw new Error('PIN-ul trebuie să conțină exact 6 cifre.');
  const salt = randomBytes(16);
  return { version: 1, salt: salt.toString('base64'), digest: scryptSync(pin, salt, 32).toString('base64') };
}

export function verifyPin(pin: string, verifier: PinVerifier) {
  if (!/^\d{6}$/.test(pin) || verifier?.version !== 1) return false;
  try {
    const expected = decodeBase64(verifier.digest, 'pin.digest', 32);
    const actual = scryptSync(pin, decodeBase64(verifier.salt, 'pin.salt', 16), 32);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function routingHash(vaultKey: Uint8Array, kind: 'company' | 'order', value: string) {
  if (!value || value.length > 500) throw new Error('Identificatorul pentru rutare este invalid.');
  return createHmac('sha256', Buffer.from(vaultKey)).update(`${kind}:${value}`, 'utf8').digest('base64url');
}
