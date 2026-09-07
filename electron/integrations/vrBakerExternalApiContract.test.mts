import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../supabase/functions/external-api/index.ts', import.meta.url), 'utf8');

test('weekly export includes read-only zone, driver and route metadata', () => {
  assert.match(source, /zone:zone_id\(id, name, color, active, driver_id, driver:driver_id\(id, name\)\)/);
  assert.match(source, /\.from\("zones"\)[\s\S]*\.eq\("active", true\)/);
  assert.match(source, /route_order/);
  assert.match(source, /\.in\("status", \["open", "locked"\]\)/);
  assert.doesNotMatch(source, /\.in\("status", \["open", "locked", "delivered"\]\)/);
});
