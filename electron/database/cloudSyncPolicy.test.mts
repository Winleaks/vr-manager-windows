import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertUploadedFileMatches,
  CLOUD_ROOT_FOLDER_NAME,
  evaluateCloudSyncHealth,
} from './cloudSyncPolicy.ts';

test('keeps the existing business Drive folder as the canonical cloud destination', () => {
  assert.equal(CLOUD_ROOT_FOLDER_NAME, 'VR - Management');
});

test('accepts an uploaded file only after identity, parent, checksum and size verification', () => {
  const result = assertUploadedFileMatches(
    { id: 'drive-file', name: 'backup.db', parents: ['database-folder'], md5Checksum: 'aabb', size: '42', modifiedTime: '2026-09-06T10:00:00Z' },
    { name: 'backup.db', parentId: 'database-folder', md5Checksum: 'AABB', size: 42 },
  );
  assert.equal(result.fileId, 'drive-file');
  assert.throws(() => assertUploadedFileMatches(
    { id: 'drive-file', name: 'backup.db', parents: ['wrong-folder'], md5Checksum: 'aabb', size: '42' },
    { name: 'backup.db', parentId: 'database-folder', md5Checksum: 'aabb', size: 42 },
  ), /folderul Google Drive/);
  assert.throws(() => assertUploadedFileMatches(
    { id: 'drive-file', name: 'backup.db', parents: ['database-folder'], md5Checksum: 'different', size: '42' },
    { name: 'backup.db', parentId: 'database-folder', md5Checksum: 'aabb', size: 42 },
  ), /Checksum/);
  assert.throws(() => assertUploadedFileMatches(
    { id: 'drive-file', name: 'backup.db', parents: ['database-folder'], md5Checksum: 'aabb', size: '41' },
    { name: 'backup.db', parentId: 'database-folder', md5Checksum: 'aabb', size: 42 },
  ), /Dimensiunea/);
});

test('distinguishes a valid token from a healthy and fresh cloud replica', () => {
  const now = Date.parse('2026-09-06T10:30:00Z');
  assert.equal(evaluateCloudSyncHealth({ hasTokens: false, apiHealthy: false, nowMs: now }), 'disconnected');
  assert.equal(evaluateCloudSyncHealth({ hasTokens: true, apiHealthy: false, nowMs: now }), 'error');
  assert.equal(evaluateCloudSyncHealth({ hasTokens: true, apiHealthy: true, lastUploadError: 'upload failed', lastModifiedTime: '2026-09-06T10:29:00Z', nowMs: now }), 'error');
  assert.equal(evaluateCloudSyncHealth({ hasTokens: true, apiHealthy: true, lastModifiedTime: '2026-08-14T10:00:00Z', nowMs: now }), 'stale');
  assert.equal(evaluateCloudSyncHealth({ hasTokens: true, apiHealthy: true, lastModifiedTime: '2026-09-06T10:20:00Z', nowMs: now }), 'healthy');
});
