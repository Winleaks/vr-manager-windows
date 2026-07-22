import { BrowserWindow } from 'electron';
import { getAppSetting } from './repositories/billingRepo';

let isListening = false;
let syncInterval: NodeJS.Timeout | null = null;
let lastSyncTimestamp = new Date().toISOString();

export interface SyncStatus {
  active: boolean;
  lastSync: string | null;
  mode: 'realtime' | 'polling' | 'offline';
  message: string;
}

let currentStatus: SyncStatus = {
  active: false,
  lastSync: null,
  mode: 'offline',
  message: 'Inactiv'
};

export function getSyncStatus(): SyncStatus {
  return currentStatus;
}

export function notifyWindows(channel: string, data: any) {
  try {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    }
  } catch (e) {
    console.error('Eroare notificare ferestre Electron:', e);
  }
}

/**
 * Inițializează Engine-ul de Sincronizare în Timp Real între Calculatoare
 */
export async function initRealtimeSync() {
  if (isListening) return;

  const url = getAppSetting('supabase_url');
  const key = getAppSetting('supabase_key');
  const email = getAppSetting('supabase_email');
  const password = getAppSetting('supabase_password');

  if (!url || !key || !email || !password) {
    currentStatus = {
      active: false,
      lastSync: null,
      mode: 'offline',
      message: 'Setările Supabase nu sunt configurate.'
    };
    return;
  }

  isListening = true;
  currentStatus = {
    active: true,
    lastSync: new Date().toLocaleTimeString('ro-RO'),
    mode: 'realtime',
    message: 'Sincronizare Live Activă'
  };

  // Rulăm verificarea periodică ultrarapidă la fiecare 5 secunde
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(() => {
    checkCloudUpdates(url, key, email, password);
  }, 5000);
}

/**
 * Verifică în fundal dacă există modificări noi de pe alte calculatoare
 */
async function checkCloudUpdates(url: string, key: string, email: string, password: string) {
  try {
    // Autentificare rapidă
    const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key
      },
      body: JSON.stringify({ email, password })
    });

    if (!authRes.ok) return;
    const authData = await authRes.json();
    const token = authData.access_token;

    // Verificăm dacă fișierul de stocare central sau comenzile/magazinele au versiuni noi
    const pingRes = await fetch(`${url}/rest/v1/app_sync_log?select=*&order=created_at.desc&limit=1`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${token}`
      }
    });

    if (pingRes.ok) {
      const logs = await pingRes.json();
      if (logs && logs.length > 0) {
        const latestLog = logs[0];
        if (latestLog.created_at > lastSyncTimestamp) {
          lastSyncTimestamp = latestLog.created_at;
          currentStatus.lastSync = new Date().toLocaleTimeString('ro-RO');
          notifyWindows('realtime-data-updated', { table: latestLog.table_name || 'all', timestamp: lastSyncTimestamp });
          notifyWindows('sync-status-changed', currentStatus);
        }
      }
    }
  } catch (e) {
    currentStatus.mode = 'offline';
    currentStatus.message = 'Conexiune temporar indisponibilă';
    notifyWindows('sync-status-changed', currentStatus);
  }
}

export function stopRealtimeSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  isListening = false;
  currentStatus = {
    active: false,
    lastSync: null,
    mode: 'offline',
    message: 'Oprit'
  };
  notifyWindows('sync-status-changed', currentStatus);
}
