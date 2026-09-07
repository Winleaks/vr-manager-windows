import { finishedProductRepo } from '../database/repositories/finishedProductRepo';
import { handleTrustedIpc } from './trustedHandler';
import { syncVrBakerCatalog } from '../integrations/vrBakerIntegration';

export function registerFinishedProductHandlers() {
  handleTrustedIpc('get-finished-products', () => {
    return finishedProductRepo.getAll();
  });

  handleTrustedIpc('get-finished-product', (_, id: number) => {
    return finishedProductRepo.getById(id);
  });

  handleTrustedIpc('sync-finished-products', async () => {
    try {
      const syncResult = await syncVrBakerCatalog();
      const result = syncResult.finishedProducts;
      return {
        success: true,
        result,
        message: `${result.received} produse au fost actualizate din VR Baker Platform. ${result.archivedManual} produse manuale au fost arhivate.`,
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Produsele nu au putut fi actualizate.',
      };
    }
  });
}
