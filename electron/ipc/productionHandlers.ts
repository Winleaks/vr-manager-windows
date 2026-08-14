import { productionRepo } from '../database/repositories/productionRepo';
import { handleTrustedIpc } from './trustedHandler';

export function registerProductionHandlers() {
  handleTrustedIpc('get-productions', () => {
    return productionRepo.getAll();
  });

  handleTrustedIpc('add-production', (_, productId: number, quantity: number, date: string, notes: string) => {
    return productionRepo.create(productId, quantity, date, notes);
  });
}
