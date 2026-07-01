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
    saveFile: (options: { buffer: Uint8Array, defaultPath: string, filters: any[] }) =>
      window.ipcRenderer.invoke('save-file', options),
    manualBackup: () => window.ipcRenderer.invoke('manual-backup'),
    restoreBackup: () => window.ipcRenderer.invoke('restore-backup'),
    getLastBackupTime: () => window.ipcRenderer.invoke('get-last-backup-time'),
    checkForUpdates: () => window.ipcRenderer.invoke('check-for-updates'),
    onBackupCompleted: (callback: () => void) => window.ipcRenderer.on('backup-completed', callback)
  }
}

declare global {
  interface Window {
    ipcRenderer: {
      invoke(channel: string, ...args: any[]): Promise<any>;
      on(channel: string, listener: (...args: any[]) => void): void;
      off(channel: string, listener: (...args: any[]) => void): void;
    }
  }
}
