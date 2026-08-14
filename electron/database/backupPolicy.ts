export interface BackupCandidate {
  filename: string;
  createdAt: Date;
}

const SNAPSHOT_PATTERN = /^backup_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.db$/;

export function createBackupFilename(now = new Date()) {
  return `backup_${now.toISOString().replace(/[:.]/g, '-')}.db`;
}

export function parseBackupFilename(filename: string): BackupCandidate | null {
  const match = SNAPSHOT_PATTERN.exec(filename);
  if (!match) return null;

  const createdAt = new Date(match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z'));
  return Number.isNaN(createdAt.getTime()) ? null : { filename, createdAt };
}

export function selectBackupFilesToDelete(
  filenames: string[],
  now = new Date(),
  recentCount = 36,
  dailyRetentionDays = 30,
) {
  const snapshots = filenames
    .map(parseBackupFilename)
    .filter((item): item is BackupCandidate => item !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const keep = new Set(snapshots.slice(0, recentCount).map((item) => item.filename));
  const newestByUtcDay = new Map<string, BackupCandidate>();
  const cutoff = now.getTime() - dailyRetentionDays * 24 * 60 * 60 * 1000;

  for (const snapshot of snapshots) {
    if (snapshot.createdAt.getTime() < cutoff) continue;
    const day = snapshot.createdAt.toISOString().slice(0, 10);
    if (!newestByUtcDay.has(day)) newestByUtcDay.set(day, snapshot);
  }

  for (const snapshot of newestByUtcDay.values()) keep.add(snapshot.filename);
  return snapshots.filter((snapshot) => !keep.has(snapshot.filename)).map((snapshot) => snapshot.filename);
}
