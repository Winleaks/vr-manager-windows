import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNumericInput } from '../../src/utils/numericInput.ts';

test('keyboard numeric input accepts whole amounts, decimals and comma separator', () => {
  assert.equal(normalizeNumericInput('1'), '1');
  assert.equal(normalizeNumericInput('10'), '10');
  assert.equal(normalizeNumericInput('578.25'), '578.25');
  assert.equal(normalizeNumericInput('578,25'), '578.25');
  assert.equal(normalizeNumericInput('0.001', { decimalScale: 3 }), '0.001');
});

test('keyboard numeric input rejects letters and invalid precision', () => {
  assert.equal(normalizeNumericInput('1a'), null);
  assert.equal(normalizeNumericInput('1.234', { decimalScale: 2 }), null);
  assert.equal(normalizeNumericInput('1.5', { integer: true }), null);
  assert.equal(normalizeNumericInput('-1'), null);
});
