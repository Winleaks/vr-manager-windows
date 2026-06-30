import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import { autoUpdater } from 'electron-updater'
import { initDb, backupDb, closeDb } from './database/db'
import { registerRawMaterialHandlers } from './ipc/rawMaterialHandlers'
import { registerFinishedProductHandlers } from './ipc/finishedProductHandlers'
import { registerRecipeHandlers } from './ipc/recipeHandlers'
import { registerProductionHandlers } from './ipc/productionHandlers'
import { registerStockMovementHandlers } from './ipc/stockMovementHandlers'
import { registerSystemHandlers } from './ipc/systemHandlers'

process.env.DIST = path.join(__dirname, '../dist')
process.env.PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(process.env.DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('before-quit', () => {
  closeDb();
})

app.whenReady().then(() => {
  initDb()
  // Run an automatic backup on startup and every 10 minutes
  backupDb()
  setInterval(() => {
    backupDb();
    if (win) {
      win.webContents.send('backup-completed');
    }
  }, 10 * 60 * 1000);
  registerRawMaterialHandlers()
  registerFinishedProductHandlers()
  registerRecipeHandlers()
  registerProductionHandlers()
  registerStockMovementHandlers()
  registerSystemHandlers()
  
  createWindow()
  
  // Verificare Update-uri
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  
  // Așteptăm 3 secunde după deschidere ca să nu blocăm încărcarea UI-ului
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
      console.log('Eroare la verificarea update-urilor:', err);
    });
  }, 3000);

  autoUpdater.on('update-downloaded', (info) => {
    if (win) {
      dialog.showMessageBox(win, {
        type: 'info',
        title: 'Actualizare disponibilă',
        message: 'O nouă versiune a aplicației a fost descărcată automat în fundal.\n\nVrei să instalezi actualizarea acum și să restartezi programul?',
        buttons: ['Da, instalează acum', 'Nu, la următoarea deschidere']
      }).then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall(false, true);
        }
      });
    }
  });
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})
