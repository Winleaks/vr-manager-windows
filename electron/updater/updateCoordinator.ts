import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { createUpdateStateStore } from './updateState';

const updateState = createUpdateStateStore(app.getVersion());
let initialized = false;
let confirmInstall: () => boolean = () => true;
let cancelInstallApproval: () => void = () => {};
let checkInFlight: Promise<ReturnType<typeof updateState.snapshot>> | null = null;
let downloadInFlight: Promise<unknown> | null = null;

function broadcast() {
  const snapshot = updateState.snapshot();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('update-state-changed', snapshot);
  }
  return snapshot;
}

export function initializeUpdater(confirmClose?: () => boolean, cancelApproval?: () => void) {
  if (cancelApproval) cancelInstallApproval = cancelApproval;
  if (confirmClose) confirmInstall = confirmClose;
  if (initialized) return;
  initialized = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    updateState.available(info);
    broadcast();
  });
  autoUpdater.on('update-not-available', () => {
    updateState.notAvailable();
    broadcast();
  });
  autoUpdater.on('download-progress', (progress) => {
    updateState.downloading(progress.percent);
    broadcast();
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateState.downloaded(info);
    broadcast();
  });
  autoUpdater.on('error', (error) => {
    cancelInstallApproval();
    console.error('Eroare auto-update:', error);
    updateState.failed();
    broadcast();
  });
}

export function getUpdateState() {
  return updateState.snapshot();
}

export function checkForUpdates() {
  initializeUpdater();
  if (checkInFlight) return checkInFlight;
  updateState.checking();
  broadcast();
  checkInFlight = autoUpdater.checkForUpdates()
    .then((result) => {
      if (result?.isUpdateAvailable) updateState.available(result.updateInfo);
      else updateState.notAvailable();
      return broadcast();
    })
    .catch((error) => {
      console.error('Eroare la verificarea update-urilor:', error);
      updateState.failed();
      return broadcast();
    })
    .finally(() => {
      checkInFlight = null;
    });
  return checkInFlight;
}

export function downloadUpdate() {
  initializeUpdater();
  if (downloadInFlight) return downloadInFlight;
  const state = updateState.snapshot();
  if (state.status !== 'available' && !(state.status === 'error' && state.updateInfo)) {
    throw new Error('Nu există nicio actualizare disponibilă pentru descărcare.');
  }
  updateState.downloading(0);
  broadcast();
  downloadInFlight = autoUpdater.downloadUpdate().finally(() => {
    downloadInFlight = null;
  });
  return downloadInFlight;
}

export function installUpdate() {
  if (updateState.snapshot().status !== 'downloaded') {
    throw new Error('Actualizarea nu a fost încă descărcată.');
  }
  if (!confirmInstall()) throw new Error('Instalarea a fost amânată. Hub rămâne deschis.');
  try { autoUpdater.quitAndInstall(false, true); }
  catch (error) { cancelInstallApproval(); throw error; }
}
