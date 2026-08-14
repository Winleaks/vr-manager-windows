import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDeviceState, shouldApplyRemoteVersion } from './deviceStatePolicy.ts';

test('an unconfigured or invalid device defaults safely to viewer', () => {
  assert.deepEqual(parseDeviceState(null), { role: 'viewer' });
  assert.deepEqual(parseDeviceState({ role: 'invalid' }), { role: 'viewer' });
  assert.deepEqual(parseDeviceState({ role: 'viewer' }), { role: 'viewer' });
});

test('viewer applies a different Drive file or version only once', () => {
  const state = {
    role: 'viewer' as const,
    lastRemoteFileId: 'file-1',
    lastRemoteVersion: '12',
    lastRemoteModifiedTime: '2026-08-11T09:00:00Z',
  };
  assert.equal(shouldApplyRemoteVersion(state, { fileId: 'file-2', version: '12' }), true);
  assert.equal(shouldApplyRemoteVersion(state, { fileId: 'file-1', version: '13' }), true);
  assert.equal(shouldApplyRemoteVersion(state, { fileId: 'file-1', version: '12' }), false);
});
