import type { VrBakerZone } from './vrBakerApiClient.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ZoneBillingGroup {
  billingState: string;
  store: { zone: { id: string } | null };
}

export function requireZoneSelection(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error('Zona selectată nu este validă.');
  }
  return value;
}

export function selectReadyGroupsForZone<T extends ZoneBillingGroup>(
  groups: T[],
  zones: VrBakerZone[],
  zoneIdInput: unknown,
) {
  const zoneId = requireZoneSelection(zoneIdInput);
  const zone = zoneId === null ? null : zones.find((item) => item.id === zoneId);
  if (zoneId !== null && !zone) {
    throw new Error('Zona selectată nu mai este activă sau nu există. Sincronizează din nou comenzile.');
  }
  const selected = groups.filter((group) =>
    (group.store.zone?.id ?? null) === zoneId && group.billingState === 'ready'
  );
  if (selected.length === 0) {
    throw new Error('Zona selectată nu mai are facturi pregătite pentru emitere.');
  }
  return { zone, groups: selected };
}
