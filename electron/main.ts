import {startBillingPublisher} from './integrations/billingPublisher';
import { app, BrowserWindow, dialog, session } from 'electron'
import { execFileSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { initDb, backupDb, closeDb } from './database/db'
import { registerRawMaterialHandlers } from './ipc/rawMaterialHandlers'
import { registerFinishedProductHandlers } from './ipc/finishedProductHandlers'
import { registerRecipeHandlers } from './ipc/recipeHandlers'
import { registerProductionHandlers } from './ipc/productionHandlers'
import { registerStockMovementHandlers } from './ipc/stockMovementHandlers'
import { registerSystemHandlers } from './ipc/systemHandlers'
import { registerDailyCashHandlers } from './ipc/dailyCashHandlers'
import { registerBillingHandlers } from './ipc/billingHandlers'
import { registerProtectedRegistryHandlers } from './ipc/protectedRegistryHandlers'
import { trustIpcSender } from './ipc/trustedHandler'
import { getDeviceRole } from './device/deviceRole'
import { syncViewerFromCloud } from './database/cloudSync'
import { containsLegacyApplicationProcess } from './migration/legacyProcessPolicy'
import { checkForUpdates, initializeUpdater } from './updater/updateCoordinator'
import { cashRepo } from './database/repositories/cashRepo'
import { millisecondsUntilNextLocalMidnight } from './database/cashDayRollover'
import { runStartupCashReconciliation } from './startupCashReconciliation'
import { cleanupStaleProtectedRegistryTemporaryFiles, lockAllProtectedRegistrySessions } from './protectedRegistry/service'

const DIST_PATH = path.join(__dirname, '../dist')
process.env.DIST = DIST_PATH
process.env.PUBLIC = app.isPackaged ? DIST_PATH : path.join(DIST_PATH, '../public')

let win: BrowserWindow | null
let cashDayRolloverTimer: ReturnType<typeof setTimeout> | null = null
const CASH_RECONCILIATION_TARGET = 241.74
const CASH_RECONCILIATION_MARKER = 'daily_cash_reconciliation_v0_1_83_241_74'

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

app.enableSandbox()

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

function isAllowedAppUrl(targetUrl: string) {
  try {
    const parsed = new URL(targetUrl)
    if (VITE_DEV_SERVER_URL) {
      return parsed.origin === new URL(VITE_DEV_SERVER_URL).origin
    }

    if (parsed.protocol !== 'file:') return false
    const targetPath = path.resolve(fileURLToPath(parsed))
    const appPath = path.resolve(path.join(DIST_PATH, 'index.html'))
    return targetPath === appPath
  } catch {
    return false
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'VR - Hub Management',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: true,
      spellcheck: false,
    },
  })

  trustIpcSender(win.webContents)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedAppUrl(targetUrl)) event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  
  // Remove default menu (File, Edit, View, etc.)
  win.setMenu(null)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(DIST_PATH, 'index.html'))
  }

  win.webContents.once('did-finish-load', () => {
    if (app.isPackaged) void checkForUpdates()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('before-quit', () => {
  if (cashDayRolloverTimer) clearTimeout(cashDayRolloverTimer)
  closeDb();
  lockAllProtectedRegistrySessions();
})

app.whenReady().then(async () => {
  app.setAppUserModelId('com.winleaks.vrhubmanagement')
  cleanupStaleProtectedRegistryTemporaryFiles()
  if (process.platform === 'win32' && getDeviceRole() === 'writer') {
    try {
      const processes = execFileSync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      });
      if (containsLegacyApplicationProcess(processes)) {
        dialog.showErrorBox(
          'Aplicația veche este încă deschisă',
          'Închide VR - Management Hub pe toate calculatoarele înainte de a porni noul Writer VR - Hub Management.',
        );
        app.quit();
        return;
      }
    } catch {
      dialog.showErrorBox(
        'Verificarea tranziției a eșuat',
        'Noul Writer nu pornește deoarece nu a putut verifica dacă aplicația veche este închisă.',
      );
      app.quit();
      return;
    }
  }
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  initDb()
  startBillingPublisher()
  if (getDeviceRole() === 'writer') {
    try {
      const reconciliation = await runStartupCashReconciliation({
        markerKey: CASH_RECONCILIATION_MARKER,
        targetBalance: CASH_RECONCILIATION_TARGET,
        hasBalanceReconciliation: (markerKey) => cashRepo.hasBalanceReconciliation(markerKey),
        getActiveDay: () => cashRepo.getActiveDay(true),
        backupDatabase: () => backupDb(),
        reconcileBalanceOnce: (dayId, targetBalance, markerKey) => (
          cashRepo.reconcileBalanceOnce(dayId, targetBalance, markerKey)
        ),
      })
      if (reconciliation.applied) {
        console.log('[DAILY CASH] Soldul Writer a fost reconciliat o singură dată la £241.74.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Operația nu a putut fi finalizată.'
      dialog.showErrorBox('Reconcilierea Daily Cash a eșuat', message)
    }
  }
  // Writer publică snapshot-uri; Viewer descarcă doar versiuni Drive mai noi.
  const runAutomaticBackup = async () => {
    if (getDeviceRole() !== 'writer') return
    const result = await backupDb()
    if (win && !win.isDestroyed()) win.webContents.send('backup-completed', result)
  }
  const runViewerSync = async () => {
    if (getDeviceRole() !== 'viewer') return
    const result = await syncViewerFromCloud()
    if (result.updated && win) win.webContents.send('database-replica-updated', result)
  }
  const runCashDayRollover = async () => {
    if (getDeviceRole() !== 'writer') return
    try {
      const previousDay = cashRepo.getActiveDay(false)
      const currentDay = cashRepo.getActiveDay(true)
      if (previousDay?.id !== currentDay?.id) {
        if (win && !win.isDestroyed()) win.webContents.send('cash-day-rolled-over', currentDay)
        await runAutomaticBackup()
      }
    } catch (error) {
      console.error('Închiderea automată a casei a eșuat:', error)
      if (win && !win.isDestroyed()) {
        win.webContents.send('cash-day-rollover-error', 'Ziua de casă nu a putut fi închisă automat. Verifică Setări și data calculatorului.')
      }
    }
  }
  const scheduleCashDayRollover = () => {
    if (cashDayRolloverTimer) clearTimeout(cashDayRolloverTimer)
    cashDayRolloverTimer = setTimeout(() => {
      void runCashDayRollover().finally(scheduleCashDayRollover)
    }, millisecondsUntilNextLocalMidnight() + 250)
  }
  if (getDeviceRole() === 'writer') {
    void runCashDayRollover()
    scheduleCashDayRollover()
  }
  if (getDeviceRole() === 'writer') void runAutomaticBackup()
  setInterval(() => {
    void runAutomaticBackup()
  }, 10 * 60 * 1000);
  setInterval(() => {
    void runViewerSync()
  }, 60 * 1000);
  registerRawMaterialHandlers()
  registerFinishedProductHandlers()
  registerRecipeHandlers()
  registerProductionHandlers()
  registerStockMovementHandlers()
  registerSystemHandlers()
  registerDailyCashHandlers()
  registerBillingHandlers()
  registerProtectedRegistryHandlers()
  initializeUpdater()
  createWindow()
  setTimeout(() => {
    void runViewerSync()
  }, 2000)
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
}).catch((error) => {
  console.error('[STARTUP ERROR] Inițializarea aplicației a eșuat:', error)
  const message = error instanceof Error ? error.message : 'Operația nu a putut fi finalizată.'
  dialog.showErrorBox(
    'VR - Hub Management nu a putut porni',
    `Datele locale nu au fost modificate. Detalii: ${message}`,
  )
  app.quit()
})
