import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import {
  parseDeviceState,
  type DeviceRole,
  type DeviceState,
} from './deviceStatePolicy';

export { parseDeviceState, shouldApplyRemoteVersion } from './deviceStatePolicy';
export type { DeviceRole, DeviceState } from './deviceStatePolicy';

function getConfigPath() {
  return path.join(app.getPath('userData'), 'device-state.json');
}

export function getDeviceState(): DeviceState {
  try {
    return parseDeviceState(JSON.parse(fs.readFileSync(getConfigPath(), 'utf8')));
  } catch {
    return { role: 'viewer' };
  }
}

export function getDeviceRole(): DeviceRole {
  return getDeviceState().role;
}

export function saveDeviceState(state: DeviceState) {
  const configPath = getConfigPath();
  const tempPath = `${configPath}.tmp`;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(parseDeviceState(state), null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(tempPath, configPath);
}

export function setDeviceRole(role: DeviceRole): DeviceState {
  if (role !== 'writer' && role !== 'viewer') throw new Error('Rolul dispozitivului nu este valid.');
  const nextState: DeviceState = { ...getDeviceState(), role };
  saveDeviceState(nextState);
  return nextState;
}

export function markRemoteVersionApplied(metadata: {
  fileId: string;
  fileName?: string | null;
  version?: string | null;
  modifiedTime?: string | null;
}) {
  const state = getDeviceState();
  saveDeviceState({
    ...state,
    lastRemoteFileId: metadata.fileId,
    lastRemoteVersion: metadata.version || undefined,
    lastRemoteModifiedTime: metadata.modifiedTime || undefined,
    seenPrimaryCloudBackup: state.seenPrimaryCloudBackup || metadata.fileName === 'vr_hub_management_backup.db',
  });
}
