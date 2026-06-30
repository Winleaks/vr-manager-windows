import { ipcMain } from 'electron';
import { finishedProductRepo } from '../database/repositories/finishedProductRepo';

export function registerFinishedProductHandlers() {
  ipcMain.handle('get-finished-products', () => {
    return finishedProductRepo.getAll();
  });

  ipcMain.handle('get-finished-product', (_, id: number) => {
    return finishedProductRepo.getById(id);
  });

  ipcMain.handle('add-finished-product', (_, data) => {
    return finishedProductRepo.create(data);
  });

  ipcMain.handle('update-finished-product', (_, id: number, data) => {
    return finishedProductRepo.update(id, data);
  });

  ipcMain.handle('delete-finished-product', (_, id: number) => {
    return finishedProductRepo.delete(id);
  });
}
