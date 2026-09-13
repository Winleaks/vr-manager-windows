import test from 'node:test';
import assert from 'node:assert/strict';
import { withPrivateCloudOperation, resolvePrivateFolderInOperation } from './privateCloudOperation.ts';

test('folder IDs are reused only in one operation; parallel reads share one resolution', async () => {
  let reads = 0;
  const resolve = async () => { reads++; return 'folder-id'; };
  await withPrivateCloudOperation(async () => {
    assert.deepEqual(await Promise.all(Array.from({ length: 8 }, () => resolvePrivateFolderInOperation('account/path', resolve))), Array(8).fill('folder-id'));
    assert.equal(reads, 1);
    await resolvePrivateFolderInOperation('other-account/path', resolve);
    assert.equal(reads, 2);
  });
  await withPrivateCloudOperation(() => resolvePrivateFolderInOperation('account/path', resolve));
  assert.equal(reads, 3);
  await resolvePrivateFolderInOperation('account/path', resolve);
  assert.equal(reads, 4);
});

test('missing and failed folder reads are not cached and operation failures discard IDs', async () => {
  let reads = 0;
  await assert.rejects(withPrivateCloudOperation(async () => {
    await resolvePrivateFolderInOperation('key', async () => { reads++; return null; });
    await assert.rejects(resolvePrivateFolderInOperation('key', async () => { reads++; throw Error('offline'); }));
    assert.equal(await resolvePrivateFolderInOperation('key', async () => { reads++; return 'created'; }), 'created');
    throw Error('save failed');
  }));
  await withPrivateCloudOperation(() => resolvePrivateFolderInOperation('key', async () => { reads++; return 'fresh'; }));
  assert.equal(reads, 4);
});
