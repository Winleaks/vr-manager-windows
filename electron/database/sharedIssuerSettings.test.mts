import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initialSchema } from './schema.ts';
import { ensureBillingIssuerSchema, getBillingIssuers } from './billingIssuers.ts';
import { ensureCreditNoteSchema } from './creditNotes.ts';
import { updateSharedIssuerSettings } from './sharedIssuerSettings.ts';
import { sharedIssuerSettingsInput } from '../../src/shared/sharedIssuerSettings.ts';
import { isChannelAllowedForRole } from '../device/viewerPolicy.ts';

function fixture() {
  const db = new Database(':memory:');
  db.exec(initialSchema);
  ensureBillingIssuerSchema(db);
  ensureCreditNoteSchema(db);
  const issuer = getBillingIssuers(db)[0];
  const input = {
    id: issuer.id, legalName: 'SYNTHETIC BAKERY LTD', address: '1 Test Road', companyNumber: '12345678',
    vatNumber: 'GB123456789', bankName1: 'Barclays', accountNumber1: '12345678', sortCode1: '12-34-56',
    bankName2: 'Virgin', accountNumber2: '87654321', sortCode2: '65-43-21', footer: 'Thank you',
    color: '#4f46e5', alternateRowColor: '#abcdef', alternateRowOpacity: 5, invoiceLogo: '',
  };
  return { db, input };
}

test('shared issuer settings save common fields without touching either numbering series or historical documents', () => {
  const { db, input } = fixture();
  try {
    const before = db.prepare('SELECT * FROM billing_issuers').all() as any[];
    const identity = () => db.prepare('SELECT * FROM invoice_identities').all();
    const oldIdentity = identity();
    updateSharedIssuerSettings(db, input);
    const after = db.prepare('SELECT * FROM billing_issuers').all() as any[];
    for (const old of before) {
      const row = after.find(r => r.id === old.id);
      for (const key of ['invoice_series', 'next_invoice_number', 'credit_note_series', 'next_credit_note_number', 'credit_note_sequence_confirmed', 'is_active', 'vat_registered', 'is_default']) assert.equal(row[key], old[key], key);
      if (old.id !== input.id) assert.deepEqual(row, old);
    }
    assert.equal(after.find(r => r.id === input.id).bank_name_2, 'Virgin');
    assert.deepEqual(identity(), oldIdentity);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM billing_audit_events WHERE event_type='shared_issuer_settings_updated'").get() as any).n, 1);
  } finally { db.close(); }
});

test('common payload excludes counters and financial state even when the form contains them', () => {
  const { db, input } = fixture();
  try {
    const form = { ...input, invoiceSeries: 'NEW', nextInvoiceNumber: 900, isActive: false };
    assert.deepEqual(sharedIssuerSettingsInput(form, ''), input);
    const before = db.prepare('SELECT invoice_series,next_invoice_number,is_active FROM billing_issuers WHERE id=?').get(input.id);
    updateSharedIssuerSettings(db, form);
    assert.deepEqual(db.prepare('SELECT invoice_series,next_invoice_number,is_active FROM billing_issuers WHERE id=?').get(input.id), before);
  } finally { db.close(); }
});

test('issuer, logo and audit commit together and roll back on storage failure', () => {
  const { db, input } = fixture();
  try {
    const before = db.prepare('SELECT * FROM billing_issuers').all();
    db.exec("CREATE TRIGGER reject_test_audit BEFORE INSERT ON billing_audit_events BEGIN SELECT RAISE(ABORT, 'synthetic storage failure'); END;");
    assert.throws(() => updateSharedIssuerSettings(db, input), /synthetic storage failure/);
    assert.deepEqual(db.prepare('SELECT * FROM billing_issuers').all(), before);
    assert.equal(db.prepare("SELECT value FROM app_settings WHERE key='invoice_logo'").get(), undefined);
  } finally { db.close(); }
});

test('shared settings reject missing issuer, incomplete required fields, invalid appearance and Viewer writes', () => {
  const { db, input } = fixture();
  try {
    const before = db.prepare('SELECT * FROM billing_issuers').all();
    for (const overrides of [{ id: 0 }, { id: 99999 }, { legalName: '' }, { color: 'blue' }, { alternateRowOpacity: NaN }, { invoiceLogo: 'not an image' }]) {
      assert.throws(() => updateSharedIssuerSettings(db, { ...input, ...overrides }));
      assert.deepEqual(db.prepare('SELECT * FROM billing_issuers').all(), before);
    }
    assert.equal(isChannelAllowedForRole('viewer', 'billing:updateSharedIssuerSettings'), false);
    assert.equal(isChannelAllowedForRole('writer', 'billing:updateSharedIssuerSettings'), true);
  } finally { db.close(); }
});
