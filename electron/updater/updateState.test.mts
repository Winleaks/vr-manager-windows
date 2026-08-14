import assert from 'node:assert/strict';
import test from 'node:test';
import { createUpdateStateStore, sanitizeUpdateInfo } from './updateState.ts';

test('update state persists availability so the renderer can replay a missed event', () => {
  const store = createUpdateStateStore('0.1.73');
  store.available({
    version: '0.1.74',
    releaseName: 'Daily Cash',
    releaseNotes: [{ note: 'Ajustare sold' }],
    releaseDate: '2026-08-14T12:00:00Z',
  });
  assert.deepEqual(store.snapshot(), {
    status: 'available',
    currentVersion: '0.1.73',
    updateInfo: {
      version: '0.1.74',
      releaseName: 'Daily Cash',
      releaseNotes: 'Ajustare sold',
      releaseDate: '2026-08-14T12:00:00Z',
    },
    progress: 0,
    error: null,
  });
});

test('update state bounds progress and does not expose arbitrary updater fields', () => {
  const info = sanitizeUpdateInfo({
    version: '0.1.74',
    releaseNotes: '<script>not rendered as HTML</script>',
    files: [{ url: 'private updater detail' }],
  });
  assert.deepEqual(info, {
    version: '0.1.74',
    releaseName: null,
    releaseNotes: '<script>not rendered as HTML</script>',
    releaseDate: null,
  });
  const store = createUpdateStateStore('0.1.73');
  store.available(info);
  assert.equal(store.downloading(123.4).progress, 100);
  assert.equal(store.downloaded().status, 'downloaded');
});
