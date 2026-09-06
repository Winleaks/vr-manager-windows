import fs from 'fs';
import path from 'path';
import { app, shell } from 'electron';
import { dbPath, restoreDb } from './db';
import { google } from 'googleapis';
import { CodeChallengeMethod } from 'google-auth-library';
import http from 'http';
import { createHash, randomBytes } from 'crypto';
import { Readable } from 'stream';
import {
  deleteCredential,
  getCredential,
  isCredentialStorageAvailable,
  setCredential,
} from '../security/credentialStore';
import {
  getDeviceRole,
  getDeviceState,
  markRemoteVersionApplied,
  shouldApplyRemoteVersion,
} from '../device/deviceRole';
import {
  cloudDatabaseQuery,
  PRIMARY_CLOUD_DATABASE_NAME,
  selectPreferredCloudDatabase,
} from './cloudBackupSelection';
import {
  assertUploadedFileMatches,
  CLOUD_DATABASE_FOLDER_NAME,
  CLOUD_INVOICES_FOLDER_NAME,
  CLOUD_ROOT_FOLDER_NAME,
  evaluateCloudSyncHealth,
  type CloudSyncHealth,
  type UploadedFileMetadata,
} from './cloudSyncPolicy';

const isDev = !app.isPackaged;
const baseDir = isDev ? process.cwd() : app.getPath('userData');
const legacyConfigFilePath = path.join(baseDir, 'config_google_drive.json');
const GOOGLE_TOKENS_KEY = 'google-drive-oauth-tokens';

declare const __VR_HUB_GOOGLE_CLIENT_ID__: string;

const CLIENT_ID = __VR_HUB_GOOGLE_CLIENT_ID__;
const REDIRECT_URI = 'http://127.0.0.1:3456/oauth2callback';

function hasGoogleOAuthBuildConfig() {
  return Boolean(CLIENT_ID);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  undefined,
  REDIRECT_URI
);

export interface CloudSyncStatus {
  isConnected: boolean;
  connectionHealthy: boolean;
  syncHealth: CloudSyncHealth;
  userEmail: string | null;
  lastCloudBackup: string | null;
  lastCloudBackupIso: string | null;
  lastUploadAttempt: string | null;
  lastSuccessfulUpload: string | null;
  lastError: string | null;
  rootFolderName: string;
  availableBackups: Array<{
    fileId: string;
    fileName: string;
    mtime: number;
    formattedTime: string;
  }>;
}

export interface CloudSaveResult {
  success: boolean;
  uploaded?: boolean;
  skipped?: boolean;
  error?: string;
  fileId?: string;
  fileName?: string;
  modifiedTime?: string | null;
}

export interface CloudBackupMetadata {
  fileId: string;
  fileName: string;
  version?: string | null;
  modifiedTime?: string | null;
  md5Checksum?: string | null;
  size?: string | null;
}

function calculateFileMd5(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

const cloudRuntimeState: {
  lastUploadAttempt: string | null;
  lastSuccessfulUpload: string | null;
  lastError: string | null;
} = {
  lastUploadAttempt: null,
  lastSuccessfulUpload: null,
  lastError: null,
};

function publicGoogleDriveError(error: unknown, fallback: string) {
  const candidate = error as { code?: unknown; response?: { status?: unknown }; errors?: Array<{ reason?: unknown }> } | null;
  const status = Number(candidate?.response?.status || candidate?.code || 0);
  const reason = typeof candidate?.errors?.[0]?.reason === 'string' ? candidate.errors[0].reason : '';
  const message = error instanceof Error ? error.message : '';
  console.error('[GOOGLE DRIVE] Operație eșuată.', { status: status || null, reason: reason || null });
  if (status === 401 || reason === 'authError') return 'Autorizarea Google Drive a expirat. Reconectează contul din Setări.';
  if (status === 403) return 'Contul Google nu permite accesul aplicației la folderul configurat. Reconectează contul corect.';
  if (status === 429) return 'Google Drive a limitat temporar sincronizarea. Aplicația va reîncerca automat.';
  if (/^Google Drive nu a confirmat|^Fișierul încărcat nu se află|^Checksum-ul|^Dimensiunea fișierului/.test(message)) return message;
  return fallback;
}

function recordUploadFailure(error: string) {
  cloudRuntimeState.lastError = error;
  return error;
}

function recordUploadSuccess(modifiedTime?: string | null) {
  cloudRuntimeState.lastSuccessfulUpload = modifiedTime || new Date().toISOString();
  cloudRuntimeState.lastError = null;
}

function loadTokens() {
  if (!hasGoogleOAuthBuildConfig()) return false;
  const protectedTokens = getCredential(GOOGLE_TOKENS_KEY);
  if (protectedTokens) {
    try {
      oauth2Client.setCredentials(JSON.parse(protectedTokens));
      return true;
    } catch {
      return false;
    }
  }

  if (fs.existsSync(legacyConfigFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(legacyConfigFilePath, 'utf-8'));
      if (data.tokens) {
        oauth2Client.setCredentials(data.tokens);
        if (isCredentialStorageAvailable()) saveTokens(data.tokens);
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

function saveTokens(tokens: any) {
  setCredential(GOOGLE_TOKENS_KEY, JSON.stringify(tokens));
  if (fs.existsSync(legacyConfigFilePath)) fs.unlinkSync(legacyConfigFilePath);
}

oauth2Client.on('tokens', (tokens) => {
  if (!isCredentialStorageAvailable()) return;
  try {
    const stored = getCredential(GOOGLE_TOKENS_KEY);
    const previous = stored ? JSON.parse(stored) : {};
    saveTokens({ ...previous, ...oauth2Client.credentials, ...tokens });
  } catch {
    console.warn('[GOOGLE DRIVE] Tokenul reîmprospătat nu a putut fi persistat.');
  }
});

let authServer: http.Server | null = null;
let expectedOAuthState: string | null = null;

export async function connectGoogleDrive(): Promise<{ success: boolean; message?: string }> {
  if (!hasGoogleOAuthBuildConfig()) {
    return {
      success: false,
      message: 'Build-ul aplicației nu conține configurația Google Drive necesară.',
    };
  }
  if (!isCredentialStorageAvailable()) {
    return {
      success: false,
      message: 'Stocarea securizată a credentialelor nu este disponibilă pe acest sistem.',
    };
  }

  const { codeVerifier, codeChallenge } = await oauth2Client.generateCodeVerifierAsync();

  return new Promise((resolve) => {
    // If a server is already running, close it
    if (authServer) {
      authServer.close();
      authServer = null;
    }

    const scopes = [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/userinfo.email'
    ];

    expectedOAuthState = randomBytes(32).toString('base64url');

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      state: expectedOAuthState,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });

    authServer = http.createServer(async (req, res) => {
      try {
        const callbackUrl = new URL(req.url || '/', REDIRECT_URI);
        if (callbackUrl.pathname === '/oauth2callback') {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          if (!expectedOAuthState || callbackUrl.searchParams.get('state') !== expectedOAuthState) {
            res.statusCode = 400;
            res.end('Cererea de autentificare nu este validă. Reîncearcă din aplicație.');
            if (authServer) authServer.close();
            authServer = null;
            expectedOAuthState = null;
            resolve({ success: false, message: 'Validarea autentificării a eșuat.' });
            return;
          }

          const qs = callbackUrl.searchParams;
          const code = qs.get('code');
          if (code) {
            const { tokens } = await oauth2Client.getToken({ code, codeVerifier });
            oauth2Client.setCredentials(tokens);
            saveTokens(tokens);
            cloudRuntimeState.lastError = null;
            res.end('Autentificare cu succes! Poți închide această fereastră și reveni în aplicație.');
            if (authServer) authServer.close();
            authServer = null;
            expectedOAuthState = null;
            resolve({ success: true });
          } else {
            res.end('Eroare: Nu s-a primit codul de autorizare.');
            if (authServer) authServer.close();
            authServer = null;
            expectedOAuthState = null;
            resolve({ success: false, message: 'Nu s-a primit codul.' });
          }
        } else {
          res.statusCode = 404;
          res.end('Not found');
        }
      } catch {
        res.statusCode = 500;
        res.end('Autentificarea nu a putut fi finalizată.');
        if (authServer) authServer.close();
        authServer = null;
        expectedOAuthState = null;
        resolve({ success: false, message: 'Autentificarea Google Drive a eșuat.' });
      }
    });

    authServer.once('error', () => {
      if (authServer) authServer.close();
      authServer = null;
      expectedOAuthState = null;
      resolve({ success: false, message: 'Serverul local de autentificare nu a putut porni.' });
    });

    authServer.listen(3456, '127.0.0.1', () => {
      shell.openExternal(url);
      try {
        const { BrowserWindow } = require('electron');
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          windows[0].webContents.send('google-auth-url', url);
        }
      } catch (e) {}
    });

    // Timeout after 3 minutes just in case
    setTimeout(() => {
      if (authServer) {
        authServer.close();
        authServer = null;
        expectedOAuthState = null;
        resolve({ success: false, message: 'Timpul de conectare a expirat. Te rog să încerci din nou.' });
      }
    }, 3 * 60 * 1000);
  });
}

export async function disconnectCloud() {
  if (fs.existsSync(legacyConfigFilePath)) {
    fs.unlinkSync(legacyConfigFilePath);
  }
  deleteCredential(GOOGLE_TOKENS_KEY);
  oauth2Client.setCredentials({});
  cloudRuntimeState.lastUploadAttempt = null;
  cloudRuntimeState.lastSuccessfulUpload = null;
  cloudRuntimeState.lastError = null;
  return { success: true };
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findFolder(drive: any, folderName: string, parentId?: string): Promise<string | null> {
  const escapedName = escapeDriveQueryValue(folderName);
  const query = parentId
    ? `name='${escapedName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    : `name='${escapedName}' and 'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const search = await drive.files.list({
    q: query,
    orderBy: 'createdTime asc',
    pageSize: 10,
    fields: 'files(id)'
  });
  return search.data.files?.[0]?.id || null;
}

async function getOrCreateFolder(drive: any, folderName: string, parentId?: string): Promise<string> {
  const existingId = await findFolder(drive, folderName, parentId);
  if (existingId) return existingId;

  const fileMetadata: any = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder'
  };
  if (parentId) {
    fileMetadata.parents = [parentId];
  }

  const folderRes = await drive.files.create({
    requestBody: fileMetadata,
    fields: 'id'
  });

  return folderRes.data.id!;
}

async function getDriveStructure(drive: any) {
  const rootFolderId = await getOrCreateFolder(drive, CLOUD_ROOT_FOLDER_NAME);
  const facturiFolderId = await getOrCreateFolder(drive, CLOUD_INVOICES_FOLDER_NAME, rootFolderId);
  const dbFolderId = await getOrCreateFolder(drive, CLOUD_DATABASE_FOLDER_NAME, rootFolderId);
  return { rootFolderId, facturiFolderId, dbFolderId };
}

async function listCloudDatabaseFiles(drive: any, dbFolderId?: string | null) {
  const parentQuery = dbFolderId ? ` and '${dbFolderId}' in parents` : '';
  const response = await drive.files.list({
    q: `${cloudDatabaseQuery()}${parentQuery}`,
    orderBy: 'modifiedTime desc',
    pageSize: 100,
    fields: 'files(id,name,version,modifiedTime,md5Checksum,size,parents)',
  });
  return response.data.files || [];
}

export async function getCloudStatus(): Promise<CloudSyncStatus> {
  const isConnected = loadTokens();
  if (!isConnected) {
    return {
      isConnected: false,
      connectionHealthy: false,
      syncHealth: 'disconnected',
      userEmail: null,
      lastCloudBackup: null,
      lastCloudBackupIso: null,
      lastUploadAttempt: cloudRuntimeState.lastUploadAttempt,
      lastSuccessfulUpload: cloudRuntimeState.lastSuccessfulUpload,
      lastError: cloudRuntimeState.lastError,
      rootFolderName: CLOUD_ROOT_FOLDER_NAME,
      availableBackups: []
    };
  }

  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    // Get user email
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    
    const rootFolderId = await findFolder(drive, CLOUD_ROOT_FOLDER_NAME);
    const dbFolderId = rootFolderId ? await findFolder(drive, CLOUD_DATABASE_FOLDER_NAME, rootFolderId) : null;
    const files = dbFolderId ? await listCloudDatabaseFiles(drive, dbFolderId) : [];
    const preferred = selectPreferredCloudDatabase(files, true);
    const backups = files.sort((left, right) => Date.parse(right.modifiedTime || '') - Date.parse(left.modifiedTime || '')).map(f => {
      const d = new Date(f.modifiedTime as string);
      return {
        fileId: f.id as string,
        fileName: f.name as string,
        mtime: d.getTime(),
        formattedTime: d.toLocaleString('ro-RO')
      };
    });

    const lastCloudBackupIso = preferred?.modifiedTime || null;
    const syncHealth = evaluateCloudSyncHealth({
      hasTokens: true,
      apiHealthy: true,
      lastModifiedTime: lastCloudBackupIso,
      lastUploadError: cloudRuntimeState.lastError,
    });
    return {
      isConnected: true,
      connectionHealthy: true,
      syncHealth,
      userEmail: userInfo.data.email || 'Conectat',
      lastCloudBackup: lastCloudBackupIso ? new Date(lastCloudBackupIso).toLocaleString('ro-RO') : null,
      lastCloudBackupIso,
      lastUploadAttempt: cloudRuntimeState.lastUploadAttempt,
      lastSuccessfulUpload: cloudRuntimeState.lastSuccessfulUpload,
      lastError: cloudRuntimeState.lastError,
      rootFolderName: CLOUD_ROOT_FOLDER_NAME,
      availableBackups: backups
    };
  } catch (e) {
    const error = publicGoogleDriveError(e, 'Google Drive nu poate fi contactat. Verifică internetul și reconectează contul dacă problema persistă.');
    return {
      isConnected: true,
      connectionHealthy: false,
      syncHealth: 'error',
      userEmail: null,
      lastCloudBackup: null,
      lastCloudBackupIso: null,
      lastUploadAttempt: cloudRuntimeState.lastUploadAttempt,
      lastSuccessfulUpload: cloudRuntimeState.lastSuccessfulUpload,
      lastError: error,
      rootFolderName: CLOUD_ROOT_FOLDER_NAME,
      availableBackups: []
    };
  }
}

async function findFileForUpload(drive: any, filename: string, parentId: string) {
  const escapedFilename = escapeDriveQueryValue(filename);
  const inTarget = await drive.files.list({
    q: `name='${escapedFilename}' and '${parentId}' in parents and trashed=false`,
    orderBy: 'modifiedTime desc',
    pageSize: 10,
    fields: 'files(id,name,parents,modifiedTime)',
  });
  if (inTarget.data.files?.[0]?.id) return inTarget.data.files[0];

  const anywhere = await drive.files.list({
    q: `name='${escapedFilename}' and trashed=false`,
    orderBy: 'modifiedTime desc',
    pageSize: 10,
    fields: 'files(id,name,parents,modifiedTime)',
  });
  return anywhere.data.files?.[0] || null;
}

async function fetchUploadedMetadata(drive: any, fileId: string): Promise<UploadedFileMetadata> {
  const response = await drive.files.get({
    fileId,
    fields: 'id,name,parents,modifiedTime,md5Checksum,size',
  });
  return response.data;
}

async function uploadVerifiedBuffer(
  drive: any,
  input: { filename: string; parentId: string; mimeType: string; buffer: Uint8Array },
) {
  const expectedMd5 = createHash('md5').update(Buffer.from(input.buffer)).digest('hex');
  const expectedSize = input.buffer.byteLength;
  const existing = await findFileForUpload(drive, input.filename, input.parentId);
  let fileId: string;

  if (existing?.id) {
    const updateParams: any = {
      fileId: existing.id,
      media: { mimeType: input.mimeType, body: Readable.from(Buffer.from(input.buffer)) },
      fields: 'id',
    };
    if (!existing.parents?.includes(input.parentId)) {
      updateParams.addParents = input.parentId;
      if (existing.parents?.length) updateParams.removeParents = existing.parents.join(',');
    }
    const updated = await drive.files.update(updateParams);
    fileId = updated.data.id || existing.id;
  } else {
    const created = await drive.files.create({
      requestBody: { name: input.filename, parents: [input.parentId] },
      media: { mimeType: input.mimeType, body: Readable.from(Buffer.from(input.buffer)) },
      fields: 'id',
    });
    if (!created.data.id) throw new Error('Google Drive nu a confirmat crearea fișierului.');
    fileId = created.data.id;
  }

  return assertUploadedFileMatches(await fetchUploadedMetadata(drive, fileId), {
    name: input.filename,
    parentId: input.parentId,
    md5Checksum: expectedMd5,
    size: expectedSize,
  });
}

export async function saveToCloud(isAutomatic = false, snapshotPath?: string): Promise<CloudSaveResult> {
  cloudRuntimeState.lastUploadAttempt = new Date().toISOString();
  if (getDeviceRole() !== 'writer') {
    return { success: false, error: recordUploadFailure('Calculatorul Viewer nu poate publica baza de date.') };
  }
  if (!loadTokens()) {
    return { success: false, error: recordUploadFailure('Nu ești conectat la Google Drive.') };
  }

  try {
    if (!snapshotPath || path.resolve(snapshotPath) === path.resolve(dbPath)) {
      return { success: false, error: recordUploadFailure('Sincronizarea cloud necesită un snapshot verificat.') };
    }
    const { evaluateDb, verifyDatabaseFile } = require('./db');
    verifyDatabaseFile(snapshotPath);
    const localInfo = evaluateDb(snapshotPath);
    const localScore = localInfo ? localInfo.totalItems : 0;
    const localMd5 = await calculateFileMd5(snapshotPath);
    const localSize = fs.statSync(snapshotPath).size;

    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const { dbFolderId } = await getDriveStructure(drive);
    const canonicalBackups = await listCloudDatabaseFiles(drive, dbFolderId);
    const allBackups = await listCloudDatabaseFiles(drive);
    const existingPrimary = canonicalBackups.find((file: any) => file.name === PRIMARY_CLOUD_DATABASE_NAME)
      || allBackups.find((file: any) => file.name === PRIMARY_CLOUD_DATABASE_NAME)
      || null;

    if (isAutomatic && localScore <= 5 && allBackups.length > 0) {
      const error = recordUploadFailure('Salvarea automată a fost oprită: baza locală pare goală, iar în Google Drive există deja o copie.');
      console.warn('[CLOUD SYNC] Snapshotul local gol nu a înlocuit backup-ul existent.');
      return { success: false, skipped: true, error };
    }

    let fileId: string;
    if (existingPrimary?.id) {
      const updateParams: any = {
        fileId: existingPrimary.id,
        media: { mimeType: 'application/x-sqlite3', body: fs.createReadStream(snapshotPath) },
        fields: 'id',
      };
      if (!existingPrimary.parents?.includes(dbFolderId)) {
        updateParams.addParents = dbFolderId;
        if (existingPrimary.parents?.length) updateParams.removeParents = existingPrimary.parents.join(',');
      }
      const updated = await drive.files.update(updateParams);
      fileId = updated.data.id || existingPrimary.id;
    } else {
      const created = await drive.files.create({
        requestBody: { name: PRIMARY_CLOUD_DATABASE_NAME, parents: [dbFolderId] },
        media: { mimeType: 'application/x-sqlite3', body: fs.createReadStream(snapshotPath) },
        fields: 'id',
      });
      if (!created.data.id) throw new Error('Google Drive nu a confirmat crearea backup-ului.');
      fileId = created.data.id;
    }

    const verified = assertUploadedFileMatches(await fetchUploadedMetadata(drive, fileId), {
      name: PRIMARY_CLOUD_DATABASE_NAME,
      parentId: dbFolderId,
      md5Checksum: localMd5,
      size: localSize,
    });
    recordUploadSuccess(verified.modifiedTime);
    return {
      success: true,
      uploaded: true,
      fileId: verified.fileId,
      fileName: PRIMARY_CLOUD_DATABASE_NAME,
      modifiedTime: verified.modifiedTime,
    };
  } catch (error) {
    const message = recordUploadFailure(publicGoogleDriveError(error, 'Backupul nu a putut fi salvat și verificat în Google Drive.'));
    return { success: false, error: message };
  }
}

export async function restoreFromCloud(fileId?: string): Promise<{ success: boolean; error?: string }> {
  if (!loadTokens()) {
    return { success: false, error: 'Nu ești conectat la Google Drive.' };
  }

  let tempPath: string | null = null;
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    const metadata = fileId
      ? await getCloudBackupMetadata(drive, fileId)
      : await getLatestCloudBackupMetadata(drive);
    if (!metadata) return { success: false, error: 'Nu am găsit baza de date pe Google Drive.' };
    const targetFileId = metadata.fileId;

    tempPath = path.join(app.getPath('temp'), `temp_restore_${randomBytes(16).toString('hex')}.db`);
    const dest = fs.createWriteStream(tempPath);
    
    const res = await drive.files.get(
      { fileId: targetFileId, alt: 'media' },
      { responseType: 'stream' }
    );

    await new Promise((resolve, reject) => {
      dest.on('finish', () => resolve(true));
      dest.on('error', (err: any) => reject(err));
      res.data.on('error', (err: any) => reject(err));
      res.data.pipe(dest);
    });

    if (metadata.md5Checksum) {
      const downloadedChecksum = await calculateFileMd5(tempPath);
      if (downloadedChecksum !== metadata.md5Checksum) {
        return { success: false, error: 'Fișierul descărcat nu corespunde versiunii verificate din Google Drive.' };
      }
    }

    const ok = await restoreDb(tempPath);
    if (!ok) {
      return { success: false, error: 'Eroare la restaurarea bazei de date.' };
    }
    if (getDeviceRole() === 'viewer') markRemoteVersionApplied(metadata);
    
    return { success: true };
  } catch (e: any) {
    console.error('Restore error:', e);
    return { success: false, error: 'Restaurarea din Google Drive nu a putut fi finalizată.' };
  } finally {
    try { if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
  }
}

async function getCloudBackupMetadata(drive: any, fileId: string): Promise<CloudBackupMetadata | null> {
  try {
    const response = await drive.files.get({
      fileId,
      fields: 'id,name,version,modifiedTime,md5Checksum,size,trashed',
    });
    const file = response.data;
    if (!file.id || file.trashed) return null;
    return {
      fileId: file.id,
      fileName: file.name || PRIMARY_CLOUD_DATABASE_NAME,
      version: file.version,
      modifiedTime: file.modifiedTime,
      md5Checksum: file.md5Checksum,
      size: file.size,
    };
  } catch {
    return null;
  }
}

async function getLatestCloudBackupMetadata(drive?: any): Promise<CloudBackupMetadata | null> {
  const client = drive || google.drive({ version: 'v3', auth: oauth2Client });
  const rootFolderId = await findFolder(client, CLOUD_ROOT_FOLDER_NAME);
  const dbFolderId = rootFolderId ? await findFolder(client, CLOUD_DATABASE_FOLDER_NAME, rootFolderId) : null;
  if (!dbFolderId) return null;
  const files = await listCloudDatabaseFiles(client, dbFolderId);
  const file = selectPreferredCloudDatabase(
    files,
    !getDeviceState().seenPrimaryCloudBackup,
  );
  if (!file?.id) return null;
  return {
    fileId: file.id,
    fileName: file.name || PRIMARY_CLOUD_DATABASE_NAME,
    version: file.version,
    modifiedTime: file.modifiedTime,
    md5Checksum: file.md5Checksum,
    size: file.size,
  };
}

let viewerSyncInFlight: Promise<{
  success: boolean;
  updated: boolean;
  error?: string;
  modifiedTime?: string | null;
}> | null = null;

export function syncViewerFromCloud() {
  if (viewerSyncInFlight) return viewerSyncInFlight;
  viewerSyncInFlight = (async () => {
    if (getDeviceRole() !== 'viewer') return { success: true, updated: false };
    if (!loadTokens()) return { success: false, updated: false, error: 'Google Drive nu este conectat.' };

    try {
      const metadata = await getLatestCloudBackupMetadata();
      if (!metadata) {
        return { success: false, updated: false, error: 'Nu am găsit baza de date pe Google Drive.' };
      }
      if (!shouldApplyRemoteVersion(getDeviceState(), metadata)) {
        return { success: true, updated: false, modifiedTime: metadata.modifiedTime };
      }

      const result = await restoreFromCloud(metadata.fileId);
      return {
        ...result,
        updated: result.success,
        modifiedTime: metadata.modifiedTime,
      };
    } catch (error) {
      console.error('Viewer sync error:', error);
      return { success: false, updated: false, error: 'Actualizarea Viewer din Google Drive a eșuat.' };
    }
  })().finally(() => {
    viewerSyncInFlight = null;
  });
  return viewerSyncInFlight;
}

export async function uploadPdfToCloud(filename: string, buffer: Uint8Array): Promise<{ success: boolean; error?: string }> {
  if (getDeviceRole() !== 'writer') {
    return { success: false, error: 'Calculatorul Viewer nu poate publica documente.' };
  }
  if (!loadTokens()) {
    return { success: false, error: 'Nu ești conectat la Google Drive.' };
  }
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const { facturiFolderId } = await getDriveStructure(drive);
    await uploadVerifiedBuffer(drive, { filename, parentId: facturiFolderId, mimeType: 'application/pdf', buffer });
    return { success: true };
  } catch (error) {
    return { success: false, error: publicGoogleDriveError(error, 'Factura nu a putut fi salvată și verificată în Google Drive.') };
  }
}

export async function uploadCreditNotePdfToCloud(filename: string, issuerCode: string, buffer: Uint8Array): Promise<{ success: boolean; error?: string }> {
  if (getDeviceRole() !== 'writer') return { success: false, error: 'Calculatorul Viewer nu poate publica documente.' };
  if (!loadTokens()) return { success: false, error: 'Nu ești conectat la Google Drive.' };
  if (!/^Credit_Note_[A-Z0-9-]{1,60}\.pdf$/i.test(filename) || !/^[a-z0-9-]{1,40}$/i.test(issuerCode)) {
    return { success: false, error: 'Numele documentului Credit Note nu este valid.' };
  }
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const { rootFolderId } = await getDriveStructure(drive);
    const creditNotesFolderId = await getOrCreateFolder(drive, 'Credit Notes', rootFolderId);
    const issuerFolderId = await getOrCreateFolder(drive, issuerCode.toLowerCase(), creditNotesFolderId);
    await uploadVerifiedBuffer(drive, { filename, parentId: issuerFolderId, mimeType: 'application/pdf', buffer });
    return { success: true };
  } catch (error) {
    return { success: false, error: publicGoogleDriveError(error, 'Credit Note-ul nu a putut fi salvat și verificat în Google Drive.') };
  }
}

export async function downloadCreditNotePdfFromCloud(filename: string, issuerCode: string): Promise<{ success: boolean; buffer?: Uint8Array; error?: string }> {
  if (!loadTokens()) return { success: false, error: 'Google Drive nu este conectat pe acest calculator.' };
  if (!/^Credit_Note_[A-Z0-9-]{1,60}\.pdf$/i.test(filename) || !/^[a-z0-9-]{1,40}$/i.test(issuerCode)) return { success: false, error: 'Identitatea documentului Credit Note nu este validă.' };
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const rootFolderId = await findFolder(drive, CLOUD_ROOT_FOLDER_NAME);
    const creditNotesFolderId = rootFolderId ? await findFolder(drive, 'Credit Notes', rootFolderId) : null;
    const issuerFolderId = creditNotesFolderId ? await findFolder(drive, issuerCode.toLowerCase(), creditNotesFolderId) : null;
    if (!issuerFolderId) return { success: false, error: 'Folderul Credit Notes al emitentului nu a fost găsit în Google Drive.' };
    const escapedFilename = filename.replace(/'/g, "\\'");
    const search = await drive.files.list({
      q: `name='${escapedFilename}' and mimeType='application/pdf' and '${issuerFolderId}' in parents and trashed=false`,
      fields: 'files(id,size,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 2,
    });
    const file = search.data.files?.[0];
    if (!file?.id) return { success: false, error: 'PDF-ul Credit Note nu a fost găsit în Google Drive.' };
    if (Number(file.size || 0) > 15 * 1024 * 1024) return { success: false, error: 'PDF-ul din Google Drive depășește limita permisă.' };
    const response = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' });
    return { success: true, buffer: new Uint8Array(response.data as ArrayBuffer) };
  } catch (error) {
    return { success: false, error: publicGoogleDriveError(error, 'Descărcarea Credit Note-ului a eșuat.') };
  }
}

export async function deletePdfFromCloud(filename: string): Promise<{ success: boolean; error?: string }> {
  if (getDeviceRole() !== 'writer') {
    return { success: false, error: 'Calculatorul Viewer nu poate șterge documente.' };
  }
  if (!loadTokens()) {
    return { success: false, error: 'Nu ești conectat la Google Drive.' };
  }
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const { facturiFolderId } = await getDriveStructure(drive);

    let fileSearch = await drive.files.list({
      q: `name='${filename}' and '${facturiFolderId}' in parents and trashed=false`,
      fields: 'files(id)'
    });

    if (!fileSearch.data.files || fileSearch.data.files.length === 0) {
      fileSearch = await drive.files.list({
        q: `name='${filename}' and trashed=false`,
        fields: 'files(id)'
      });
    }

    if (fileSearch.data.files && fileSearch.data.files.length > 0) {
      for (const file of fileSearch.data.files) {
        if (file.id) {
          await drive.files.delete({ fileId: file.id });
        }
      }
    }
    return { success: true };
  } catch (e: any) {
    console.error('Delete PDF from cloud error:', e);
    return { success: false, error: e.message };
  }
}
