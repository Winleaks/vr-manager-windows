import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBackupFilename,
  parseBackupFilename,
  selectBackupFilesToDelete,
} from './backupPolicy.ts';

test('creates sortable, collision-resistant backup names', () => {
  const now = new Date('2026-08-11T12:34:56.789Z');
  assert.equal(createBackupFilename(now), 'backup_2026-08-11T12-34-56-789Z.db');
  assert.equal(parseBackupFilename(createBackupFilename(now))?.createdAt.toISOString(), now.toISOString());
});

test('keeps recent snapshots and one daily snapshot inside retention', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');
  const filenames = [
    'backup_2026-08-11T11-50-00-000Z.db',
    'backup_2026-08-11T11-40-00-000Z.db',
    'backup_2026-08-10T23-50-00-000Z.db',
    'backup_2026-08-10T12-00-00-000Z.db',
    'backup_2026-07-01T12-00-00-000Z.db',
    'backup_2026-08-11.db',
    'pre_restore_2026-08-11.db',
  ];

  assert.deepEqual(
    selectBackupFilesToDelete(filenames, now, 2, 30).sort(),
    ['backup_2026-07-01T12-00-00-000Z.db', 'backup_2026-08-10T12-00-00-000Z.db'],
  );
});

test('never prunes files it does not recognize as managed snapshots', () => {
  assert.deepEqual(selectBackupFilesToDelete(['manual.db', 'backup_2026-08-11.db']), []);
});
