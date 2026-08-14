import * as billingRepo from '../database/repositories/billingRepo';
import { getVrBakerApiToken } from './vrBakerCredentials';
import { VrBakerApiClient } from './vrBakerApiClient';

export function createVrBakerClient(tokenOverride?: string) {
  const token = tokenOverride || getVrBakerApiToken();
  if (!token) throw new Error('Tokenul VR Baker Platform nu este configurat pe calculatorul Writer.');
  return new VrBakerApiClient(token);
}

export async function syncVrBakerCatalog() {
  const products = await createVrBakerClient().fetchProducts();
  return billingRepo.syncProductsFromVrBaker(products);
}

export async function syncVrBakerEntities() {
  const client = createVrBakerClient();
  const [companies, stores] = await Promise.all([client.fetchCompanies(), client.fetchStores()]);
  return billingRepo.syncEntitiesFromVrBaker(companies, stores);
}
