import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPinVerifier,
  decryptVault,
  encryptVault,
  generateRecoveryKey,
  generateVaultKey,
  parseEnvelope,
  recoverVaultKey,
  routingHash,
  verifyPin,
} from '../protectedRegistry/crypto.ts';
import { createEmptyProtectedVault } from '../protectedRegistry/types.ts';

test('protected registry vault encrypts, authenticates and recovers without using the PIN as key', () => {
  const vault = createEmptyProtectedVault('2026-09-06T10:00:00.000Z');
  const key = generateVaultKey();
  const recovery = generateRecoveryKey();
  const envelope = encryptVault(Buffer.from(JSON.stringify(vault)), key, recovery, 0);
  const parsed = parseEnvelope(Buffer.from(JSON.stringify(envelope)));
  assert.deepEqual(JSON.parse(decryptVault(parsed, key).toString('utf8')), vault);
  assert.deepEqual(recoverVaultKey(parsed, recovery), key);
  const wrongRecovery = `${recovery.slice(0, -1)}${recovery.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => recoverVaultKey(parsed, wrongRecovery), /incorectă|modificat/);
});

test('protected registry rejects authenticated ciphertext tampering', () => {
  const key = generateVaultKey();
  const envelope = encryptVault(Buffer.from('important'), key, generateRecoveryKey(), 7);
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  ciphertext[0] ^= 1;
  envelope.ciphertext = ciphertext.toString('base64');
  assert.throws(() => decryptVault(envelope, key), /Integritatea/);
});

test('six digit PIN verifier and opaque routing hashes are deterministic and separated by kind', () => {
  const verifier = createPinVerifier('123456');
  assert.equal(verifyPin('123456', verifier), true);
  assert.equal(verifyPin('654321', verifier), false);
  assert.throws(() => createPinVerifier('12345'), /6 cifre/);
  const key = Buffer.alloc(32, 9);
  assert.equal(routingHash(key, 'company', 'vrbaker:abc'), routingHash(key, 'company', 'vrbaker:abc'));
  assert.notEqual(routingHash(key, 'company', 'vrbaker:abc'), routingHash(key, 'order', 'vrbaker:abc'));
  assert.equal(routingHash(key, 'company', 'vrbaker:abc').includes('abc'), false);
});
