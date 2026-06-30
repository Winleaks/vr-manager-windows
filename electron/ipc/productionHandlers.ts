import { ipcMain } from 'electron';
import { productionRepo } from '../database/repositories/productionRepo';

export function registerProductionHandlers() {
  ipcMain.handle('get-productions', () => {
    return productionRepo.getAll();
  });

  ipcMain.handle('add-production', (_, productId: number, quantity: number, date: string, notes: string) => {
    return productionRepo.create(productId, quantity, date, notes);
  });
}
