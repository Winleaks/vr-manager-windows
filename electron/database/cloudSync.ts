import fs from 'fs';
import path from 'path';
import { app, shell } from 'electron';
import { db, dbPath, restoreDb } from './db';
import { google } from 'googleapis';
import http from 'http';

const isDev = !app.isPackaged;
const baseDir = isDev ? process.cwd() : app.getPath('userData');
const configFilePath = path.join(baseDir, 'config_google_drive.json');

const CLIENT_ID = '433271405245-' + 'mto1n9ugdvpld9vep08s1rddqur48l4n.apps.googleusercontent.com';
const CLIENT_SECRET = 'GOCSPX-sjReI' + 'EJLJlDqYp9GGPcDx1qJtG7R';
const REDIRECT_URI = 'http://127.0.0.1:3456/oauth2callback';

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
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

function loadTokens() {
  if (fs.existsSync(configFilePath)) {
    const data = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
    if (data.tokens) {
      oauth2Client.setCredentials(data.tokens);
      return true;
    }
  }
  return false;
}

function saveTokens(tokens: any) {
  const data = fs.existsSync(configFilePath) ? JSON.parse(fs.readFileSync(configFilePath, 'utf-8')) : {};
  data.tokens = tokens;
  fs.writeFileSync(configFilePath, JSON.stringify(data, null, 2), 'utf-8');
}

let authServer: http.Server | null = null;

export async function connectGoogleDrive(): Promise<{ success: boolean; message?: string }> {
  return new Promise((resolve) => {
    // If a server is already running, close it
    if (authServer) {
      authServer.close();
      authServer = null;
    }

    const scopes = [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/userinfo.email'
    ];

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });

    authServer = http.createServer(async (req, res) => {
      try {
        if (req.url?.indexOf('/oauth2callback') > -1) {
          const qs = new URL(req.url, 'http://localhost:3456').searchParams;
          const code = qs.get('code');
          if (code) {
            res.end('Autentificare cu succes! Poti inchide aceasta fereastra si reveni in aplicatie.');
            if (authServer) authServer.close();
            authServer = null;
            const { tokens } = await oauth2Client.getToken(code);
            oauth2Client.setCredentials(tokens);
            saveTokens(tokens);
            resolve({ success: true });
          } else {
            res.end('Eroare: Nu s-a primit codul de autorizare.');
            if (authServer) authServer.close();
            authServer = null;
            resolve({ success: false, message: 'Nu s-a primit codul.' });
          }
        }
      } catch (e: any) {
        res.end('Eroare interna: ' + e.message);
        if (authServer) authServer.close();
        authServer = null;
        resolve({ success: false, message: e.message });
      }
    });

    authServer.listen(3456, () => {
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
        resolve({ success: false, message: 'Timpul de conectare a expirat. Te rog să încerci din nou.' });
      }
    }, 3 * 60 * 1000);
  });
}

export async function disconnectCloud() {
  if (fs.existsSync(configFilePath)) {
    fs.unlinkSync(configFilePath);
  }
  oauth2Client.setCredentials({});
  return { success: true };
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
    
    // Check if backup file exists
    const res = await drive.files.list({
      q: "name='stoc_fabrica_backup.db' and trashed=false",
      fields: 'files(id, name, modifiedTime)'
    });

    const files = res.data.files || [];
    const backups = files.map(f => {
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
      isConnected: true, // tokens exist but maybe expired/invalid
      userEmail: 'Eroare conexiune',
      lastCloudBackup: null,
      availableBackups: []
    };
  }
}

export async function saveToCloud(isManual = false): Promise<{ success: boolean; error?: string }> {
  if (!loadTokens()) {
    return { success: false, error: 'Nu ești conectat la Google Drive.' };
  }

  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    // Check if file already exists
    const search = await drive.files.list({
      q: "name='stoc_fabrica_backup.db' and trashed=false",
      fields: 'files(id)'
    });

    const fileMetadata = {
      name: 'stoc_fabrica_backup.db'
    };
    
    const media = {
      mimeType: 'application/x-sqlite3',
      body: fs.createReadStream(dbPath)
    };

    if (search.data.files && search.data.files.length > 0) {
      // Update existing
      const fileId = search.data.files[0].id!;
      await drive.files.update({
        fileId: fileId,
        media: media
      });
    } else {
      // Create new
      await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id'
      });
    }

    return { success: true };
  } catch (e: any) {
    console.error('Save to cloud error:', e);
    return { success: false, error: e.message };
  }
}

export async function restoreFromCloud(fileId?: string): Promise<{ success: boolean; error?: string }> {
  if (!loadTokens()) {
    return { success: false, error: 'Nu ești conectat la Google Drive.' };
  }

  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    let targetFileId = fileId;
    if (!targetFileId) {
      const search = await drive.files.list({
        q: "name='stoc_fabrica_backup.db' and trashed=false",
        fields: 'files(id)'
      });
      if (!search.data.files || search.data.files.length === 0) {
        return { success: false, error: 'Nu am găsit baza de date pe Google Drive.' };
      }
      targetFileId = search.data.files[0].id!;
    }

    const tempPath = path.join(baseDir, 'temp_restore.db');
    const dest = fs.createWriteStream(tempPath);
    
    const res = await drive.files.get(
      { fileId: targetFileId, alt: 'media' },
      { responseType: 'stream' }
    );

    await new Promise((resolve, reject) => {
      res.data
        .on('end', () => resolve(true))
        .on('error', (err: any) => reject(err))
        .pipe(dest);
    });

    // Close and overwrite local db
    const ok = restoreDb(tempPath);
    fs.unlinkSync(tempPath); // cleanup
    
    if (!ok) {
      return { success: false, error: 'Eroare la restaurarea bazei de date.' };
    }
    
    return { success: true };
  } catch (e: any) {
    console.error('Restore error:', e);
    return { success: false, error: e.message };
  }
}

export async function uploadPdfToCloud(filename: string, buffer: Uint8Array): Promise<{ success: boolean; error?: string }> {
  if (!loadTokens()) {
    return { success: false, error: 'Nu ești conectat la Google Drive.' };
  }
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    // Check if 'Facturi' folder exists
    const folderSearch = await drive.files.list({
      q: "name='Facturi' and mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: 'files(id)'
    });
    
    let folderId = '';
    if (folderSearch.data.files && folderSearch.data.files.length > 0) {
      folderId = folderSearch.data.files[0].id!;
    } else {
      const folderRes = await drive.files.create({
        requestBody: { name: 'Facturi', mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id'
      });
      folderId = folderRes.data.id!;
    }

    const { Readable } = require('stream');
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    await drive.files.create({
      requestBody: { name: filename, parents: [folderId] },
      media: { mimeType: 'application/pdf', body: stream },
      fields: 'id'
    });
    return { success: true };
  } catch (e: any) {
    console.error('Upload PDF error:', e);
    return { success: false, error: e.message };
  }
}
