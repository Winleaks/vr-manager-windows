export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface PublicUpdateInfo {
  version: string;
  releaseName: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
}

export interface PublicUpdateState {
  status: UpdateStatus;
  currentVersion: string;
  updateInfo: PublicUpdateInfo | null;
  progress: number;
  error: string | null;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function releaseNotesToText(value: unknown) {
  if (typeof value === 'string') return optionalString(value);
  if (!Array.isArray(value)) return null;
  const notes = value
    .map((entry) => optionalString((entry as { note?: unknown } | null)?.note))
    .filter((note): note is string => Boolean(note));
  return notes.length ? notes.join('\n\n') : null;
}

export function sanitizeUpdateInfo(value: unknown): PublicUpdateInfo | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const version = optionalString(input.version);
  if (!version) return null;
  return {
    version,
    releaseName: optionalString(input.releaseName),
    releaseNotes: releaseNotesToText(input.releaseNotes),
    releaseDate: optionalString(input.releaseDate),
  };
}

export function createUpdateStateStore(currentVersion: string) {
  let state: PublicUpdateState = {
    status: 'idle',
    currentVersion,
    updateInfo: null,
    progress: 0,
    error: null,
  };

  const snapshot = () => ({ ...state, updateInfo: state.updateInfo ? { ...state.updateInfo } : null });
  const set = (patch: Partial<PublicUpdateState>) => {
    state = { ...state, ...patch };
    return snapshot();
  };

  return {
    snapshot,
    checking: () => set({ status: 'checking', error: null }),
    notAvailable: () => set({ status: 'not-available', updateInfo: null, progress: 0, error: null }),
    available: (info: unknown) => set({
      status: 'available',
      updateInfo: sanitizeUpdateInfo(info),
      progress: 0,
      error: null,
    }),
    downloading: (percent: unknown) => {
      const numericPercent = typeof percent === 'number' && Number.isFinite(percent) ? percent : 0;
      return set({ status: 'downloading', progress: Math.max(0, Math.min(100, Math.round(numericPercent))), error: null });
    },
    downloaded: (info?: unknown) => set({
      status: 'downloaded',
      updateInfo: sanitizeUpdateInfo(info) || state.updateInfo,
      progress: 100,
      error: null,
    }),
    failed: () => set({
      status: 'error',
      error: 'Actualizarea nu a putut fi finalizată. Încearcă din nou.',
    }),
  };
}
