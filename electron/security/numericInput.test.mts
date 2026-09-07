import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { normalizeNumericInput, normalizePinInput } from '../../src/utils/numericInput.ts';

test('keyboard numeric input accepts whole amounts, decimals and comma separator', () => {
  assert.equal(normalizeNumericInput('1'), '1');
  assert.equal(normalizeNumericInput('10'), '10');
  assert.equal(normalizeNumericInput('578.25'), '578.25');
  assert.equal(normalizeNumericInput('578,25'), '578.25');
  assert.equal(normalizeNumericInput('0.001', { decimalScale: 3 }), '0.001');
});

test('keyboard numeric input rejects letters and invalid precision', () => {
  assert.equal(normalizeNumericInput('1a'), '1');
  assert.equal(normalizeNumericInput('1.234', { decimalScale: 2 }), '1.23');
  assert.equal(normalizeNumericInput('1.5', { integer: true }), '1');
  assert.equal(normalizeNumericInput('-1'), '1');
  assert.equal(normalizeNumericInput('£1,234.56'), '1234.56');
  assert.equal(normalizeNumericInput(',5'), '0.5');
});

test('PIN keyboard input accepts exactly six digits and rejects other characters', () => {
  assert.equal(normalizePinInput('12 34a56'), '123456');
  assert.equal(normalizePinInput('123456789'), '123456');
  assert.equal(normalizePinInput('abcdef'), '');
});

test('protected registry uses a masked text input that remains keyboard-editable on Windows', () => {
  const component = readFileSync(fileURLToPath(new URL('../../src/components/PinInput.tsx', import.meta.url)), 'utf8');
  const registry = readFileSync(fileURLToPath(new URL('../../src/pages/ProtectedRegistry.tsx', import.meta.url)), 'utf8');
  assert.match(component, /type="text"/);
  assert.match(component, /inputMode="numeric"/);
  assert.match(component, /secure-pin-input/);
  assert.match(registry, /<PinInput/);
});

test('renderer never uses native number inputs that can block Windows keyboard entry', () => {
  const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));
  const visit = (directoryPath: string): string[] => readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directoryPath, entry.name);
    if (entry.isDirectory()) return visit(path);
    return extname(path) === '.tsx' ? [path] : [];
  });
  for (const path of visit(sourceRoot)) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /type=["']number["']/i, path);
  }
});
