import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppLifecycle } from './appLifecycle.ts';

function fixture(tray = false) {
  const calls: string[] = [];
  let allowed = true;
  let window: typeof handle | null = null;
  const handle = {
    isDestroyed: () => false, isMinimized: () => true,
    restore: () => { calls.push('restore'); },
    hide: () => { calls.push('hide'); },
    show: () => { calls.push('show'); }, focus: () => { calls.push('focus'); },
  };
  const lifecycle = createAppLifecycle({
    canHideToTray: () => tray,
    confirmClose: () => allowed, getWindow: () => window,
    createWindow: () => { calls.push('create'); window = handle; },
    quit: () => { calls.push('quit'); },
    cleanup: [() => { calls.push('stop'); throw new Error('cleanup failure'); }, () => { calls.push('close-db'); }],
    reportError: () => { calls.push('error'); },
  });
  return { lifecycle, calls, cancelClose: () => { allowed = false; } };
}

test('second launch restores the existing window and creates no duplicate Writer window', () => {
  const { lifecycle, calls } = fixture();
  lifecycle.reopen();
  assert.deepEqual(calls, []);
  lifecycle.ready(); lifecycle.reopen(); lifecycle.reopen();
  assert.deepEqual(calls, ['create', 'restore', 'show', 'focus', 'restore', 'show', 'focus']);
});

test('cancelled quit leaves the app usable without closing the database', () => {
  const { lifecycle, calls, cancelClose } = fixture();
  lifecycle.ready(); cancelClose();
  lifecycle.beforeQuit({ preventDefault: () => { calls.push('cancel'); } });
  lifecycle.reopen();
  assert.deepEqual(calls, ['cancel', 'create', 'restore', 'show', 'focus']);
});

test('closing main window requests quit; accepted quit cannot reopen and cleans up once', () => {
  const { lifecycle, calls } = fixture();
  lifecycle.ready(); lifecycle.mainWindowClosed();
  lifecycle.beforeQuit({ preventDefault: () => assert.fail('unexpected cancellation') });
  lifecycle.mainWindowClosed(); lifecycle.reopen();
  assert.deepEqual(calls, ['quit']);
  lifecycle.willQuit(); lifecycle.willQuit();
  assert.deepEqual(calls, ['quit', 'stop', 'error', 'close-db']);
});


test('X with a working tray hides without confirmation or cleanup; reopening preserves the window', () => {
  const { lifecycle, calls, cancelClose } = fixture(true);
  lifecycle.ready(); lifecycle.reopen(); calls.length = 0;
  cancelClose();
  lifecycle.windowClose({ preventDefault: () => { calls.push('prevent'); } });
  lifecycle.reopen();
  assert.deepEqual(calls, ['prevent', 'hide', 'restore', 'show', 'focus']);
});

test('explicit quit bypasses tray hiding and cleans up once', () => {
  const { lifecycle, calls } = fixture(true);
  lifecycle.ready(); lifecycle.reopen(); calls.length = 0;
  lifecycle.beforeQuit({ preventDefault: () => assert.fail('quit rejected') });
  lifecycle.windowClose({ preventDefault: () => assert.fail('quit hidden') });
  lifecycle.willQuit(); lifecycle.willQuit();
  assert.deepEqual(calls, ['stop', 'error', 'close-db']);
});

test('without a tray, cancelling financial close retains the window', () => {
  const { lifecycle, calls, cancelClose } = fixture(false);
  cancelClose();
  lifecycle.windowClose({ preventDefault: () => { calls.push('prevent'); } });
  assert.deepEqual(calls, ['prevent']);
});

test('Windows session termination bypasses hiding and releases resources', () => {
  const { lifecycle, calls } = fixture(true);
  lifecycle.sessionEnding();
  lifecycle.windowClose({ preventDefault: () => assert.fail('session end hidden') });
  lifecycle.willQuit();
  assert.deepEqual(calls, ['stop', 'error', 'close-db']);
});
