import assert from 'node:assert/strict';
import test from 'node:test';
import { isChannelAllowedForRole } from './viewerPolicy.ts';

test('writer may invoke every registered channel', () => {
  assert.equal(isChannelAllowedForRole('writer', 'add-production'), true);
  assert.equal(isChannelAllowedForRole('writer', 'a-future-channel'), true);
});

test('viewer can read data and control its local role', () => {
  assert.equal(isChannelAllowedForRole('viewer', 'get-raw-materials'), true);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:getInvoices'), true);
  assert.equal(isChannelAllowedForRole('viewer', 'set-device-role'), true);
  assert.equal(isChannelAllowedForRole('viewer', 'sync-viewer-now'), true);
  assert.equal(isChannelAllowedForRole('viewer', 'get-update-state'), true);
});

test('viewer denies business writes, cloud publishing and unknown channels', () => {
  assert.equal(isChannelAllowedForRole('viewer', 'add-production'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:updateInvoice'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'save-to-cloud'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'upload-pdf-to-cloud'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:testVrBakerConnection'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:previewWeeklyInvoices'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:createWeeklyInvoices'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'initialize-cash-balance'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'update-cash-receipt'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'delete-cash-transaction'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'a-future-channel'), false);
});
