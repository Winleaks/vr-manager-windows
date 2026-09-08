import {resolveExistingInvoiceFolder,resolveCompanyInvoiceFolder,listInvoiceTree,legacyInvoiceFilenames} from '../integrations/invoiceDriveFolder';
import { InvoiceDriveDocumentError, updateInvoiceDriveDocument, withInvoiceDriveLock } from '../integrations/invoiceDriveDocument';
import { syncSingleInvoicePdf, trashConfirmedInvoiceCopy, type InvoicePdfCopy } from '../integrations/singleInvoiceDriveDocument';
import { trackDocumentUpload } from './documentSyncQueue';
import { documentSyncFailure } from '../integrations/documentSyncErrors';
import { withDriveFolderLock } from '../integrations/driveFolderLock';
import fs from 'fs';
import path from 'path';
import { app, shell } from 'electron';
import { db, dbPath, restoreDb } from './db';
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
  CLOUD_ROOT_FOLDER_NAME,
  evaluateCloudSyncHealth,
  type CloudSyncHealth,
  type UploadedFileMetadata,
} from './cloudSyncPolicy';
import {
  normalCloudDocumentFolders,
  type ClientFinancialDocumentKind,
} from '../reports/clientDocumentStorage';

const isDev = !app.isPackaged;
const baseDir = isDev ? process.cwd() : app.getPath('userData');
const legacyConfigFilePath = path.join(baseDir, 'config_google_drive.json');
const GOOGLE_TOKENS_KEY = 'google-drive-oauth-tokens';
const documentRequestOptions = { timeout: 30_000, retry: false };

declare const __VR_HUB_GOOGLE_CLIENT_ID__: string;
declare const __VR_HUB_GOOGLE_CLIENT_SECRET__: string;

const CLIENT_ID = __VR_HUB_GOOGLE_CLIENT_ID__;
const CLIENT_SECRET = __VR_HUB_GOOGLE_CLIENT_SECRET__;
function hasGoogleOAuthBuildConfig() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
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

export interface VerifiedCloudBuffer {
  fileId: string;
  fileName: string;
  version: string | null;
  modifiedTime: string | null;
  md5Checksum: string | null;
  buffer: Uint8Array;
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
  const candidate = error as {
    code?: unknown;
    response?: { status?: unknown; data?: { error?: unknown; error_description?: unknown } };
    errors?: Array<{ reason?: unknown }>;
  } | null;
  const status = Number(candidate?.response?.status || candidate?.code || 0);
  const reason = typeof candidate?.errors?.[0]?.reason === 'string' ? candidate.errors[0].reason : '';
  const message = error instanceof Error ? error.message : '';
  const oauthError = typeof candidate?.response?.data?.error === 'string' ? candidate.response.data.error : '';
  console.error('[GOOGLE DRIVE] Operație eșuată.', { status: status || null, reason: reason || null });
  if (status === 401 || reason === 'authError' || oauthError === 'invalid_grant' || oauthError === 'invalid_token' || /invalid_grant|invalid_token|no refresh token/i.test(message)) {
    return 'Autorizarea Google Drive a expirat sau a fost revocată. Reconectează contul din Setări.';
  }
  if (status === 403) return 'Contul Google nu permite accesul aplicației la folderul configurat. Reconectează contul corect.';
  if (status === 429) return 'Google Drive a limitat temporar sincronizarea. Aplicația va reîncerca automat.';
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|network|socket hang up/i.test(message)) return 'Google Drive nu poate fi contactat. Verifică internetul și încearcă din nou.';
  if (/^Google Drive nu a confirmat|^Fișierul încărcat nu se află|^Checksum-ul|^Dimensiunea fișierului/.test(message)) return message;
  return fallback;
}

function publicGoogleOAuthError(error: unknown) {
  const candidate = error as {
    code?: unknown;
    response?: { status?: unknown; data?: { error?: unknown; error_description?: unknown } };
  } | null;
  const oauthError = typeof candidate?.response?.data?.error === 'string' ? candidate.response.data.error : '';
  const description = typeof candidate?.response?.data?.error_description === 'string' ? candidate.response.data.error_description : '';
  const message = error instanceof Error ? error.message : '';
  const details = `${oauthError} ${description} ${message}`;
  console.error('[GOOGLE DRIVE] Autentificarea OAuth a eșuat.', {
    status: Number(candidate?.response?.status || candidate?.code || 0) || null,
    oauthError: oauthError || null,
  });
  if (/client_secret|unauthorized_client|invalid_client/i.test(details)) {
    return 'Configurația OAuth Google Drive inclusă în această versiune este incompletă sau nu corespunde clientului Desktop. Actualizează aplicația la cea mai nouă versiune.';
  }
  if (/redirect_uri_mismatch/i.test(details)) return 'Adresa locală de revenire Google Drive nu este acceptată de configurația OAuth.';
  if (/access_denied/i.test(details)) return 'Autorizarea Google Drive a fost anulată sau refuzată.';
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|network|socket hang up/i.test(details)) return 'Google nu poate fi contactat. Verifică internetul și încearcă din nou.';
  return 'Autentificarea Google Drive nu a putut fi finalizată. Verifică configurația OAuth și încearcă din nou.';
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
let authAttemptInProgress = false;

async function closeAuthServer() {
  const server = authServer;
  authServer = null;
  if (!server?.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

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
  if (authAttemptInProgress) {
    return { success: false, message: 'O conectare Google Drive este deja în curs. Finalizeaz-o în fereastra deschisă.' };
  }

  authAttemptInProgress = true;
  try {
    await closeAuthServer();
    oauth2Client.setCredentials({});

    return await new Promise((resolve) => {
      const scopes = [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/userinfo.email'
      ];
      const oauthState = randomBytes(32).toString('base64url');
      let authorizationClient: InstanceType<typeof google.auth.OAuth2> | null = null;
      let codeVerifier = '';
      let callbackBaseUrl = '';
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const finish = (result: { success: boolean; message?: string }) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        const server = authServer;
        authServer = null;
        if (server?.listening) server.close();
        resolve(result);
      };

      authServer = http.createServer(async (req, res) => {
        try {
          if (!callbackBaseUrl || !authorizationClient || !codeVerifier) throw new Error('Fluxul OAuth local nu este inițializat.');
          const callbackUrl = new URL(req.url || '/', callbackBaseUrl);
          if (callbackUrl.pathname === '/oauth2callback') {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            if (callbackUrl.searchParams.get('state') !== oauthState) {
              res.statusCode = 400;
              res.end('Cererea de autentificare nu este validă. Reîncearcă din aplicație.');
              finish({ success: false, message: 'Validarea autentificării a eșuat. Pornește o singură reconectare și finalizeaz-o în aceeași fereastră.' });
              return;
            }

            const qs = callbackUrl.searchParams;
            const providerError = qs.get('error');
            if (providerError) {
              res.statusCode = 400;
              res.end('Autorizarea Google Drive a fost anulată sau refuzată. Poți închide această fereastră.');
              finish({ success: false, message: providerError === 'access_denied' ? 'Autorizarea Google Drive a fost anulată sau refuzată.' : 'Google nu a aprobat autentificarea.' });
              return;
            }
            const code = qs.get('code');
            if (code) {
              const { tokens } = await authorizationClient.getToken({ code, codeVerifier });
              oauth2Client.setCredentials(tokens);
              await google.drive({ version: 'v3', auth: oauth2Client }).files.list({ pageSize: 1, fields: 'files(id)' });
              saveTokens(tokens);
              cloudRuntimeState.lastError = null;
              res.end('Autentificare cu succes! Poți închide această fereastră și reveni în aplicație.');
              finish({ success: true });
            } else {
              res.statusCode = 400;
              res.end('Eroare: Nu s-a primit codul de autorizare. Poți închide această fereastră.');
              finish({ success: false, message: 'Google nu a transmis codul de autorizare.' });
            }
          } else {
            res.statusCode = 404;
            res.end('Not found');
          }
        } catch (error) {
          oauth2Client.setCredentials({});
          res.statusCode = 500;
          res.end('Autentificarea Google Drive nu a putut fi finalizată. Revino în aplicație pentru detalii.');
          finish({ success: false, message: publicGoogleOAuthError(error) });
        }
      });

      authServer.once('error', (error) => {
        console.error('[GOOGLE DRIVE] Serverul OAuth local nu a putut porni.', { code: (error as NodeJS.ErrnoException).code || null });
        finish({ success: false, message: 'Serverul local de autentificare nu a putut porni.' });
      });

      authServer.listen(0, '127.0.0.1', async () => {
        try {
          const address = authServer?.address();
          if (!address || typeof address === 'string') throw new Error('Portul local OAuth nu a putut fi rezervat.');
          callbackBaseUrl = `http://127.0.0.1:${address.port}`;
          const redirectUri = `${callbackBaseUrl}/oauth2callback`;
          authorizationClient = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, redirectUri);
          const challenge = await authorizationClient.generateCodeVerifierAsync();
          codeVerifier = challenge.codeVerifier;
          const url = authorizationClient.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'consent',
            state: oauthState,
            code_challenge: challenge.codeChallenge,
            code_challenge_method: CodeChallengeMethod.S256,
          });
          await shell.openExternal(url);
          try {
            const { BrowserWindow } = require('electron');
            const windows = BrowserWindow.getAllWindows();
            if (windows.length > 0) windows[0].webContents.send('google-auth-url', url);
          } catch {}
        } catch (error) {
          console.error('[GOOGLE DRIVE] Browserul pentru OAuth nu a putut fi deschis.', { message: error instanceof Error ? error.message : null });
          finish({ success: false, message: 'Pagina Google Drive nu a putut fi deschisă în browser.' });
        }
      });

      timeout = setTimeout(() => {
        finish({ success: false, message: 'Timpul de conectare a expirat. Te rog să încerci din nou.' });
      }, 3 * 60 * 1000);
    });
  } finally {
    authAttemptInProgress = false;
  }
}

export async function disconnectCloud() {
  await closeAuthServer();
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
  }, documentRequestOptions);
  return search.data.files?.[0]?.id || null;
}

async function getOrCreateFolder(drive: any, folderName: string, parentId?: string, assertCurrent?: () => void): Promise<string> {
  return withDriveFolderLock(parentId || 'root',folderName,async()=>{
  const existingId = await findFolder(drive, folderName, parentId);
  assertCurrent?.();
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
  }, documentRequestOptions);

  return folderRes.data.id!;
  });
}

async function getDriveStructure(drive: any) {
  const rootFolderId = await getOrCreateFolder(drive, CLOUD_ROOT_FOLDER_NAME);
  const dbFolderId = await getOrCreateFolder(drive, CLOUD_DATABASE_FOLDER_NAME, rootFolderId);
  return { rootFolderId, dbFolderId };
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
    let userEmail: string | null = null;
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      userEmail = userInfo.data.email || null;
    } catch {
      // File access is the authoritative health check. Email is only decorative.
    }

    return {
      isConnected: true,
      connectionHealthy: true,
      syncHealth,
      userEmail,
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
  }, documentRequestOptions);
  return response.data;
}

async function uploadVerifiedBuffer(
  drive: any,
  input: { filename: string; parentId: string; mimeType: string; buffer: Uint8Array; strictParent?: boolean },
) {
  const expectedMd5 = createHash('md5').update(Buffer.from(input.buffer)).digest('hex');
  const expectedSize = input.buffer.byteLength;
  const existing = input.strictParent
    ? await findExactCloudFile(drive, input.parentId, input.filename)
    : await findFileForUpload(drive, input.filename, input.parentId);
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

function validatePrivateCloudPath(folderNames: string[], filename: string) {
  if (!Array.isArray(folderNames) || folderNames.length === 0 || folderNames.length > 6) {
    throw new Error('Calea Google Drive este invalidă.');
  }
  for (const segment of folderNames) {
    if (
      typeof segment !== 'string'
      || segment.length < 1
      || segment.length > 60
      || segment !== segment.normalize('NFC').trim()
      || /[<>:"/\\|?*\p{Cc}]/u.test(segment)
      || segment === '.'
      || segment === '..'
    ) {
      throw new Error('Calea Google Drive conține un folder invalid.');
    }
  }
  if (typeof filename !== 'string' || !/^[A-Za-z0-9._-]{1,120}$/.test(filename) || filename.startsWith('.')) {
    throw new Error('Numele fișierului Google Drive este invalid.');
  }
}

async function resolvePrivateCloudFolder(drive: any, folderNames: string[], create: boolean, assertCurrent?: () => void) {
  const rootFolderId = create
    ? await getOrCreateFolder(drive, CLOUD_ROOT_FOLDER_NAME, undefined, assertCurrent)
    : await findFolder(drive, CLOUD_ROOT_FOLDER_NAME);
  if (!rootFolderId) return null;
  let parentId = rootFolderId;
  for (const folderName of folderNames) {
    const next = create
      ? await getOrCreateFolder(drive, folderName, parentId, assertCurrent)
      : await findFolder(drive, folderName, parentId);
    if (!next) return null;
    parentId = next;
  }
  return parentId;
}

async function findExactCloudFile(drive: any, parentId: string, filename: string) {
  const response = await drive.files.list({
    q: `name='${escapeDriveQueryValue(filename)}' and '${parentId}' in parents and trashed=false`,
    orderBy: 'modifiedTime desc',
    pageSize: 2,
    fields: 'files(id,name,version,modifiedTime,md5Checksum,size,parents),nextPageToken',
  });
  if ((response.data.files?.length || 0) > 1 || response.data.nextPageToken) throw new InvoiceDriveDocumentError('Există mai multe PDF-uri sau fișiere cu același nume în folderul Drive. Rezolvă duplicatele înainte de încărcare.');
  return response.data.files?.[0] || null;
}

/**
 * Writer-only primitive used by the encrypted parallel register. It never searches
 * outside the canonical VR - Management folder and verifies Drive's checksum.
 */
export async function readVerifiedPrivateCloudFile(folderNames: string[], filename: string): Promise<VerifiedCloudBuffer | null> {
  if (getDeviceRole() !== 'writer') throw new Error('Calculatorul Viewer nu poate accesa registrul separat.');
  if (!loadTokens()) throw new Error('Google Drive nu este conectat.');
  validatePrivateCloudPath(folderNames, filename);
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const parentId = await resolvePrivateCloudFolder(drive, folderNames, false);
    if (!parentId) return null;
    const file = await findExactCloudFile(drive, parentId, filename);
    if (!file?.id) return null;
    const size = Number(file.size || 0);
    if (!Number.isSafeInteger(size) || size < 0 || size > 30 * 1024 * 1024) throw new Error('Fișierul registrului depășește limita permisă.');
    const response = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data as ArrayBuffer);
    if (buffer.length !== size) throw new Error('Dimensiunea fișierului descărcat nu corespunde metadatelor Drive.');
    const checksum = createHash('md5').update(buffer).digest('hex');
    if (file.md5Checksum && checksum !== file.md5Checksum) throw new Error('Checksum-ul fișierului descărcat nu corespunde versiunii Drive.');
    return {
      fileId: file.id,
      fileName: file.name || filename,
      version: file.version || null,
      modifiedTime: file.modifiedTime || null,
      md5Checksum: file.md5Checksum || checksum,
      buffer: new Uint8Array(buffer),
    };
  } catch (error) {
    throw new Error(publicGoogleDriveError(error, 'Fișierul registrului nu a putut fi citit și verificat din Google Drive.'));
  }
}

export async function writeVerifiedPrivateCloudFile(input: {
  folderNames: string[];
  filename: string;
  mimeType: string;
  buffer: Uint8Array;
  expectedVersion?: string | null;
}) {
  if (getDeviceRole() !== 'writer') throw new Error('Calculatorul Viewer nu poate publica registrul separat.');
  if (!loadTokens()) throw new Error('Google Drive nu este conectat.');
  validatePrivateCloudPath(input.folderNames, input.filename);
  if (!/^[-\w.+/;= ]{3,100}$/.test(input.mimeType)) throw new Error('Tipul fișierului este invalid.');
  if (input.buffer.byteLength > 30 * 1024 * 1024) throw new Error('Fișierul depășește limita permisă.');
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const parentId = await resolvePrivateCloudFolder(drive, input.folderNames, true);
    if (!parentId) throw new Error('Folderul Google Drive nu a putut fi creat.');
    const existing = await findExactCloudFile(drive, parentId, input.filename);
    const currentVersion = existing?.version || null;
    if (input.expectedVersion !== undefined && currentVersion !== input.expectedVersion) {
      throw new Error('Registrul a fost modificat în Google Drive de o altă operație. Reîncarcă înainte de a continua.');
    }
    return await uploadVerifiedBuffer(drive, {
      filename: input.filename,
      parentId,
      mimeType: input.mimeType,
      buffer: input.buffer,
      strictParent: true,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : '';
    if (details.startsWith('Registrul a fost modificat')) throw error;
    throw new Error(publicGoogleDriveError(error, 'Fișierul registrului nu a putut fi încărcat și verificat în Google Drive.'));
  }
}

export async function deletePrivateCloudFile(folderNames: string[], filename: string) {
  if (getDeviceRole() !== 'writer') throw new Error('Calculatorul Viewer nu poate modifica registrul separat.');
  if (!loadTokens()) throw new Error('Google Drive nu este conectat.');
  validatePrivateCloudPath(folderNames, filename);
  const drive = google.drive({ version: 'v3', auth: oauth2Client });
  const parentId = await resolvePrivateCloudFolder(drive, folderNames, false);
  if (!parentId) return false;
  const file = await findExactCloudFile(drive, parentId, filename);
  if (!file?.id) return false;
  await drive.files.delete({ fileId: file.id });
  return true;
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

export function isDocumentDriveConnected() { return loadTokens(); }

export async function uploadInvoicePdf(invoiceId: number): Promise<{success:boolean; fileId?:string; error?:string; retryable?:boolean}> {
  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) throw new Error('Factura este invalidă.');
  const connection = db;
  return withInvoiceDriveLock(invoiceId, () => trackDocumentUpload(connection,'invoice',invoiceId,
    () => getDeviceRole() === 'writer' && connection === db && connection.open,
    () => uploadCurrentInvoicePdf(invoiceId)));
}

async function uploadCurrentInvoicePdf(invoiceId: number): Promise<{success:boolean; fileId?:string; error?:string; retryable?:boolean}> {
  if (getDeviceRole() !== 'writer') return {success:false,error:'Doar Writer poate publica PDF-uri.'};
  if (!loadTokens()) return {success:false,error:'Google Drive nu este conectat.'};
  const connection = db;
  try {
    const {getInvoiceById,getAppSetting} = await import('./repositories/billingRepo');
    const {generateInvoicePDF} = await import('../../src/utils/pdfGenerator');
    const inv=getInvoiceById(invoiceId);
    if(inv.status==='cancelled' || !inv.issuer_settings) throw new Error('Factura nu poate fi publicată.');
    const ownerSql='SELECT s.id AS store_id,s.company_id,c.supabase_company_id AS external_company_id FROM invoices i JOIN stores s ON s.id=i.store_id JOIN companies c ON c.id=s.company_id WHERE i.id=?';
    const owner=db.prepare(ownerSql).get(invoiceId) as {store_id:number;company_id:number;external_company_id:string|null};
    const identity=db.prepare('SELECT * FROM invoice_drive_identity WHERE invoice_id=?').get(invoiceId) as {file_id:string|null;store_id:number;company_id:number;external_company_id:string|null;cleanup:string}|undefined;
    if(identity && (identity.store_id!==owner.store_id||identity.company_id!==owner.company_id||identity.external_company_id!==owner.external_company_id)) {
      throw new InvoiceDriveDocumentError('Asocierea companiei facturii s-a schimbat. Verifică legătura din platformă înainte de a actualiza PDF-ul existent.');
    }
    const assertCurrent = () => {
      if (getDeviceRole() !== 'writer' || connection !== db || !connection.open) throw new InvoiceDriveDocumentError('Calculatorul Writer sau baza de date s-a schimbat.');
      const current = db.prepare('SELECT document_revision,status FROM invoices WHERE id=?').get(invoiceId) as {document_revision:number;status:string}|undefined;
      if (!current || current.status === 'cancelled' || current.document_revision !== inv.document_revision || JSON.stringify(db.prepare(ownerSql).get(invoiceId))!==JSON.stringify(owner)) {
        throw new InvoiceDriveDocumentError('Factura s-a modificat în timpul încărcării. Reîncearcă pentru versiunea curentă.');
      }
    };
    const {source_id} = db.prepare('SELECT source_id FROM billing_publication_identity WHERE id=1').get() as {source_id:string};
    const buffer=generateInvoicePDF({...inv.issuer_settings,invoiceLogo:getAppSetting('invoice_logo')||''},{
      invoiceNumber:inv.invoice_number,invoiceDate:inv.invoice_date,
      client:{name:inv.company_name,cui:inv.company_cui,regCom:inv.company_reg_com,address:inv.company_address||inv.store_address},
      store:{name:inv.store_name,address:inv.store_address,postcode:inv.store_postcode,phone:inv.store_phone},
      items:inv.items,totalAmount:inv.total_amount,
    }, { fileId: createHash('md5').update(`${source_id}:${invoiceId}`).digest('hex'), creationDate: inv.invoice_date });
    const drive = google.drive({version:'v3',auth:oauth2Client});
    const facturiFolderId = await resolveExistingInvoiceFolder(drive,(db.prepare("SELECT value FROM app_settings WHERE key='invoice_drive_folder_id'").get() as {value:string}|undefined)?.value);
    assertCurrent();
    const companyFolderId = await resolveCompanyInvoiceFolder(drive,facturiFolderId,inv.company_name,assertCurrent);
    // One file ID for both the operator and platform. Migration preserves the
    // existing platform ID; cleanup waits for an acknowledged publication.
    const document=await syncSingleInvoicePdf(drive, {
      rootId: facturiFolderId, parentId: companyFolderId,
      filenames: legacyInvoiceFilenames(inv.invoice_number, inv.issuer_settings.invoiceSeries || ''),
      buffer, assertCurrent, sourceId:source_id,invoiceId,fileId:identity?.file_id||inv.drive_file_id,
      previousCopies:identity?JSON.parse(identity.cleanup):[],
      remember:(id,copies)=>{
        assertCurrent();
        if(id && db.prepare('SELECT 1 FROM invoice_drive_identity WHERE file_id=? AND invoice_id!=? UNION ALL SELECT 1 FROM invoices WHERE drive_file_id=? AND id!=?').get(id,invoiceId,id,invoiceId)) {
          throw new InvoiceDriveDocumentError('PDF-ul este asociat altei facturi; actualizarea a fost oprită.');
        }
        db.prepare(`INSERT INTO invoice_drive_identity(invoice_id,file_id,company_id,store_id,external_company_id,cleanup) VALUES(?,?,?,?,?,?)
          ON CONFLICT(invoice_id) DO UPDATE SET file_id=excluded.file_id,cleanup=excluded.cleanup,verified_checksum=NULL`).run(invoiceId,id,owner.company_id,owner.store_id,owner.external_company_id,JSON.stringify(copies));
      },
    });
    assertCurrent();
    const {fileId}=document;
    db.prepare('UPDATE invoice_drive_identity SET verified_name=?,verified_parent=?,verified_checksum=?,verified_size=? WHERE invoice_id=? AND file_id=?').run(
      legacyInvoiceFilenames(inv.invoice_number,inv.issuer_settings.invoiceSeries||'')[0],companyFolderId,document.md5Checksum,Number(document.size),invoiceId,fileId);
    const saved = db.prepare('UPDATE invoices SET drive_file_id=? WHERE id=? AND document_revision=?').run(fileId,invoiceId,inv.document_revision);
    if (!saved.changes) throw new Error('Factura s-a modificat; regenerează PDF-ul.');
    return {success:true,fileId};
  } catch (error) { return documentSyncFailure(error); }
}

export async function cleanupPublishedInvoiceCopies() {
  if(getDeviceRole()!=='writer'||!loadTokens()) return;
  const connection=db;
  const eligible=`SELECT d.* FROM invoice_drive_identity d
    JOIN invoices i ON i.id=d.invoice_id JOIN stores s ON s.id=i.store_id JOIN companies c ON c.id=s.company_id
    JOIN billing_publication_queue q ON q.company_id=s.company_id
    WHERE d.cleanup!='[]' AND d.verified_checksum IS NOT NULL AND i.status!='cancelled' AND i.drive_file_id=d.file_id
      AND s.id=d.store_id AND s.company_id=d.company_id AND c.supabase_company_id IS d.external_company_id
      AND c.vrbaker_missing=0 AND q.revision=q.published_revision
      AND NOT EXISTS(SELECT 1 FROM billing_publication_delivery p WHERE p.company_id=q.company_id)
      AND NOT EXISTS(SELECT 1 FROM document_sync_queue w WHERE w.kind='invoice' AND w.document_id=i.id AND w.state!='ready')`;
  const rows=db.prepare(`${eligible} AND d.cleanup_attempts<8 AND d.cleanup_retry_at<=? LIMIT 10`).all(Date.now()) as {
    invoice_id:number;file_id:string;cleanup:string;verified_name:string;verified_parent:string;verified_checksum:string;verified_size:number;cleanup_attempts:number;
  }[];
  if(!rows.length) return;
  const drive=google.drive({version:'v3',auth:oauth2Client});
  const rootId=await resolveExistingInvoiceFolder(drive,(db.prepare("SELECT value FROM app_settings WHERE key='invoice_drive_folder_id'").get() as {value:string}|undefined)?.value);
  for(const row of rows) await withInvoiceDriveLock(row.invoice_id,async()=>{try{
    const assertCurrent=()=>{
      if(getDeviceRole()!=='writer'||db!==connection||!connection.open||
        !db.prepare(`SELECT 1 FROM (${eligible}) WHERE invoice_id=? AND file_id=? AND cleanup=?`).get(row.invoice_id,row.file_id,row.cleanup)) {
        throw new InvoiceDriveDocumentError('Publicarea facturii s-a schimbat; curățarea este amânată.');
      }
    };
    assertCurrent();
    const copies=JSON.parse(row.cleanup) as InvoicePdfCopy[];
    for(const copy of copies) {
      const {data:active}=await drive.files.get({fileId:row.file_id,fields:'id,name,mimeType,trashed,parents,md5Checksum,size',supportsAllDrives:true},documentRequestOptions);
      if(active.trashed||active.mimeType!=='application/pdf') throw new InvoiceDriveDocumentError('PDF-ul activ nu mai este disponibil; copiile sunt păstrate.');
      assertUploadedFileMatches(active,{name:row.verified_name,parentId:row.verified_parent,md5Checksum:row.verified_checksum,size:row.verified_size});
      if(copy.id===row.file_id) throw new InvoiceDriveDocumentError('Fișierul activ nu poate fi eliminat.');
      // Never retire a reference still used by another local invoice.
      if(db.prepare('SELECT 1 FROM invoices WHERE drive_file_id=? AND id!=?').get(copy.id,row.invoice_id)) throw new InvoiceDriveDocumentError('Copia este asociată altei facturi.');
      await trashConfirmedInvoiceCopy(drive,rootId,copy,assertCurrent);
    }
    assertCurrent();
    db.prepare("UPDATE invoice_drive_identity SET cleanup='[]',cleanup_attempts=0,cleanup_retry_at=0,cleanup_error=NULL WHERE invoice_id=? AND cleanup=?").run(row.invoice_id,row.cleanup);
  }catch{
    if(getDeviceRole()!=='writer'||db!==connection||!connection.open) return;
    const attempts=row.cleanup_attempts+1;
    db.prepare('UPDATE invoice_drive_identity SET cleanup_attempts=?,cleanup_retry_at=?,cleanup_error=? WHERE invoice_id=? AND cleanup=?').run(
      attempts,Date.now()+Math.min(900000,30000*2**Math.min(attempts-1,5))+Math.floor(Math.random()*5000),
      'Unificarea copiilor PDF din Drive nu s-a finalizat. Copiile sunt păstrate în siguranță; verifică accesul și reîncearcă.',row.invoice_id,row.cleanup);
  }
  });
}

export async function reconcileInvoicePdfs() {
  const connection = db;
  if (getDeviceRole() !== 'writer' || !loadTokens()) throw new Error('Este necesar un Writer conectat la Drive.');
  const series = '';
  const drive = google.drive({version:'v3',auth:oauth2Client});
  const facturiFolderId = await resolveExistingInvoiceFolder(drive,(db.prepare("SELECT value FROM app_settings WHERE key='invoice_drive_folder_id'").get() as {value:string}|undefined)?.value);
  const files = new Map<string,string[]>();
  for (const file of await listInvoiceTree(drive,facturiFolderId)) files.set(file.name,[...(files.get(file.name)||[]),file.id]);
  if(connection !== db) throw new Error('Baza de date s-a schimbat.');
  let linked=0; const unresolved:number[]=[];
  for (const row of db.prepare(`SELECT i.id,i.invoice_number,i.document_revision,i.pdf_path,c.name AS company_name FROM invoices i JOIN stores s ON s.id=i.store_id JOIN companies c ON c.id=s.company_id WHERE i.drive_file_id IS NULL`).all() as any[]) {
    const names=legacyInvoiceFilenames(row.invoice_number,series);
    const candidates=names.flatMap(name=>(files.get(name)||[]).map(id=>({name,id})));
    if(candidates.length!==1){unresolved.push(row.id);continue;}
    const match=candidates[0];
    const {resolvePdfPath} = await import('../security/fileValidation');
    const {localClientDocumentDirectory} = await import('../reports/clientDocumentStorage');
    const localPaths=[
      ...(row.pdf_path ? [row.pdf_path] : []),
      resolvePdfPath(localClientDocumentDirectory(app.getPath('documents'),row.company_name,'Facturi'),match.name),
      resolvePdfPath(path.join(app.getPath('documents'),'Facturi Vatra Romaneasca'),match.name),
    ];
    const {createHash} = await import('node:crypto');
    const metadata = await drive.files.get({fileId:match.id,fields:'md5Checksum,size'});
    const verified=localPaths.some(localPath=>{
      if(!fs.existsSync(localPath) || fs.statSync(localPath).size>25*1024*1024) return false;
      return createHash('md5').update(fs.readFileSync(localPath)).digest('hex')===metadata.data.md5Checksum;
    });
    if(!verified){unresolved.push(row.id);continue;}
    if(getDeviceRole()!=='writer' || connection !== db) throw new Error('Baza de date sau rolul s-a schimbat. Reia asocierea.');
    linked += db.prepare('UPDATE invoices SET drive_file_id=? WHERE id=? AND document_revision=? AND drive_file_id IS NULL').run(match.id,row.id,row.document_revision).changes;
  }
  return {linked,unresolved};
}


export async function uploadCreditNotePdfToCloud(filename: string, companyName: string, issuerCode: string, buffer: Uint8Array, assertCurrent?: () => void): Promise<{ success: boolean; error?: string; retryable?: boolean }> {
  if (getDeviceRole() !== 'writer') return { success: false, error: 'Calculatorul Viewer nu poate publica documente.' };
  if (!loadTokens()) return { success: false, error: 'Nu ești conectat la Google Drive.' };
  if (!/^Credit_Note_[A-Z0-9-]{1,60}\.pdf$/i.test(filename) || !/^[a-z0-9-]{1,40}$/i.test(issuerCode)) {
    return { success: false, error: 'Numele documentului Credit Note nu este valid.' };
  }
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const parentId = await resolvePrivateCloudFolder(drive, normalCloudDocumentFolders(companyName, 'Credit Notes'), true, assertCurrent);
    if (!parentId) throw new Error('Folderul clientului nu a putut fi creat în Google Drive.');
    const rootId = await resolvePrivateCloudFolder(drive,['Facturi'],true,assertCurrent);
    const legacyRootId = await resolvePrivateCloudFolder(drive,['Credit Notes',issuerCode.toLowerCase()],false);
    if (!rootId) throw new Error('Folderul de facturi lipsește.');
    assertCurrent?.();
    await updateInvoiceDriveDocument(drive, { rootId,parentId,filenames:[filename],buffer,
      assertCurrent: assertCurrent || (() => { if(getDeviceRole()!=='writer') throw new Error('Calculatorul Writer s-a schimbat.'); }),
      legacyRootIds: legacyRootId ? [legacyRootId] : [],
    });
    assertCurrent?.();
    return { success: true };
  } catch (error) {
    return documentSyncFailure(error);
  }
}

export async function downloadCreditNotePdfFromCloud(filename: string, companyName: string, issuerCode: string): Promise<{ success: boolean; buffer?: Uint8Array; error?: string }> {
  if (!loadTokens()) return { success: false, error: 'Google Drive nu este conectat pe acest calculator.' };
  if (!/^Credit_Note_[A-Z0-9-]{1,60}\.pdf$/i.test(filename) || !/^[a-z0-9-]{1,40}$/i.test(issuerCode)) return { success: false, error: 'Identitatea documentului Credit Note nu este validă.' };
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    let parentId = await resolvePrivateCloudFolder(drive, normalCloudDocumentFolders(companyName, 'Credit Notes'), false);
    if (!parentId) {
      const rootFolderId = await findFolder(drive, CLOUD_ROOT_FOLDER_NAME);
      const creditNotesFolderId = rootFolderId ? await findFolder(drive, 'Credit Notes', rootFolderId) : null;
      parentId = creditNotesFolderId ? await findFolder(drive, issuerCode.toLowerCase(), creditNotesFolderId) : null;
    }
    if (!parentId) return { success: false, error: 'Folderul Credit Note al clientului nu a fost găsit în Google Drive.' };
    const escapedFilename = filename.replace(/'/g, "\\'");
    const search = await drive.files.list({
      q: `name='${escapedFilename}' and mimeType='application/pdf' and '${parentId}' in parents and trashed=false`,
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

async function deleteExactCloudFile(drive: any, folderNames: string[], filename: string) {
  const parentId = await resolvePrivateCloudFolder(drive, folderNames, false);
  if (!parentId) return false;
  const file = await findExactCloudFile(drive, parentId, filename);
  if (!file?.id) return false;
  await drive.files.delete({ fileId: file.id });
  return true;
}

export async function deleteClientFinancialDocumentFromCloud(
  companyName: string,
  kind: ClientFinancialDocumentKind,
  filename: string,
  legacyIssuerCode?: string,
): Promise<{ success: boolean; deleted: boolean; error?: string }> {
  if (getDeviceRole() !== 'writer') return { success: false, deleted: false, error: 'Calculatorul Viewer nu poate șterge documente.' };
  if (!loadTokens()) return { success: false, deleted: false, error: 'Nu ești conectat la Google Drive.' };
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    let deleted = await deleteExactCloudFile(drive, normalCloudDocumentFolders(companyName, kind), filename);
    if (kind === 'Facturi') {
      // Compatibility with PDFs written directly in the old Facturi root.
      deleted = await deleteExactCloudFile(drive, ['Facturi'], filename) || deleted;
    } else if (legacyIssuerCode && /^[a-z0-9-]{1,40}$/i.test(legacyIssuerCode)) {
      deleted = await deleteExactCloudFile(drive, ['Credit Notes', legacyIssuerCode.toLowerCase()], filename) || deleted;
    }
    return { success: true, deleted };
  } catch (error) {
    return { success: false, deleted: false, error: publicGoogleDriveError(error, 'Documentul nu a putut fi șters și verificat în Google Drive.') };
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
    const facturiFolderId=await resolveExistingInvoiceFolder(drive,(db.prepare("SELECT value FROM app_settings WHERE key='invoice_drive_folder_id'").get() as {value:string}|undefined)?.value);

    let fileSearch = await drive.files.list({
      q: `name='${filename}' and '${facturiFolderId}' in parents and trashed=false`,
      fields: 'files(id)'
    });

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
