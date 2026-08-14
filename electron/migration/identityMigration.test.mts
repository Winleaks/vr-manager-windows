import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { migrateLegacyIdentity } from './identityMigration.ts';

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-hub-identity-test-'));
  const legacy = path.join(root, 'VR - Management Hub');
  const target = path.join(root, 'VR - Hub Management');
  fs.mkdirSync(path.join(legacy, 'baze de date'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'baze de date', 'bazadedate.db'), 'verified-db');
  fs.mkdirSync(path.join(legacy, 'baze de date', 'backups'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'baze de date', 'backups', 'backup_legacy.db'), 'verified-db');
  fs.writeFileSync(path.join(legacy, 'secure-credentials.json'), JSON.stringify({ version: 1, values: { token: 'encrypted' } }));
  fs.writeFileSync(path.join(legacy, 'device-state.json'), JSON.stringify({ role: 'writer', lastRemoteVersion: '4' }));
  return { root, legacy, target };
}

test('migrates a verified legacy database and device configuration without deleting the source', () => {
  const fixture = makeFixture();
  try {
    const result = migrateLegacyIdentity({
      targetUserData: fixture.target,
      legacyUserDataDirs: [fixture.legacy],
      validateDatabase: (filePath) => assert.equal(fs.readFileSync(filePath, 'utf8'), 'verified-db'),
    });
    assert.equal(result.databaseMigrated, true);
    assert.deepEqual(result.configFilesMigrated.sort(), ['device-state.json', 'secure-credentials.json']);
    assert.equal(result.backupFilesMigrated, 1);
    assert.equal(fs.existsSync(path.join(fixture.legacy, 'baze de date', 'bazadedate.db')), true);
    assert.equal(fs.readFileSync(path.join(fixture.target, 'baze de date', 'bazadedate.db'), 'utf8'), 'verified-db');
    assert.equal(fs.readFileSync(path.join(fixture.target, 'baze de date', 'backups', 'backup_legacy.db'), 'utf8'), 'verified-db');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('is idempotent and does not overwrite existing target data', () => {
  const fixture = makeFixture();
  try {
    fs.mkdirSync(path.join(fixture.target, 'baze de date'), { recursive: true });
    fs.writeFileSync(path.join(fixture.target, 'baze de date', 'bazadedate.db'), 'current-db');
    migrateLegacyIdentity({
      targetUserData: fixture.target,
      legacyUserDataDirs: [fixture.legacy],
      validateDatabase: () => {},
    });
    const second = migrateLegacyIdentity({
      targetUserData: fixture.target,
      legacyUserDataDirs: [fixture.legacy],
      validateDatabase: () => {},
    });
    assert.equal(fs.readFileSync(path.join(fixture.target, 'baze de date', 'bazadedate.db'), 'utf8'), 'current-db');
    assert.equal(second.migrated, false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
