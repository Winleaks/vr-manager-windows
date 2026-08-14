import { finishedProductRepo } from '../database/repositories/finishedProductRepo';
import { handleTrustedIpc } from './trustedHandler';

export function registerFinishedProductHandlers() {
  handleTrustedIpc('get-finished-products', () => {
    return finishedProductRepo.getAll();
  });

  handleTrustedIpc('get-finished-product', (_, id: number) => {
    return finishedProductRepo.getById(id);
  });

  handleTrustedIpc('add-finished-product', (_, data) => {
    return finishedProductRepo.create(data);
  });

  handleTrustedIpc('update-finished-product', (_, id: number, data) => {
    return finishedProductRepo.update(id, data);
  });

  handleTrustedIpc('delete-finished-product', (_, id: number) => {
    return finishedProductRepo.delete(id);
  });
}
