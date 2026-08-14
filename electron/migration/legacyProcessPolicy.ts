const LEGACY_EXECUTABLES = new Set([
  'vr - management hub.exe',
  'vr-management-hub.exe',
]);

export function containsLegacyApplicationProcess(tasklistCsv: string) {
  return tasklistCsv.split(/\r?\n/).some((line) => {
    const match = line.match(/^"([^"]+)"/);
    return Boolean(match && LEGACY_EXECUTABLES.has(match[1].toLowerCase()));
  });
}
