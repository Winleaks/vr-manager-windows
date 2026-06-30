import { ipcMain } from 'electron';
import { stockMovementRepo } from '../database/repositories/stockMovementRepo';

export function registerStockMovementHandlers() {
  ipcMain.handle('get-stock-movements', (_, limit?: number) => {
    return stockMovementRepo.getAll(limit);
  });

  ipcMain.handle('adjust-stock', (_, rawMaterialId: number, newStock: number, reason: string) => {
    return stockMovementRepo.adjustStock(rawMaterialId, newStock, reason);
  });
}
