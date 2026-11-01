import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppLifecycle } from './appLifecycle.ts';

function fixture() {
  const calls: string[] = [];
  let allowed = true;
  let window: typeof handle | null = null;
  const handle = {
    isDestroyed: () => false, isMinimized: () => true,
    restore: () => { calls.push('restore'); },
    show: () => { calls.push('show'); }, focus: () => { calls.push('focus'); },
  };
  const lifecycle = createAppLifecycle({
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
