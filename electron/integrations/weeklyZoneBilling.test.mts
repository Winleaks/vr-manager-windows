import assert from 'node:assert/strict';
import test from 'node:test';
import { requireZoneSelection, selectReadyGroupsForZone } from './weeklyZoneBilling.ts';

const ZONE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ZONE_ID = '22222222-2222-4222-8222-222222222222';
const zone = { id: ZONE_ID, name: 'North', color: '#123456', driver: { id: '33333333-3333-4333-8333-333333333333', name: 'Driver' } };

test('zone selection accepts PostgreSQL UUIDs and the controlled unassigned value', () => {
  assert.equal(requireZoneSelection(ZONE_ID), ZONE_ID);
  assert.equal(requireZoneSelection(null), null);
  assert.throws(() => requireZoneSelection('all'), /nu este validă/);
  assert.throws(() => requireZoneSelection(undefined), /nu este validă/);
});

test('zone billing selects only ready stores from the authoritative zone snapshot', () => {
  const ready = { billingState: 'ready', store: { zone: { id: ZONE_ID } } };
  const invoiced = { billingState: 'invoiced', store: { zone: { id: ZONE_ID } } };
  const other = { billingState: 'ready', store: { zone: { id: OTHER_ZONE_ID } } };
  const result = selectReadyGroupsForZone([ready, invoiced, other], [zone], ZONE_ID);
  assert.equal(result.zone?.name, 'North');
  assert.deepEqual(result.groups, [ready]);
});

test('unassigned billing remains explicit and stale zones fail closed', () => {
  const unassigned = { billingState: 'ready', store: { zone: null } };
  assert.deepEqual(selectReadyGroupsForZone([unassigned], [zone], null).groups, [unassigned]);
  assert.throws(() => selectReadyGroupsForZone([unassigned], [zone], OTHER_ZONE_ID), /nu mai este activă/);
  assert.throws(() => selectReadyGroupsForZone([{ ...unassigned, billingState: 'invoiced' }], [zone], null), /nu mai are facturi/);
});
