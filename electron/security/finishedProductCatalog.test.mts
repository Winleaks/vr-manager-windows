import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('renderer cannot create, rename, or delete finished products manually', () => {
  const preload = readFileSync(fileURLToPath(new URL('../preload.ts', import.meta.url)), 'utf8');
  const handlers = readFileSync(fileURLToPath(new URL('../ipc/finishedProductHandlers.ts', import.meta.url)), 'utf8');
  for (const channel of ['add-finished-product', 'update-finished-product', 'delete-finished-product']) {
    assert.doesNotMatch(preload, new RegExp(channel));
    assert.doesNotMatch(handlers, new RegExp(channel));
  }
  assert.match(preload, /sync-finished-products/);
  assert.match(handlers, /sync-finished-products/);
});
