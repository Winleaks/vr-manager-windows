import fs from 'fs';
import path from 'path';
import { app, shell } from 'electron';
import { dbPath, restoreDb } from './db';
import { google } from 'googleapis';
import { CodeChallengeMethod } from 'google-auth-library';
import http from 'http';
import { createHash, randomBytes } from 'crypto';
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
  userEmail: string | null;
  lastCloudBackup: string | null;
  availableBackups: Array<{
    fileId: string;
    fileName: string;
    mtime: number;
    formattedTime: string;
  }>;
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
  return { success: true };
}

async function getOrCreateFolder(drive: any, folderName: string, parentId?: string): Promise<string> {
  const query = parentId 
    ? `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    : `name='${folderName}' and 'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  
  const search = await drive.files.list({
    q: query,
    fields: 'files(id)'
  });

  if (search.data.files && search.data.files.length > 0) {
    return search.data.files[0].id!;
  }

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
  const rootFolderId = await getOrCreateFolder(drive, 'VR - Hub Management');
  const facturiFolderId = await getOrCreateFolder(drive, 'Facturi', rootFolderId);
  const dbFolderId = await getOrCreateFolder(drive, 'Baza de date', rootFolderId);
  return { rootFolderId, facturiFolderId, dbFolderId };
}

export async function getCloudStatus(): Promise<CloudSyncStatus> {
  const isConnected = loadTokens();
  if (!isConnected) {
    return {
      isConnected: false,
      userEmail: null,
      lastCloudBackup: null,
      availableBackups: []
    };
  }

  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    // Get user email
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    
    const res = await drive.files.list({
      q: cloudDatabaseQuery(),
      orderBy: 'modifiedTime desc',
      fields: 'files(id, name, modifiedTime)'
    });

    const files = res.data.files || [];
    const backups = files.sort((left, right) => {
      if (left.name === PRIMARY_CLOUD_DATABASE_NAME && right.name !== PRIMARY_CLOUD_DATABASE_NAME) return -1;
      if (right.name === PRIMARY_CLOUD_DATABASE_NAME && left.name !== PRIMARY_CLOUD_DATABASE_NAME) return 1;
      return Date.parse(right.modifiedTime || '') - Date.parse(left.modifiedTime || '');
    }).map(f => {
      const d = new Date(f.modifiedTime as string);
      return {
        fileId: f.id as string,
        fileName: f.name as string,
        mtime: d.getTime(),
        formattedTime: d.toLocaleString('ro-RO')
      };
    });

    return {
      isConnected: true,
      userEmail: userInfo.data.email || 'Conectat',
      lastCloudBackup: backups.length > 0 ? backups[0].formattedTime : null,
      availableBackups: backups
    };
  } catch (e) {
    console.error('Error fetching cloud status:', e);
    return {
      isConnected: true, // tokens exist logic
      userEmail: 'Eroare conexiune',
      lastCloudBackup: null,
      availableBackups: []
    };
  }
}

export async function saveToCloud(isAutomatic = false, snapshotPath?: string): Promise<{ success: boolean; error?: string }> {
  if (getDeviceRole() !== 'writer') {
    return { success: false, error: 'Calculatorul Viewer nu poate publica baza de date.' };
  }
  if (!loadTokens()) {
    return { success: false, error: 'Nu ești conectat la Google Drive.' };
  }

  try {
    if (!snapshotPath || path.resolve(snapshotPath) === path.resolve(dbPath)) {
      return { success: false, error: 'Sincronizarea cloud necesită un snapshot verificat.' };
    }
    const { evaluateDb, verifyDatabaseFile } = require('./db');
    verifyDatabaseFile(snapshotPath);
    const localInfo = evaluateDb(snapshotPath);
    const localScore = localInfo ? localInfo.totalItems : 0;

    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const { dbFolderId } = await getDriveStructure(drive);

    // Check if file already exists in 'Baza de date' folder or anywhere on drive
    let search = await drive.files.list({
      q: `'${dbFolderId}' in parents and name='${PRIMARY_CLOUD_DATABASE_NAME}' and trashed=false`,
      fields: 'files(id, parents)'
    });

    if (!search.data.files || search.data.files.length === 0) {
      search = await drive.files.list({
        q: `name='${PRIMARY_CLOUD_DATABASE_NAME}' and trashed=false`,
        fields: 'files(id, parents)'
      });
    }

    // Protecție: Dacă salvarea este automată pe fundal și baza locală este goală/nouă, dar pe cloud există deja un backup, nu suprascriem!
    if (isAutomatic && localScore <= 5 && search.data.files && search.data.files.length > 0) {
      console.log('[CLOUD SYNC] Salvarea automată a fost ignorată pentru a proteja backup-ul existent din Google Drive.');
      return { success: true };
    }

    const media = {
      mimeType: 'application/x-sqlite3',
      body: fs.createReadStream(snapshotPath)
    };

    if (search.data.files && search.data.files.length > 0) {
      const existingFile = search.data.files[0];
      const fileId = existingFile.id!;

      const updateParams: any = {
        fileId: fileId,
        media: media
      };

      // Mutăm fișierul în folderul 'Baza de date' dacă era în rădăcină sau altundeva
      if (!existingFile.parents || !existingFile.parents.includes(dbFolderId)) {
        updateParams.addParents = dbFolderId;
        const previousParents = (existingFile.parents || []).join(',');
        if (previousParents) {
          updateParams.removeParents = previousParents;
        }
      }

      await drive.files.update(updateParams);
    } else {
      // Creare fișier nou în subfolderul 'Baza de date'
      await drive.files.create({
        requestBody: {
          name: PRIMARY_CLOUD_DATABASE_NAME,
          parents: [dbFolderId]
        },
        media: media,
        fields: 'id'
      });
    }

    return { success: true };
  } catch (e: any) {
    console.error('Save to cloud error:', e);
    return { success: false, error: 'Backupul nu a putut fi salvat în Google Drive.' };
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
  const response = await client.files.list({
    q: cloudDatabaseQuery(),
    orderBy: 'modifiedTime desc',
    pageSize: 100,
    fields: 'files(id,name,version,modifiedTime,md5Checksum,size)',
  });
  const file = selectPreferredCloudDatabase(
    response.data.files || [],
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

    const { Readable } = require('stream');
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    // Căutăm dacă fișierul PDF există deja în subfolderul 'Facturi' din VR - Management
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
      // Suprascriere fișier existent
      const existingFile = fileSearch.data.files[0];
      await drive.files.update({
        fileId: existingFile.id!,
        media: { mimeType: 'application/pdf', body: stream }
      });
    } else {
      // Creare fișier nou în subfolderul Facturi din VR - Management
      await drive.files.create({
        requestBody: { name: filename, parents: [facturiFolderId] },
        media: { mimeType: 'application/pdf', body: stream },
        fields: 'id'
      });
    }

    return { success: true };
  } catch (e: any) {
    console.error('Upload PDF error:', e);
    return { success: false, error: e.message };
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
    const escapedFilename = filename.replace(/'/g, "\\'");
    const search = await drive.files.list({ q: `name='${escapedFilename}' and '${issuerFolderId}' in parents and trashed=false`, fields: 'files(id)' });
    const makeStream = () => {
      const { Readable } = require('stream');
      const stream = new Readable(); stream.push(buffer); stream.push(null); return stream;
    };
    const existing = search.data.files?.[0];
    if (existing?.id) await drive.files.update({ fileId: existing.id, media: { mimeType: 'application/pdf', body: makeStream() } });
    else await drive.files.create({ requestBody: { name: filename, parents: [issuerFolderId] }, media: { mimeType: 'application/pdf', body: makeStream() }, fields: 'id' });
    return { success: true };
  } catch (error: any) {
    console.error('Credit Note PDF upload error:', error);
    return { success: false, error: error?.message || 'Încărcarea Credit Note-ului a eșuat.' };
  }
}

export async function downloadCreditNotePdfFromCloud(filename: string, issuerCode: string): Promise<{ success: boolean; buffer?: Uint8Array; error?: string }> {
  if (!loadTokens()) return { success: false, error: 'Google Drive nu este conectat pe acest calculator.' };
  if (!/^Credit_Note_[A-Z0-9-]{1,60}\.pdf$/i.test(filename) || !/^[a-z0-9-]{1,40}$/i.test(issuerCode)) return { success: false, error: 'Identitatea documentului Credit Note nu este validă.' };
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const findFolder = async (name: string, parentId?: string) => {
      const escapedName = name.replace(/'/g, "\\'");
      const parent = parentId ? ` and '${parentId}' in parents` : '';
      const result = await drive.files.list({ q: `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parent}`, fields: 'files(id)', pageSize: 2 });
      return result.data.files?.[0]?.id || null;
    };
    const rootFolderId = await findFolder('VR - Hub Management');
    const creditNotesFolderId = rootFolderId ? await findFolder('Credit Notes', rootFolderId) : null;
    const issuerFolderId = creditNotesFolderId ? await findFolder(issuerCode.toLowerCase(), creditNotesFolderId) : null;
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
  } catch (error: any) {
    console.error('Credit Note PDF download error:', error);
    return { success: false, error: error?.message || 'Descărcarea Credit Note-ului a eșuat.' };
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
