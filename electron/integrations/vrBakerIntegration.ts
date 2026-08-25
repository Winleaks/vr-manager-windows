import * as billingRepo from '../database/repositories/billingRepo';
import { db } from '../database/db';
import { finishedProductRepo } from '../database/repositories/finishedProductRepo';
import { getVrBakerApiToken } from './vrBakerCredentials';
import { VrBakerApiClient } from './vrBakerApiClient';

export function createVrBakerClient(tokenOverride?: string) {
  const token = tokenOverride || getVrBakerApiToken();
  if (!token) throw new Error('Tokenul VR Baker Platform nu este configurat pe calculatorul Writer.');
  return new VrBakerApiClient(token);
}

export async function syncVrBakerCatalog() {
  const products = await createVrBakerClient().fetchProducts();
  return db.transaction(() => ({
    received: products.length,
    finishedProducts: finishedProductRepo.syncFromVrBaker(products),
    billingProducts: billingRepo.syncProductsFromVrBaker(products),
  }))();
}

export async function syncVrBakerEntities() {
  const client = createVrBakerClient();
  const [companies, stores] = await Promise.all([client.fetchCompanies(), client.fetchStores()]);
  return billingRepo.syncEntitiesFromVrBaker(companies, stores);
}
