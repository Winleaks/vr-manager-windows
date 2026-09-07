import * as billingRepo from '../database/repositories/billingRepo';
import { db, dbPath, createVerifiedSnapshot } from '../database/db';
import { dialog } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isBillingPublishing } from './billingPublisher';
import { synchronizeEntitiesWithRepair } from './entityRepairCoordinator';
import { finishedProductRepo } from '../database/repositories/finishedProductRepo';
import { getVrBakerApiToken } from './vrBakerCredentials';
import { VrBakerApiClient } from './vrBakerApiClient';
import { getDeviceRole } from '../device/deviceRole';

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
  const connection = db;
  if (getDeviceRole() !== 'writer') throw new Error('Numai Writer poate sincroniza entitățile.');
  const client = createVrBakerClient();
  return synchronizeEntitiesWithRepair({
    connection,
    assertCurrent: () => {
      if (connection !== db || getDeviceRole() !== 'writer') throw new Error('Baza de date sau rolul s-a schimbat. Reia sincronizarea.');
      if (isBillingPublishing()) throw new Error('Publicarea facturilor este în curs. Reia sincronizarea după finalizarea ei.');
    },
    fetchSnapshot: () => client.fetchEntitySnapshot(),
    confirm: async plan => (await dialog.showMessageBox({type:'question',title:'Confirmă repararea asocierilor',
      message:'Platforma a confirmat următoarele asocieri. Aplici repararea istoricului local?',
      detail:plan.moves.map(move=>`${move.storeName}${move.toStoreName ? ` → ${move.toStoreName}` : ''} → ${move.toCompanyName}\nFacturi: ${move.invoices.map(i=>i.invoice_number).join(', ') || 'niciuna'}`).join('\n\n') + '\n\nSe creează mai întâi un backup verificat. Numerele, produsele și sumele facturilor nu se schimbă.',
      buttons:['Anulează','Aplică repararea'],defaultId:0,cancelId:0,noLink:true})).response === 1,
    backup: () => createVerifiedSnapshot(path.join(path.dirname(dbPath),'backups',`before-entity-repair-${Date.now()}-${randomUUID()}.db`)),
    synchronize: ({companies,stores}) => billingRepo.syncEntitiesFromVrBaker(companies,stores,{complete:true}),
  });
}
