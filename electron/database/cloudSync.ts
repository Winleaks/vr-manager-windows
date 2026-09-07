import {resolveExistingInvoiceFolder,resolveCompanyInvoiceFolder,listInvoiceTree,legacyInvoiceFilenames} from '../integrations/invoiceDriveFolder';
import fs from 'fs';
import path from 'path';
import { app, shell } from 'electron';
import { db, dbPath, restoreDb } from './db';
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
  const dbFolderId = await getOrCreateFolder(drive, 'Baza de date', rootFolderId);
  return { rootFolderId, dbFolderId };
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

export async function uploadInvoicePdf(invoiceId: number): Promise<{success:boolean; fileId?:string; error?:string}> {
  if (getDeviceRole() !== 'writer') return {success:false,error:'Doar Writer poate publica PDF-uri.'};
  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) throw new Error('Factura este invalidă.');
  if (!loadTokens()) return {success:false,error:'Google Drive nu este conectat.'};
  const connection = db;
  const inv = connection.prepare(`SELECT i.*, c.name AS company_name,c.cui,c.reg_com,c.address AS company_address,
    s.name AS store_name,s.address AS store_address FROM invoices i JOIN stores s ON s.id=i.store_id
    JOIN companies c ON c.id=s.company_id WHERE i.id=?`).get(invoiceId) as any;
  if (!inv) throw new Error('Factura nu există.');
  try {
    const {generateInvoicePDF} = await import('../../src/utils/pdfGenerator');
    const {getInvoiceSettings} = await import('./invoiceSettings');
    if (connection !== db) throw new Error('Baza de date s-a schimbat.');
    const settings = getInvoiceSettings();
    const items = (db.prepare('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id').all(invoiceId) as any[])
      .map(i=>({productName:i.product_name,quantity:i.quantity,unitPrice:i.unit_price,totalPrice:i.total_price}));
    const buffer = generateInvoicePDF(settings,{invoiceNumber:inv.invoice_number,invoiceDate:inv.invoice_date,
      client:{name:inv.company_name,cui:inv.cui,regCom:inv.reg_com,address:inv.company_address},
      store:{name:inv.store_name,address:inv.store_address},items,totalAmount:inv.total_amount});
    const drive = google.drive({version:'v3',auth:oauth2Client});
    const facturiFolderId = await resolveExistingInvoiceFolder(drive,(db.prepare("SELECT value FROM app_settings WHERE key='invoice_drive_folder_id'").get() as {value:string}|undefined)?.value);
    const companyFolderId = await resolveCompanyInvoiceFolder(drive,facturiFolderId,inv.company_name);
    const {Readable} = await import('node:stream');
    // New document revisions get a new private file, so an already-published row never points to changed bytes.
    const {source_id} = db.prepare('SELECT source_id FROM billing_publication_identity WHERE id=1').get() as {source_id:string};
    if (connection !== db) throw new Error('Baza de date s-a schimbat.');
    const {createHash} = await import('node:crypto');
    const hash = createHash('sha256').update(Buffer.from(buffer)).digest('hex').slice(0,16);
    const name = `Invoice_${source_id}_${invoiceId}_${inv.document_revision}_${hash}.pdf`;
    const match = await drive.files.list({q:`'${companyFolderId}' in parents and name='${name}' and trashed=false`,fields:'files(id)',pageSize:2});
    if ((match.data.files?.length || 0)>1) throw new Error('Documente duplicate în Drive.');
    let fileId = match.data.files?.[0]?.id;
    if (!fileId) {
      const result = await drive.files.create({requestBody:{name,parents:[companyFolderId]},media:{mimeType:'application/pdf',body:Readable.from([Buffer.from(buffer)])},fields:'id'});
      fileId=result.data.id;
    }
    if (!fileId || getDeviceRole() !== 'writer' || connection !== db) throw new Error('Publicarea PDF nu a fost finalizată.');
    const saved = db.prepare('UPDATE invoices SET drive_file_id=? WHERE id=? AND document_revision=?').run(fileId,invoiceId,inv.document_revision);
    if (!saved.changes) throw new Error('Factura s-a modificat; regenerează PDF-ul.');
    return {success:true,fileId};
  } catch { return {success:false,error:'PDF-ul nu a putut fi publicat în Drive. Reîncearcă.'}; }
}

export async function reconcileInvoicePdfs() {
  const connection = db;
  if (getDeviceRole() !== 'writer' || !loadTokens()) throw new Error('Este necesar un Writer conectat la Drive.');
  const {getInvoiceSettings} = await import('./invoiceSettings');
  const series = getInvoiceSettings().invoiceSeries;
  const drive = google.drive({version:'v3',auth:oauth2Client});
  const facturiFolderId = await resolveExistingInvoiceFolder(drive,(db.prepare("SELECT value FROM app_settings WHERE key='invoice_drive_folder_id'").get() as {value:string}|undefined)?.value);
  const files = new Map<string,string[]>();
  for (const file of await listInvoiceTree(drive,facturiFolderId)) files.set(file.name,[...(files.get(file.name)||[]),file.id]);
  if(connection !== db) throw new Error('Baza de date s-a schimbat.');
  let linked=0; const unresolved:number[]=[];
  for (const row of db.prepare(`SELECT i.id,i.invoice_number,i.document_revision,c.name AS company_name FROM invoices i JOIN stores s ON s.id=i.store_id JOIN companies c ON c.id=s.company_id WHERE i.drive_file_id IS NULL`).all() as any[]) {
    const names=legacyInvoiceFilenames(row.invoice_number,series);
    const candidates=names.flatMap(name=>(files.get(name)||[]).map(id=>({name,id})));
    if(candidates.length!==1){unresolved.push(row.id);continue;}
    const match=candidates[0];
    const {resolvePdfPath} = await import('../security/fileValidation');
    const {localClientDocumentDirectory} = await import('../reports/clientDocumentStorage');
    const localPaths=[
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

export async function deletePdfFromCloud(filename: string): Promise<{ success: boolean; error?: string }> {
  if (getDeviceRole() !== 'writer') {
    return { success: false, error: 'Calculatorul Viewer nu poate șterge documente.' };
  }
  if (!loadTokens()) {
    return { success: false, error: 'Nu ești conectat la Google Drive.' };
  }
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const facturiFolderId = await resolveExistingInvoiceFolder(drive,(db.prepare("SELECT value FROM app_settings WHERE key='invoice_drive_folder_id'").get() as {value:string}|undefined)?.value);

    const {validatePdfFilename} = await import('../security/fileValidation');
    const safeName = validatePdfFilename(filename).replace(/'/g, "\\'");
    const fileSearch = await drive.files.list({
      q: `name='${safeName}' and '${facturiFolderId}' in parents and trashed=false`,
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
