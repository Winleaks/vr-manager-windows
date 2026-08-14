import { stockMovementRepo } from '../database/repositories/stockMovementRepo';
import { handleTrustedIpc } from './trustedHandler';

export function registerStockMovementHandlers() {
  handleTrustedIpc('get-stock-movements', (_, limit?: number) => {
    return stockMovementRepo.getAll(limit);
  });

  handleTrustedIpc('adjust-stock', (_, rawMaterialId: number, newStock: number, reason: string) => {
    return stockMovementRepo.adjustStock(rawMaterialId, newStock, reason);
  });
}
