import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  assertUploadedFileMatches,
  CLOUD_ROOT_FOLDER_NAME,
  evaluateCloudSyncHealth,
} from './cloudSyncPolicy.ts';

test('keeps the existing business Drive folder as the canonical cloud destination', () => {
  assert.equal(CLOUD_ROOT_FOLDER_NAME, 'VR - Management');
});

test('cloud settings expose only the configured root folder, not database or invoice paths', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/pages/SettingsSystem.tsx'), 'utf8');
  assert.match(source, /Folder principal: My Drive \/ \{cloudStatus\.rootFolderName\}/);
  assert.doesNotMatch(source, /Bază: My Drive/);
  assert.doesNotMatch(source, /Facturi: My Drive/);
});

test('desktop OAuth listens on an available loopback port instead of a fixed port', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'electron/database/cloudSync.ts'), 'utf8');
  assert.match(source, /listen\(0, '127\.0\.0\.1'/);
  assert.doesNotMatch(source, /listen\(3456/);
});

test('desktop OAuth token exchange receives the matching client credentials from the release build', () => {
  const cloudSource = fs.readFileSync(path.join(process.cwd(), 'electron/database/cloudSync.ts'), 'utf8');
  const viteSource = fs.readFileSync(path.join(process.cwd(), 'vite.config.ts'), 'utf8');
  const workflowSource = fs.readFileSync(path.join(process.cwd(), '.github/workflows/release.yml'), 'utf8');

  assert.match(cloudSource, /new google\.auth\.OAuth2\(CLIENT_ID, CLIENT_SECRET, redirectUri\)/);
  assert.match(viteSource, /__VR_HUB_GOOGLE_CLIENT_SECRET__.*VR_HUB_GOOGLE_CLIENT_SECRET/);
  assert.match(workflowSource, /VR_HUB_GOOGLE_CLIENT_SECRET:.*secrets\.VR_HUB_GOOGLE_CLIENT_SECRET/);
  assert.match(workflowSource, /IsNullOrWhiteSpace\(\$env:VR_HUB_GOOGLE_CLIENT_SECRET\)/);
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
