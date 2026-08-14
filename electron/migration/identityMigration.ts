import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export interface IdentityMigrationOptions {
  targetUserData: string;
  legacyUserDataDirs: string[];
  validateDatabase: (filePath: string) => void;
}

export interface IdentityMigrationResult {
  migrated: boolean;
  databaseMigrated: boolean;
  configFilesMigrated: string[];
  backupFilesMigrated: number;
  sourceName: string | null;
}

const DATABASE_RELATIVE_PATH = path.join('baze de date', 'bazadedate.db');
const CONFIG_FILES = [
  'secure-credentials.json',
  'device-state.json',
  'config_google_drive.json',
] as const;

function atomicCopy(source: string, destination: string) {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    fs.copyFileSync(source, temporary);
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, destination);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

function isValidConfigFile(filename: string, filePath: string) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    if (filename === 'secure-credentials.json') {
      return parsed.version === 1 && Boolean(parsed.values) && typeof parsed.values === 'object';
    }
    if (filename === 'device-state.json') {
      return parsed.role === 'writer' || parsed.role === 'viewer';
    }
    return true;
  } catch {
    return false;
  }
}

function writeMarker(targetUserData: string, result: IdentityMigrationResult) {
  const markerPath = path.join(targetUserData, 'identity-migration-v1.json');
  const temporary = `${markerPath}.${randomUUID()}.tmp`;
  fs.mkdirSync(targetUserData, { recursive: true });
  fs.writeFileSync(temporary, JSON.stringify({
    version: 1,
    completedAt: new Date().toISOString(),
    ...result,
  }, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, markerPath);
}

export function migrateLegacyIdentity(options: IdentityMigrationOptions): IdentityMigrationResult {
  const markerPath = path.join(options.targetUserData, 'identity-migration-v1.json');
  if (fs.existsSync(markerPath)) {
    return {
      migrated: false,
      databaseMigrated: false,
      configFilesMigrated: [],
      backupFilesMigrated: 0,
      sourceName: null,
    };
  }

  const candidates = options.legacyUserDataDirs
    .filter((directory, index, all) => all.indexOf(directory) === index)
    .filter((directory) => path.resolve(directory) !== path.resolve(options.targetUserData))
    .filter((directory) => fs.existsSync(directory));

  const targetDatabase = path.join(options.targetUserData, DATABASE_RELATIVE_PATH);
  let sourceDirectory: string | null = null;
  let databaseMigrated = false;

  if (!fs.existsSync(targetDatabase)) {
    const validDatabases = candidates.flatMap((directory) => {
      const candidate = path.join(directory, DATABASE_RELATIVE_PATH);
      if (!fs.existsSync(candidate)) return [];
      try {
        options.validateDatabase(candidate);
        return [{ directory, candidate, mtime: fs.statSync(candidate).mtimeMs }];
      } catch {
        return [];
      }
    }).sort((left, right) => right.mtime - left.mtime);

    const selected = validDatabases[0];
    if (selected) {
      atomicCopy(selected.candidate, targetDatabase);
      options.validateDatabase(targetDatabase);
      sourceDirectory = selected.directory;
      databaseMigrated = true;
    }
  }

  sourceDirectory ||= candidates.find((directory) =>
    CONFIG_FILES.some((filename) => fs.existsSync(path.join(directory, filename))),
  ) || null;

  const configFilesMigrated: string[] = [];
  let backupFilesMigrated = 0;
  if (sourceDirectory) {
    for (const filename of CONFIG_FILES) {
      const source = path.join(sourceDirectory, filename);
      const destination = path.join(options.targetUserData, filename);
      if (!fs.existsSync(destination) && fs.existsSync(source) && isValidConfigFile(filename, source)) {
        atomicCopy(source, destination);
        configFilesMigrated.push(filename);
      }
    }
    const sourceBackups = path.join(sourceDirectory, 'baze de date', 'backups');
    const targetBackups = path.join(options.targetUserData, 'baze de date', 'backups');
    if (fs.existsSync(sourceBackups)) {
      for (const filename of fs.readdirSync(sourceBackups).filter((name) => /^[A-Za-z0-9._-]+\.db$/.test(name))) {
        const source = path.join(sourceBackups, filename);
        const destination = path.join(targetBackups, filename);
        if (fs.existsSync(destination) || !fs.statSync(source).isFile()) continue;
        try {
          options.validateDatabase(source);
          atomicCopy(source, destination);
          options.validateDatabase(destination);
          backupFilesMigrated += 1;
        } catch {
          // Corrupt or incompatible legacy backups are deliberately left at the source.
        }
      }
    }
  }

  const result: IdentityMigrationResult = {
    migrated: databaseMigrated || configFilesMigrated.length > 0 || backupFilesMigrated > 0,
    databaseMigrated,
    configFilesMigrated,
    backupFilesMigrated,
    sourceName: sourceDirectory ? path.basename(sourceDirectory) : null,
  };
  writeMarker(options.targetUserData, result);
  return result;
}
