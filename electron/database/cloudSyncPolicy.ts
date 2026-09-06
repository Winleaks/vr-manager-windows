export const CLOUD_ROOT_FOLDER_NAME = 'VR - Management';
export const CLOUD_DATABASE_FOLDER_NAME = 'Baza de date';
export const CLOUD_INVOICES_FOLDER_NAME = 'Facturi';
export const CLOUD_FRESHNESS_WINDOW_MS = 20 * 60 * 1000;

export type CloudSyncHealth = 'disconnected' | 'healthy' | 'stale' | 'error';

export interface UploadedFileMetadata {
  id?: string | null;
  name?: string | null;
  parents?: string[] | null;
  modifiedTime?: string | null;
  md5Checksum?: string | null;
  size?: string | null;
}

export function assertUploadedFileMatches(
  metadata: UploadedFileMetadata,
  expected: { name: string; parentId: string; md5Checksum: string; size: number },
) {
  if (!metadata.id || metadata.name !== expected.name) {
    throw new Error('Google Drive nu a confirmat identitatea fișierului încărcat.');
  }
  if (!metadata.parents?.includes(expected.parentId)) {
    throw new Error('Fișierul încărcat nu se află în folderul Google Drive configurat.');
  }
  if (!metadata.md5Checksum || metadata.md5Checksum.toLowerCase() !== expected.md5Checksum.toLowerCase()) {
    throw new Error('Checksum-ul fișierului din Google Drive nu corespunde copiei locale.');
  }
  if (!metadata.size || Number(metadata.size) !== expected.size) {
    throw new Error('Dimensiunea fișierului din Google Drive nu corespunde copiei locale.');
  }
  return {
    fileId: metadata.id,
    modifiedTime: metadata.modifiedTime || null,
    md5Checksum: metadata.md5Checksum,
    size: metadata.size,
  };
}

export function evaluateCloudSyncHealth(input: {
  hasTokens: boolean;
  apiHealthy: boolean;
  lastModifiedTime?: string | null;
  lastUploadError?: string | null;
  nowMs?: number;
}): CloudSyncHealth {
  if (!input.hasTokens) return 'disconnected';
  if (!input.apiHealthy || input.lastUploadError) return 'error';
  const modifiedMs = Date.parse(input.lastModifiedTime || '');
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(modifiedMs) || modifiedMs > nowMs + 5 * 60 * 1000) return 'stale';
  return nowMs - modifiedMs <= CLOUD_FRESHNESS_WINDOW_MS ? 'healthy' : 'stale';
}
