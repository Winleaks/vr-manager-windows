import assert from 'node:assert/strict'
import test from 'node:test'
import { assertSafeSupabaseClientKey } from './supabaseKeyValidation.ts'

function jwtWithRole(role: string) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ role })).toString('base64url')
  return `${header}.${payload}.test-signature`
}

test('accepts publishable and legacy anon client keys', () => {
  assert.equal(assertSafeSupabaseClientKey(`sb_publishable_${'a'.repeat(24)}`).startsWith('sb_publishable_'), true)
  assert.equal(assertSafeSupabaseClientKey(jwtWithRole('anon')), jwtWithRole('anon'))
})

test('rejects secret and service role keys', () => {
  assert.throws(() => assertSafeSupabaseClientKey(`sb_secret_${'a'.repeat(24)}`), /secret/)
  assert.throws(() => assertSafeSupabaseClientKey(jwtWithRole('service_role')), /service_role/)
})
