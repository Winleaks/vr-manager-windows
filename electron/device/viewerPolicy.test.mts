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
  assert.equal(isChannelAllowedForRole('viewer', 'billing:getIssuers'), true);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:getTestMode'), true);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:getCreditNotes'), true);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:getCreditNote'), true);
  assert.equal(isChannelAllowedForRole('viewer', 'set-device-role'), true);
  assert.equal(isChannelAllowedForRole('viewer', 'sync-viewer-now'), true);
  assert.equal(isChannelAllowedForRole('viewer', 'get-update-state'), true);
  assert.equal(isChannelAllowedForRole('viewer', 'get-daily-cash-report'), true);
});

test('viewer denies business writes, cloud publishing and unknown channels', () => {
  assert.equal(isChannelAllowedForRole('viewer', 'add-production'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:updateInvoice'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'save-to-cloud'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'upload-pdf-to-cloud'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:testVrBakerConnection'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:previewWeeklyInvoices'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:createWeeklyInvoices'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:createWeeklyInvoicesByZone'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:createManualInvoice'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'protectedRegistry:status'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'protectedRegistry:getInvoices'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'protectedRegistry:configure'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:updateIssuer'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:assignCompanyIssuer'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:cancelInvoice'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:setTestMode'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:deleteTestInvoice'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:updatePayment'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:reissueCancelledInvoice'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:createCreditNote'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:cancelCreditNote'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:applyCompanyCredit'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:reverseCreditApplication'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'billing:prepareCreditNotePdf'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'initialize-cash-balance'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'update-cash-receipt'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'delete-cash-transaction'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'reopen-cash-day'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'prepare-daily-cash-whatsapp'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'sync-finished-products'), false);
  assert.equal(isChannelAllowedForRole('viewer', 'a-future-channel'), false);
});
