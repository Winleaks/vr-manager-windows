import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEGACY_CLOUD_DATABASE_NAME,
  PRIMARY_CLOUD_DATABASE_NAME,
  selectPreferredCloudDatabase,
} from './cloudBackupSelection.ts';

test('prefers the new VR Hub backup even when the legacy backup is newer', () => {
  const selected = selectPreferredCloudDatabase([
    { id: 'legacy', name: LEGACY_CLOUD_DATABASE_NAME, modifiedTime: '2026-08-11T12:00:00Z' },
    { id: 'primary', name: PRIMARY_CLOUD_DATABASE_NAME, modifiedTime: '2026-08-11T10:00:00Z' },
  ]);
  assert.equal(selected?.id, 'primary');
});

test('falls back to the newest legacy backup until the new name exists', () => {
  const selected = selectPreferredCloudDatabase([
    { id: 'older', name: LEGACY_CLOUD_DATABASE_NAME, modifiedTime: '2026-08-10T10:00:00Z' },
    { id: 'newer', name: LEGACY_CLOUD_DATABASE_NAME, modifiedTime: '2026-08-11T10:00:00Z' },
  ]);
  assert.equal(selected?.id, 'newer');
});

test('ignores the legacy backup after a verified primary backup was observed', () => {
  const selected = selectPreferredCloudDatabase([
    { id: 'legacy', name: LEGACY_CLOUD_DATABASE_NAME, modifiedTime: '2026-08-11T10:00:00Z' },
  ], false);
  assert.equal(selected, null);
});
