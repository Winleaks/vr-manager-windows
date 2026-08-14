export const PRIMARY_CLOUD_DATABASE_NAME = 'vr_hub_management_backup.db';
export const LEGACY_CLOUD_DATABASE_NAME = 'stoc_fabrica_backup.db';

export interface CloudFileCandidate {
  id?: string | null;
  name?: string | null;
  modifiedTime?: string | null;
}

export function selectPreferredCloudDatabase<T extends CloudFileCandidate>(files: T[], allowLegacy = true): T | null {
  const usable = files.filter((file) => file.id && (
    file.name === PRIMARY_CLOUD_DATABASE_NAME || (allowLegacy && file.name === LEGACY_CLOUD_DATABASE_NAME)
  ));
  const primary = usable.filter((file) => file.name === PRIMARY_CLOUD_DATABASE_NAME);
  const pool = primary.length > 0 ? primary : usable;
  return pool.sort((left, right) =>
    Date.parse(right.modifiedTime || '') - Date.parse(left.modifiedTime || ''),
  )[0] || null;
}

export function cloudDatabaseQuery() {
  return `(name='${PRIMARY_CLOUD_DATABASE_NAME}' or name='${LEGACY_CLOUD_DATABASE_NAME}') and trashed=false`;
}
