export type DeviceRole = 'writer' | 'viewer';

export interface DeviceState {
  role: DeviceRole;
  lastRemoteFileId?: string;
  lastRemoteVersion?: string;
  lastRemoteModifiedTime?: string;
  seenPrimaryCloudBackup?: boolean;
}

const DEFAULT_STATE: DeviceState = { role: 'viewer' };

export function parseDeviceState(value: unknown): DeviceState {
  if (!value || typeof value !== 'object') return { ...DEFAULT_STATE };
  const input = value as Record<string, unknown>;
  const role: DeviceRole = input.role === 'writer' ? 'writer' : 'viewer';
  const state: DeviceState = { role };

  if (typeof input.lastRemoteFileId === 'string') state.lastRemoteFileId = input.lastRemoteFileId;
  if (typeof input.lastRemoteVersion === 'string') state.lastRemoteVersion = input.lastRemoteVersion;
  if (typeof input.lastRemoteModifiedTime === 'string') {
    state.lastRemoteModifiedTime = input.lastRemoteModifiedTime;
  }
  if (input.seenPrimaryCloudBackup === true) state.seenPrimaryCloudBackup = true;
  return state;
}

export function shouldApplyRemoteVersion(
  state: DeviceState,
  remote: { fileId: string; version?: string | null; modifiedTime?: string | null },
) {
  if (state.lastRemoteFileId !== remote.fileId) return true;
  if (remote.version) return state.lastRemoteVersion !== remote.version;
  return state.lastRemoteModifiedTime !== (remote.modifiedTime || undefined);
}
