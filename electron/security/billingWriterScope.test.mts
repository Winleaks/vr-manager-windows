import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  authenticateExternalApiRequest, parseExternalApiCredentials, sha256, withBillingWriterScope,
} from '../../supabase/functions/_shared/external-api-security.ts';

const writerKey = 'synthetic-writer-token-for-permission-tests';
const otherKey = 'synthetic-other-token-for-permission-tests';
const now = Date.parse('2026-09-07T00:00:00Z');
async function fixture() {
  const raw = JSON.stringify([
    { id: 'test-writer', key_hash: await sha256(writerKey), scopes: ['health:read', 'companies:read'], expires_at: '2027-01-01T00:00:00Z', rate_limit_per_minute: 73 },
    { id: 'other-integration', key_hash: await sha256(otherKey), scopes: ['health:read', 'orders:read'], expires_at: '2027-02-01T00:00:00Z', rate_limit_per_minute: 91 },
  ]);
  return { raw, credentials: parseExternalApiCredentials(raw) };
}
const headers = (token: string) => new Headers({ Authorization: `Bearer ${token}` });

test('server configuration grants only billing to the selected existing identity without mutating originals', async () => {
  const { credentials } = await fixture();
  const result = withBillingWriterScope(credentials, 'test-writer');
  assert.equal(result.length, credentials.length);
  assert.deepEqual([...result[0].scopes], ['health:read', 'companies:read', 'billing:write']);
  assert.deepEqual([...credentials[0].scopes], ['health:read', 'companies:read']);
  assert.deepEqual({ ...result[0], scopes: undefined }, { ...credentials[0], scopes: undefined });
  assert.equal(result[1], credentials[1]);
  assert.equal((await authenticateExternalApiRequest(headers(writerKey), result, 'billing:write', now)).id, 'test-writer');
  await assert.rejects(authenticateExternalApiRequest(headers(otherKey), result, 'billing:write', now), { status: 403, code: 'insufficient_scope' });
  await assert.rejects(authenticateExternalApiRequest(headers(writerKey), result, 'orders:write', now), { status: 403 });
  assert.equal((await authenticateExternalApiRequest(headers(otherKey), result, 'orders:read', now)).id, 'other-integration');
});

test('absent, unknown, malformed and multi-identity configuration grants nothing', async () => {
  const { credentials } = await fixture();
  for (const value of [undefined, '', 'missing', '*', 'test-writer,other-integration', ' test-writer ', 'TEST-WRITER']) {
    const result = withBillingWriterScope(credentials, value);
    assert.deepEqual(result, credentials);
    await assert.rejects(authenticateExternalApiRequest(headers(writerKey), result, 'billing:write', now), { status: 403 });
  }
});

test('grant does not bypass token authentication, expiry or disabled credentials', async () => {
  const { raw, credentials } = await fixture();
  const result = withBillingWriterScope(credentials, 'test-writer');
  await assert.rejects(authenticateExternalApiRequest(new Headers(), result, 'billing:write', now), { status: 401 });
  await assert.rejects(authenticateExternalApiRequest(headers('synthetic-incorrect-token-no-matching-key'), result, 'billing:write', now), { status: 401 });
  await assert.rejects(authenticateExternalApiRequest(headers(writerKey), result, 'billing:write', Date.parse('2028-01-01')), { status: 401, code: 'expired_credential' });
  const disabled = JSON.parse(raw); disabled[0].enabled = false;
  const disabledResult = withBillingWriterScope(parseExternalApiCredentials(JSON.stringify(disabled)), 'test-writer');
  assert.equal(disabledResult.length, 1);
  await assert.rejects(authenticateExternalApiRequest(headers(writerKey), disabledResult, 'billing:write', now), { status: 401 });
});

test('grant is idempotent and existing credential validation remains mandatory', async () => {
  const { raw, credentials } = await fixture();
  const once = withBillingWriterScope(credentials, 'test-writer');
  assert.deepEqual(withBillingWriterScope(once, 'test-writer'), once);
  const duplicate = JSON.parse(raw); duplicate.push(duplicate[0]);
  assert.throws(() => parseExternalApiCredentials(JSON.stringify(duplicate)), /unique/);
  assert.throws(() => parseExternalApiCredentials(undefined), /not configured/);
});

test('API takes the additional grant only from server configuration and preserves billing/pricing actions', () => {
  const source = readFileSync(new URL('../../supabase/functions/external-api/index.ts', import.meta.url), 'utf8');
  assert.match(source, /withBillingWriterScope\(\s*parseExternalApiCredentials\(Deno\.env\.get\("EXTERNAL_API_CREDENTIALS"\)\),\s*Deno\.env\.get\("EXTERNAL_API_BILLING_WRITER_CREDENTIAL_ID"\)/);
  for (const action of ['products.invoice_prices', 'billing.status', 'billing.stage', 'billing.commit']) assert.ok(source.includes(`"${action}"`));
});
