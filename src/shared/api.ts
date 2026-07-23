export const api = {
  rawMaterials: {
    getAll: () => window.ipcRenderer.invoke('get-raw-materials'),
    add: (rm: any) => window.ipcRenderer.invoke('add-raw-material', rm),
    update: (id: number, rm: any) => window.ipcRenderer.invoke('update-raw-material', id, rm)
  },
  categories: {
    get: (type?: string) => window.ipcRenderer.invoke('get-categories', type),
    add: (name: string, type: string) => window.ipcRenderer.invoke('add-category', name, type),
    update: (id: number, name: string) => window.ipcRenderer.invoke('update-category', id, name),
    delete: (id: number) => window.ipcRenderer.invoke('delete-category', id)
  },
  finishedProducts: {
    getAll: () => window.ipcRenderer.invoke('get-finished-products'),
    getById: (id: number) => window.ipcRenderer.invoke('get-finished-product', id),
    add: (data: any) => window.ipcRenderer.invoke('add-finished-product', data),
    update: (id: number, data: any) => window.ipcRenderer.invoke('update-finished-product', id, data),
    delete: (id: number) => window.ipcRenderer.invoke('delete-finished-product', id)
  },
  recipes: {
    getByProductId: (productId: number) => window.ipcRenderer.invoke('get-recipe', productId),
    save: (productId: number, batchSize: number, notes: string, items: any[]) => 
      window.ipcRenderer.invoke('save-recipe', productId, batchSize, notes, items)
  },
  productions: {
    getAll: () => window.ipcRenderer.invoke('get-productions'),
    add: (productId: number, quantity: number, date: string, notes: string) => 
      window.ipcRenderer.invoke('add-production', productId, quantity, date, notes)
  },
  stockMovements: {
    getAll: (limit?: number) => window.ipcRenderer.invoke('get-stock-movements', limit),
    adjustStock: (rawMaterialId: number, newStock: number, reason: string) => 
      window.ipcRenderer.invoke('adjust-stock', rawMaterialId, newStock, reason)
  },
  system: {
    getAppVersion: () => window.ipcRenderer?.invoke('system:getAppVersion') || Promise.resolve('0.1.70'),
    saveFile: (options: { buffer: Uint8Array, defaultPath: string, filters: any[] }) =>
      window.ipcRenderer.invoke('save-file', options),
    savePdfAuto: (options: { buffer: Uint8Array, filename: string }) =>
      window.ipcRenderer.invoke('save-pdf-auto', options),
    openPdfFile: (filename: string) =>
      window.ipcRenderer.invoke('open-pdf-file', filename),
    deletePdfAuto: (filename: string) =>
      window.ipcRenderer.invoke('delete-pdf-auto', filename),
    manualBackup: () => window.ipcRenderer.invoke('manual-backup'),
    restoreBackup: () => window.ipcRenderer.invoke('restore-backup'),
    getLastBackupTime: () => window.ipcRenderer.invoke('get-last-backup-time'),
    checkForUpdates: () => window.ipcRenderer.invoke('check-for-updates'),
    startUpdateDownload: () => window.ipcRenderer.invoke('start-update-download'),
    installUpdate: () => window.ipcRenderer.invoke('install-update'),
    onUpdateAvailable: (callback: (info: any) => void) => window.ipcRenderer.on('update-available', callback),
    onUpdateProgress: (callback: (progressObj: any) => void) => window.ipcRenderer.on('update-progress', callback),
    onUpdateDownloaded: (callback: (info: any) => void) => window.ipcRenderer.on('update-downloaded', callback),
    onUpdateError: (callback: (err: string) => void) => window.ipcRenderer.on('update-error', callback),
    onBackupCompleted: (callback: () => void) => window.ipcRenderer.on('backup-completed', callback),
    onGoogleAuthUrl: (callback: (url: string) => void) => window.ipcRenderer.on('google-auth-url', callback),
    getCloudStatus: () => window.ipcRenderer.invoke('get-cloud-status'),
    connectGoogleDrive: () => window.ipcRenderer.invoke('connect-google-drive'),
    saveToCloud: () => window.ipcRenderer.invoke('save-to-cloud'),
    restoreFromCloud: (filePath?: string) => window.ipcRenderer.invoke('restore-from-cloud', filePath),
    disconnectCloud: () => window.ipcRenderer.invoke('disconnect-cloud'),
    uploadPdfToCloud: (filename: string, buffer: Uint8Array) => window.ipcRenderer.invoke('upload-pdf-to-cloud', filename, buffer),
    getSyncStatus: () => window.ipcRenderer.invoke('get-sync-status'),
    initRealtimeSync: () => window.ipcRenderer.invoke('init-realtime-sync'),
    onSyncStatusChanged: (callback: (status: any) => void) => window.ipcRenderer.on('sync-status-changed', callback),
    onRealtimeDataUpdated: (callback: (data: any) => void) => window.ipcRenderer.on('realtime-data-updated', callback)
  },
  drivers: {
    getAll: () => window.ipcRenderer.invoke('get-drivers'),
    create: (data: any) => window.ipcRenderer.invoke('create-driver', data),
    update: (data: any) => window.ipcRenderer.invoke('update-driver', data),
    toggleActive: (id: number, isActive: boolean) => window.ipcRenderer.invoke('toggle-driver', id, isActive)
  },
  employees: {
    getAll: () => window.ipcRenderer.invoke('get-employees'),
    create: (data: any) => window.ipcRenderer.invoke('create-employee', data),
    update: (data: any) => window.ipcRenderer.invoke('update-employee', data),
    toggleActive: (id: number, isActive: boolean) => window.ipcRenderer.invoke('toggle-employee', id, isActive)
  },
  dailyCash: {
    getActiveDay: () => window.ipcRenderer.invoke('get-active-cash-day'),
    getTransactions: (dayId: number) => window.ipcRenderer.invoke('get-cash-transactions', dayId),
    addTransaction: (data: any) => window.ipcRenderer.invoke('add-cash-transaction', data),
    closeDay: (dayId: number, finalBalance: number) => window.ipcRenderer.invoke('close-cash-day', dayId, finalBalance),
    getTransactionsByDateRange: (startDate: string, endDate: string, category?: string) => 
      window.ipcRenderer.invoke('get-cash-transactions-by-date', startDate, endDate, category),
    getHistoricalZReports: (startDate: string, endDate: string) => 
      window.ipcRenderer.invoke('get-historical-z-reports', startDate, endDate),
    deleteTransaction: (transactionId: number) => 
      window.ipcRenderer.invoke('delete-cash-transaction', transactionId)
  },
  billing: {
    getClients: () => window.ipcRenderer.invoke('billing:getClients'),
    createClient: (data: any) => window.ipcRenderer.invoke('billing:createClient', data),
    updateClient: (data: any) => window.ipcRenderer.invoke('billing:updateClient', data),
    getCompanies: (clientId: number) => window.ipcRenderer.invoke('billing:getCompanies', clientId),
    createCompany: (data: any) => window.ipcRenderer.invoke('billing:createCompany', data),
    updateCompany: (data: any) => window.ipcRenderer.invoke('billing:updateCompany', data),
    getStores: (companyId: number) => window.ipcRenderer.invoke('billing:getStores', companyId),
    createStore: (data: any) => window.ipcRenderer.invoke('billing:createStore', data),
    updateStore: (data: any) => window.ipcRenderer.invoke('billing:updateStore', data),
    getAllCompaniesAndStores: () => window.ipcRenderer.invoke('billing:getAllCompaniesAndStores'),
    getCompanyProfile: (companyId: number) => window.ipcRenderer.invoke('billing:getCompanyProfile', companyId),
    recordCompanyPayment: (data: any) => window.ipcRenderer.invoke('billing:recordCompanyPayment', data),
    getInvoices: (startDate?: string, endDate?: string) => window.ipcRenderer.invoke('billing:getInvoices', startDate, endDate),
    updateInvoice: (data: any) => window.ipcRenderer.invoke('billing:updateInvoice', data),
    generateInvoice: (data: any) => window.ipcRenderer.invoke('billing:generateInvoice', data),
    deleteInvoice: (invoiceId: number) => window.ipcRenderer.invoke('billing:deleteInvoice', invoiceId),
    getStats: () => window.ipcRenderer.invoke('billing:getStats'),
    getSettings: () => window.ipcRenderer.invoke('billing:getSettings'),
    saveSettings: (data: any) => window.ipcRenderer.invoke('billing:saveSettings', data),
    syncSupabaseOrders: (startDate: string, endDate: string) => window.ipcRenderer.invoke('billing:syncSupabaseOrders', startDate, endDate),
    createInvoicesFromSync: (orders: any[]) => window.ipcRenderer.invoke('billing:createInvoicesFromSync', orders),
    getProducts: () => window.ipcRenderer.invoke('billing:getProducts'),
    syncProducts: () => window.ipcRenderer.invoke('billing:syncProducts'),
    syncEntities: () => window.ipcRenderer.invoke('billing:syncEntities')
  }
}


declare global {
  interface Window {
    ipcRenderer: {
      invoke(channel: string, ...args: any[]): Promise<any>;
      on(channel: string, listener: (...args: any[]) => void): () => void;
      off(channel: string, listener: (...args: any[]) => void): void;
    }
  }
}
