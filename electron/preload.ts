import { contextBridge, ipcRenderer } from 'electron'

type EventCallback = (...args: any[]) => void

function subscribe(channel: string, callback: EventCallback) {
  const listener = (_event: Electron.IpcRendererEvent, ...args: any[]) => callback(...args)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export const desktopApi = {
  rawMaterials: {
    getAll: () => ipcRenderer.invoke('get-raw-materials'),
    add: (rm: any) => ipcRenderer.invoke('add-raw-material', rm),
    update: (id: number, rm: any) => ipcRenderer.invoke('update-raw-material', id, rm),
  },
  categories: {
    get: (type?: string) => ipcRenderer.invoke('get-categories', type),
    add: (name: string, type: string) => ipcRenderer.invoke('add-category', name, type),
    update: (id: number, name: string) => ipcRenderer.invoke('update-category', id, name),
    delete: (id: number) => ipcRenderer.invoke('delete-category', id),
  },
  finishedProducts: {
    getAll: () => ipcRenderer.invoke('get-finished-products'),
    getById: (id: number) => ipcRenderer.invoke('get-finished-product', id),
    syncFromVrBaker: () => ipcRenderer.invoke('sync-finished-products'),
  },
  recipes: {
    getByProductId: (productId: number) => ipcRenderer.invoke('get-recipe', productId),
    save: (productId: number, batchSize: number, notes: string, items: any[]) =>
      ipcRenderer.invoke('save-recipe', productId, batchSize, notes, items),
  },
  productions: {
    getAll: () => ipcRenderer.invoke('get-productions'),
    add: (productId: number, quantity: number, date: string, notes: string) =>
      ipcRenderer.invoke('add-production', productId, quantity, date, notes),
  },
  stockMovements: {
    getAll: (limit?: number) => ipcRenderer.invoke('get-stock-movements', limit),
    adjustStock: (rawMaterialId: number, newStock: number, reason: string) =>
      ipcRenderer.invoke('adjust-stock', rawMaterialId, newStock, reason),
  },
  system: {
    getAppVersion: () => ipcRenderer.invoke('system:getAppVersion'),
    saveFile: (options: { buffer: Uint8Array; defaultPath: string; filters: any[] }) =>
      ipcRenderer.invoke('save-file', options),
    savePdfAuto: (options: { buffer: Uint8Array; filename: string; issuerCode?: string }) =>
      ipcRenderer.invoke('save-pdf-auto', options),
    openPdfFile: (filename: string, issuerCode?: string) => ipcRenderer.invoke('open-pdf-file', filename, issuerCode),
    manualBackup: () => ipcRenderer.invoke('manual-backup'),
    restoreBackup: () => ipcRenderer.invoke('restore-backup'),
    getLastBackupTime: () => ipcRenderer.invoke('get-last-backup-time'),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    getUpdateState: () => ipcRenderer.invoke('get-update-state'),
    startUpdateDownload: () => ipcRenderer.invoke('start-update-download'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    onUpdateAvailable: (callback: EventCallback) => subscribe('update-available', callback),
    onUpdateProgress: (callback: EventCallback) => subscribe('update-progress', callback),
    onUpdateDownloaded: (callback: EventCallback) => subscribe('update-downloaded', callback),
    onUpdateError: (callback: EventCallback) => subscribe('update-error', callback),
    onUpdateStateChanged: (callback: EventCallback) => subscribe('update-state-changed', callback),
    onBackupCompleted: (callback: EventCallback) => subscribe('backup-completed', callback),
    onGoogleAuthUrl: (callback: EventCallback) => subscribe('google-auth-url', callback),
    getCloudStatus: () => ipcRenderer.invoke('get-cloud-status'),
    connectGoogleDrive: () => ipcRenderer.invoke('connect-google-drive'),
    saveToCloud: () => ipcRenderer.invoke('save-to-cloud'),
    restoreFromCloud: (fileId?: string) => ipcRenderer.invoke('restore-from-cloud', fileId),
    disconnectCloud: () => ipcRenderer.invoke('disconnect-cloud'),
    uploadPdfToCloud: (filename: string, buffer: Uint8Array) =>
      ipcRenderer.invoke('upload-pdf-to-cloud', filename, buffer),
    getSyncStatus: () => ipcRenderer.invoke('get-sync-status'),
    getDeviceRole: () => ipcRenderer.invoke('get-device-role'),
    setDeviceRole: (role: 'writer' | 'viewer') => ipcRenderer.invoke('set-device-role', role),
    syncViewerNow: () => ipcRenderer.invoke('sync-viewer-now'),
    onDatabaseReplicaUpdated: (callback: EventCallback) => subscribe('database-replica-updated', callback),
  },
  drivers: {
    getAll: () => ipcRenderer.invoke('get-drivers'),
    create: (data: any) => ipcRenderer.invoke('create-driver', data),
    update: (data: any) => ipcRenderer.invoke('update-driver', data),
    toggleActive: (id: number, isActive: boolean) => ipcRenderer.invoke('toggle-driver', id, isActive),
  },
  employees: {
    getAll: () => ipcRenderer.invoke('get-employees'),
    create: (data: any) => ipcRenderer.invoke('create-employee', data),
    update: (data: any) => ipcRenderer.invoke('update-employee', data),
    toggleActive: (id: number, isActive: boolean) => ipcRenderer.invoke('toggle-employee', id, isActive),
  },
  dailyCash: {
    getActiveDay: () => ipcRenderer.invoke('get-active-cash-day'),
    getTransactions: (dayId: number) => ipcRenderer.invoke('get-cash-transactions', dayId),
    addTransaction: (data: any) => ipcRenderer.invoke('add-cash-transaction', data),
    closeDay: (dayId: number) => ipcRenderer.invoke('close-cash-day', dayId),
    reopenDay: (dayId: number) => ipcRenderer.invoke('reopen-cash-day', dayId),
    initializeBalance: (dayId: number, actualBalance: number) =>
      ipcRenderer.invoke('initialize-cash-balance', dayId, actualBalance),
    updateReceipt: (data: { id: number; amount: number; reference_id: number; notes?: string | null }) =>
      ipcRenderer.invoke('update-cash-receipt', data),
    getTransactionsByDateRange: (startDate: string, endDate: string, category?: string) =>
      ipcRenderer.invoke('get-cash-transactions-by-date', startDate, endDate, category),
    getHistoricalZReports: (startDate: string, endDate: string) =>
      ipcRenderer.invoke('get-historical-z-reports', startDate, endDate),
    getDailyReport: (date: string) => ipcRenderer.invoke('get-daily-cash-report', date),
    prepareWhatsAppReport: (date: string) => ipcRenderer.invoke('prepare-daily-cash-whatsapp', date),
    deleteTransaction: (transactionId: number) =>
      ipcRenderer.invoke('delete-cash-transaction', transactionId),
    onDayRolledOver: (callback: EventCallback) => subscribe('cash-day-rolled-over', callback),
    onDayRolloverError: (callback: EventCallback) => subscribe('cash-day-rollover-error', callback),
  },
  billing: {
    getClients: () => ipcRenderer.invoke('billing:getClients'),
    createClient: (data: any) => ipcRenderer.invoke('billing:createClient', data),
    updateClient: (data: any) => ipcRenderer.invoke('billing:updateClient', data),
    getCompanies: (clientId: number) => ipcRenderer.invoke('billing:getCompanies', clientId),
    createCompany: (data: any) => ipcRenderer.invoke('billing:createCompany', data),
    updateCompany: (data: any) => ipcRenderer.invoke('billing:updateCompany', data),
    getStores: (companyId: number) => ipcRenderer.invoke('billing:getStores', companyId),
    createStore: (data: any) => ipcRenderer.invoke('billing:createStore', data),
    updateStore: (data: any) => ipcRenderer.invoke('billing:updateStore', data),
    getAllCompaniesAndStores: () => ipcRenderer.invoke('billing:getAllCompaniesAndStores'),
    getCompanyProfile: (companyId: number) => ipcRenderer.invoke('billing:getCompanyProfile', companyId),
    recordCompanyPayment: (data: any) => ipcRenderer.invoke('billing:recordCompanyPayment', data),
    getInvoices: (startDate?: string, endDate?: string, issuerId?: number) =>
      ipcRenderer.invoke('billing:getInvoices', startDate, endDate, issuerId),
    updateInvoice: (data: any) => ipcRenderer.invoke('billing:updateInvoice', data),
    cancelInvoice: (invoiceId: number, reason: string) => ipcRenderer.invoke('billing:cancelInvoice', { invoiceId, reason }),
    reissueCancelledInvoice: (invoiceId: number) => ipcRenderer.invoke('billing:reissueCancelledInvoice', invoiceId),
    getStats: (issuerId?: number) => ipcRenderer.invoke('billing:getStats', issuerId),
    getIssuers: () => ipcRenderer.invoke('billing:getIssuers'),
    updateIssuer: (data: any) => ipcRenderer.invoke('billing:updateIssuer', data),
    assignCompanyIssuer: (companyId: number, issuerId: number) => ipcRenderer.invoke('billing:assignCompanyIssuer', { companyId, issuerId }),
    getCreditNoteDraft: (invoiceIds?: number[]) => ipcRenderer.invoke('billing:getCreditNoteDraft', invoiceIds),
    createCreditNote: (data: any) => ipcRenderer.invoke('billing:createCreditNote', data),
    getCreditNotes: (filters?: any) => ipcRenderer.invoke('billing:getCreditNotes', filters),
    getCreditNote: (id: number) => ipcRenderer.invoke('billing:getCreditNote', id),
    cancelCreditNote: (id: number, reason: string, acknowledgeAccountingRisk: boolean) => ipcRenderer.invoke('billing:cancelCreditNote', { id, reason, acknowledgeAccountingRisk }),
    applyCompanyCredit: (data: any) => ipcRenderer.invoke('billing:applyCompanyCredit', data),
    reverseCreditApplication: (id: number, reason: string) => ipcRenderer.invoke('billing:reverseCreditApplication', { id, reason }),
    prepareCreditNotePdf: (id: number) => ipcRenderer.invoke('billing:prepareCreditNotePdf', id),
    openCreditNotePdf: (id: number) => ipcRenderer.invoke('billing:openCreditNotePdf', id),
    getSettings: () => ipcRenderer.invoke('billing:getSettings'),
    saveSettings: (data: any) => ipcRenderer.invoke('billing:saveSettings', data),
    getVrBakerStatus: () => ipcRenderer.invoke('billing:getVrBakerStatus'),
    configureVrBakerToken: (token: string) => ipcRenderer.invoke('billing:configureVrBakerToken', token),
    testVrBakerConnection: () => ipcRenderer.invoke('billing:testVrBakerConnection'),
    previewWeeklyInvoices: (startDate: string, endDate: string) =>
      ipcRenderer.invoke('billing:previewWeeklyInvoices', startDate, endDate),
    createWeeklyInvoices: (startDate: string, endDate: string, storeExternalIds: string[]) =>
      ipcRenderer.invoke('billing:createWeeklyInvoices', startDate, endDate, storeExternalIds),
    getProducts: () => ipcRenderer.invoke('billing:getProducts'),
    syncProducts: () => ipcRenderer.invoke('billing:syncProducts'),
    syncEntities: () => ipcRenderer.invoke('billing:syncEntities'),
  },
}

contextBridge.exposeInMainWorld('desktopApi', desktopApi)
