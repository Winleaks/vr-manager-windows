import assert from 'node:assert/strict';
import test from 'node:test';
import { requireUuid } from '../../supabase/functions/_shared/external-api-security.ts';

test('Edge API accepts the canonical UUID syntax supported by PostgreSQL', () => {
  const legacyUuid = '99999999-9999-9999-9999-999999999999';
  assert.equal(requireUuid(legacyUuid, 'cursor'), legacyUuid);
});

test('Edge API still rejects values outside canonical UUID syntax', () => {
  assert.throws(() => requireUuid('99999999-9999-9999-9999-999999999999-extra', 'cursor'));
  assert.throws(() => requireUuid('not-a-uuid', 'cursor'));
});
