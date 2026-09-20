import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as crypto from '../protectedRegistry/crypto.ts';
import { ProtectedOutboxStore } from '../protectedRegistry/outbox.ts';
import { isChannelAllowedForRole } from '../device/viewerPolicy.ts';

import { protectedOutboxHarness as fixture } from './fixtures/protectedOutboxHarness.mts';

test('accepts consecutive encrypted saves while upload waits; no duplicate number on replay; removes only acknowledged files', async t => {
  const f = fixture(t);
  let release!: () => void;
  f.state.gate = new Promise(resolve => { release = resolve; });
  const id = randomUUID();
  const first = await f.issue(id);
  await f.issue(id);
  await f.issue();
  assert.equal(f.store.count(), 2);
  assert.equal(f.sessions.get(1).vault.counters.TGBL, 3);
  assert.equal(first.counters.TGBL, 2);
  assert.equal(f.state.probes, 3);
  assert.equal(f.state.writes.length, 0, 'local acceptance does not await upload');
  for (const name of fs.readdirSync(f.directory)) {
    const bytes = fs.readFileSync(path.join(f.directory, name));
    assert.equal(bytes.includes(Buffer.from('TGBL-')), false);
    assert.equal(bytes.includes(Buffer.from(id)), false);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(f.directory, name)).mode & 0o777, 0o600);
  }
  assert.throws(() => f.api.assertProtectedCloudSettled(), /salvări în curs/);
  release(); await f.worker.start();
  assert.equal(f.store.count(), 0);
  assert.equal(fs.readdirSync(f.directory).length, 0);
  assert.equal(f.current().invoices.length, 2);
  assert.equal(f.current().counters.TGBL, 3);
  assert.equal(f.state.documents.length, 2);
  assert.equal(f.worker.status().state, 'synced');
});

test('partial and ambiguous commits/PDF failures retain ciphertext, block new work, and retry the same revision', async t => {
  for (const stage of ['registru-separat.pending', 'registru-separat.vault', 'registru-separat.manifest', 'delete', 'pdf']) {
    for (const after of [false, true]) {
      const f = fixture(t); f.state.failAt = stage; f.state.afterWrite = after;
      await f.issue(); await f.worker.start();
      assert.equal(f.store.count(), 1, stage);
      assert.equal(f.worker.status().state, 'error');
      await assert.rejects(f.issue(), /operațiunile noi sunt oprite/);
      f.state.failAt = ''; await f.worker.start();
      assert.equal(f.store.count(), 0);
      assert.equal(f.current().revision, 1);
      assert.equal(f.current().invoices.length, 1);
      assert.equal(f.current().counters.TGBL, 2);
    }
  }
});

test('restart recovers accepted pending edits without reissuing and keeps them after a PDF interruption', async t => {
  const first = fixture(t);
  first.state.failAt = 'pdf';
  await first.issue(); await first.worker.start(); first.worker.stop();
  const second = fixture(t, first); second.sessions.clear(); second.state.failAt = 'pdf';
  await second.api.unlockProtectedRegistry(1, 'synthetic-pin');
  assert.equal(second.sessions.get(1).vault.invoices.length, 1);
  assert.equal(second.store.count(), 1);
  second.state.failAt = ''; await second.worker.start();
  assert.equal(second.current().invoices.length, 1);
  assert.equal(second.store.count(), 0);
});

test('offline, locked, Viewer and local-write failures cannot accept an operation', async t => {
  for (const failure of ['offline', 'viewer', 'locked', 'disk']) {
    const f = fixture(t);
    if (failure === 'offline') f.state.offline = true;
    if (failure === 'viewer') f.state.role = 'viewer';
    if (failure === 'locked') f.state.lockOnProbe = true;
    if (failure === 'disk') f.store.append = () => { throw Error('synthetic disk full'); };
    await assert.rejects(f.issue());
    assert.equal(f.store.count(), 0);
    assert.equal(f.state.writes.length, 0);
    assert.equal(f.sessions.get(1)?.vault.invoices.length || 0, 0);
  }
  for (const channel of ['protectedRegistry:syncStatus', 'protectedRegistry:retrySync']) assert.equal(isChannelAllowedForRole('viewer', channel), false);
});

test('account/file/version conflicts never overwrite Drive or delete pending work', async t => {
  for (const conflict of ['account', 'file', 'version']) {
    const f = fixture(t);
    f.state.failAt = 'pdf'; await f.issue(); await f.worker.start();
    const before = f.state.writes.length;
    if (conflict === 'account') f.state.scope = 'b'.repeat(64);
    if (conflict === 'file') f.files.get('registru-separat.vault').fileId = 'other-vault';
    if (conflict === 'version') {
      const external = f.current(); external.counters.TGBL = 10;
      const old = crypto.parseEnvelope(f.files.get('registru-separat.vault').buffer);
      f.files.get('registru-separat.vault').buffer = Buffer.from(JSON.stringify(crypto.encryptVaultWithExistingRecovery(Buffer.from(JSON.stringify(external)), f.key, external.revision, old.recovery)));
    }
    f.state.failAt = ''; await f.worker.start();
    assert.equal(f.store.count(), 1);
    assert.equal(f.state.writes.length, before);
    assert.equal(f.worker.status().state, 'error');
  }
});

test('local encrypted state requires the matching key; polling does not extend PIN sessions', async t => {
  const f = fixture(t); f.state.failAt = 'pdf'; await f.issue(); await f.worker.start();
  assert.throws(() => new ProtectedOutboxStore(f.directory, () => crypto.generateVaultKey()).read(), /criptată nu poate fi verificată/);
  const session = f.sessions.get(1); session.lastActivity = Date.now() - 10000;
  const time = session.lastActivity;
  await f.api.protectedRegistrySyncStatus(1);
  assert.equal(session.lastActivity, time);
  session.lastActivity = Date.now() - 700000;
  await assert.rejects(f.api.protectedRegistrySyncStatus(1), /expirat/);
  assert.equal(f.store.count(), 1);
  assert.equal(f.sessions.size, 0);
});

test('an ambiguous local rename acknowledgement cannot leave RAM behind the accepted revision', async t => {
  const f = fixture(t); f.state.failAt = 'pdf';
  const append = f.store.append.bind(f.store);
  f.store.append = value => { append(value); throw Error('synthetic failure after rename'); };
  const operation = randomUUID();
  await assert.rejects(f.issue(operation), /nu emite un document nou/);
  assert.equal(f.sessions.get(1).vault.invoices.length, 1);
  await f.worker.start(); assert.equal(f.store.count(), 1);
  f.state.failAt = ''; f.store.append = append; await f.worker.start();
  await f.issue(operation);
  assert.equal(f.current().invoices.length, 1);
  assert.equal(f.current().counters.TGBL, 2);
  assert.equal(f.store.count(), 0);
});
