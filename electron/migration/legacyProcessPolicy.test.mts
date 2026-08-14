import assert from 'node:assert/strict';
import test from 'node:test';
import { containsLegacyApplicationProcess } from './legacyProcessPolicy.ts';

test('detects both legacy Windows executable identities without matching the new app', () => {
  assert.equal(containsLegacyApplicationProcess('"VR - Management Hub.exe","123","Console"'), true);
  assert.equal(containsLegacyApplicationProcess('"vr-management-hub.exe","124","Console"'), true);
  assert.equal(containsLegacyApplicationProcess('"VR - Hub Management.exe","125","Console"'), false);
});
