import { db } from '../database/db';
import { publishBilling } from '../integrations/billingPublisher';
import { getInvoiceSettings } from '../database/invoiceSettings';
import * as billingRepo from '../database/repositories/billingRepo';
import { handleTrustedIpc } from './trustedHandler';
import { aggregateWeeklyOrders } from '../integrations/weeklyInvoiceImport';
import { createVrBakerClient, syncVrBakerCatalog, syncVrBakerEntities } from '../integrations/vrBakerIntegration';
import { hasVrBakerApiToken, removeLegacySupabaseCredential, setVrBakerApiToken } from '../integrations/vrBakerCredentials';
import { validateWeeklyPeriod, VR_BAKER_API_ENDPOINT } from '../integrations/vrBakerApiClient';

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Operațiunea a eșuat.';
}

function setting(key: string, value: unknown) {
  billingRepo.setAppSetting(key, value === undefined || value === null ? '' : String(value));
}

async function prepareWeeklyPreview(startDate: string, endDate: string) {
  validateWeeklyPeriod(startDate, endDate);
  const client = createVrBakerClient();
  const [orders, companies, stores, products] = await Promise.all([
    client.fetchWeeklyOrders(startDate, endDate),
    client.fetchCompanies(),
    client.fetchStores(),
    client.fetchProducts(),
  ]);
  billingRepo.syncEntitiesFromVrBaker(companies, stores);
  billingRepo.syncProductsFromVrBaker(products);
  return aggregateWeeklyOrders(orders).map((group) => ({
    ...group,
    ...billingRepo.getWeeklyImportState(group.store.id, startDate, endDate, group.sourceFingerprint),
  }));
}

export function registerBillingHandlers() {
  handleTrustedIpc('billing:publicationStatus', () => ({identity:db.prepare('SELECT source_id FROM billing_publication_identity WHERE id=1').get(),pending:db.prepare(`SELECT q.company_id,c.name,q.revision,q.published_revision,q.last_error FROM billing_publication_queue q LEFT JOIN companies c ON c.id=q.company_id WHERE q.revision>q.published_revision`).all()}));
  handleTrustedIpc('billing:publishNow', async () => { db.prepare('UPDATE billing_publication_queue SET retry_at=0').run(); await publishBilling(); return true; });
  handleTrustedIpc('billing:getClients', () => billingRepo.getClients());
  handleTrustedIpc('billing:createClient', (_, data) => billingRepo.createClient(data.name, data.supabaseClientId));
  handleTrustedIpc('billing:updateClient', (_, data) => {
    billingRepo.updateClient(data.id, data.name, data.supabaseClientId, data.isActive);
    return true;
  });
  handleTrustedIpc('billing:getCompanies', (_, clientId) => billingRepo.getCompaniesByClientId(clientId));
  handleTrustedIpc('billing:createCompany', (_, data) => billingRepo.createCompany(data.clientId, data.name, data.cui, data.regCom, data.address, data.bankAccount, data.bankName));
  handleTrustedIpc('billing:updateCompany', (_, data) => {
    billingRepo.updateCompany(data.id, data.name, data.cui, data.regCom, data.address, data.bankAccount, data.bankName, data.isActive);
    return true;
  });
  handleTrustedIpc('billing:getStores', (_, companyId) => billingRepo.getStoresByCompanyId(companyId));
  handleTrustedIpc('billing:createStore', (_, data) => billingRepo.createStore(data.companyId, data.name, data.address, data.supabaseStoreId));
  handleTrustedIpc('billing:updateStore', (_, data) => {
    billingRepo.updateStore(data.id, data.name, data.address, data.supabaseStoreId, data.isActive);
    return true;
  });
  handleTrustedIpc('billing:getAllCompaniesAndStores', () => billingRepo.getAllCompaniesAndStores());
  handleTrustedIpc('billing:getCompanyProfile', (_, companyId) => billingRepo.getCompanyProfileDetails(companyId));
  handleTrustedIpc('billing:recordCompanyPayment', (_, data) => billingRepo.recordCompanyPayment(data));
  handleTrustedIpc('billing:getInvoices', (_, startDate, endDate) => billingRepo.getInvoicesByDateRange(startDate, endDate));
  handleTrustedIpc('billing:updateInvoice', (_, data) => billingRepo.updateInvoiceWithItems(data.id, data.invoiceNumber, data.invoiceDate, data.items || []));
  handleTrustedIpc('billing:deleteInvoice', (_, invoiceId: number) => billingRepo.deleteInvoice(invoiceId));
  handleTrustedIpc('billing:getStats', () => billingRepo.getBillingStats());
  handleTrustedIpc('billing:getProducts', () => billingRepo.getCloudProducts());

  handleTrustedIpc('billing:getSettings', () => getInvoiceSettings());

  handleTrustedIpc('billing:saveSettings', (_, data) => {
    if (data.invoiceDriveFolderId !== undefined) {
      const folder = String(data.invoiceDriveFolderId).trim();
      if (folder && !/^[A-Za-z0-9_-]{10,200}$/.test(folder)) throw new Error('ID-ul folderului Drive este invalid.');
      setting('invoice_drive_folder_id', folder);
    }
    setting('invoice_series', data.invoiceSeries);
    setting('invoice_start_number', data.invoiceStartNumber);
    setting('issuer_name', data.issuerName);
    setting('issuer_address', data.issuerAddress);
    setting('issuer_crn', data.issuerCrn);
    setting('issuer_vat', data.issuerVat);
    setting('invoice_bank_name_1', data.invoiceBankName1);
    setting('invoice_account_number', data.invoiceAccountNumber);
    setting('invoice_sort_code', data.invoiceSortCode);
    setting('invoice_bank_name_2', data.invoiceBankName2);
    setting('invoice_account_number_2', data.invoiceAccountNumber2);
    setting('invoice_sort_code_2', data.invoiceSortCode2);
    setting('invoice_footer', data.invoiceFooter);
    setting('invoice_color', data.invoiceColor);
    setting('invoice_alternate_row_color', data.invoiceAlternateRowColor);
    setting('invoice_alternate_row_opacity', data.invoiceAlternateRowOpacity);
    setting('invoice_logo', data.invoiceLogo);
    return true;
  });

  handleTrustedIpc('billing:getVrBakerStatus', () => ({ endpoint: VR_BAKER_API_ENDPOINT, hasToken: hasVrBakerApiToken() }));
  handleTrustedIpc('billing:configureVrBakerToken', async (_, token: string) => {
    try {
      const client = createVrBakerClient(token?.trim());
      await client.health();
      setVrBakerApiToken(token);
      removeLegacySupabaseCredential();
      for (const key of ['supabase_url', 'supabase_key', 'supabase_email']) billingRepo.deleteAppSetting(key);
      return { success: true, message: 'Tokenul VR Baker Platform a fost verificat și salvat securizat.' };
    } catch (error) {
      return { success: false, message: message(error) };
    }
  });
  handleTrustedIpc('billing:testVrBakerConnection', async () => {
    try {
      await createVrBakerClient().health();
      return { success: true, message: 'Conexiunea cu VR Baker Platform funcționează.' };
    } catch (error) {
      return { success: false, message: message(error) };
    }
  });

  handleTrustedIpc('billing:previewWeeklyInvoices', async (_, startDate: string, endDate: string) => {
    try {
      const ordersByStore = await prepareWeeklyPreview(startDate, endDate);
      return { success: true, message: `Au fost găsite ${ordersByStore.length} magazine cu comenzi open/locked.`, ordersByStore };
    } catch (error) {
      return { success: false, message: message(error), ordersByStore: [] };
    }
  });

  handleTrustedIpc('billing:createWeeklyInvoices', async (_, startDate: string, endDate: string, storeExternalIds: string[]) => {
    try {
      if (!Array.isArray(storeExternalIds) || storeExternalIds.length === 0 || storeExternalIds.length > 500) throw new Error('Selecția magazinelor este invalidă.');
      const requested = new Set(storeExternalIds);
      const groups = (await prepareWeeklyPreview(startDate, endDate)).filter((group) => requested.has(group.store.id));
      if (groups.length !== requested.size) throw new Error('Unele magazine selectate nu mai există în exportul actual.');
      const changed = groups.find((group) => group.billingState !== 'ready');
      if (changed) throw new Error(changed.billingState === 'source_changed' ? 'Sursa unei facturi emise s-a modificat; este necesară rezolvare manuală.' : 'Factura pentru unul dintre magazine există deja.');
      const prepared = groups.map((group) => {
        const storeId = billingRepo.getStoreBySupabaseId(group.store.id);
        if (!storeId) throw new Error(`Magazinul „${group.store.name}” nu a fost mapat local.`);
        return {
          storeId,
          storeExternalId: group.store.id,
          periodStart: startDate,
          periodEnd: endDate,
          sourceFingerprint: group.sourceFingerprint,
          sourceOrders: group.sourceOrders,
          items: group.items,
        };
      });
      const invoiceDate = new Date().toISOString().slice(0, 10);
      const created = billingRepo.createWeeklyInvoices(prepared, invoiceDate);
      const byStore = new Map(created.map((row) => [row.storeExternalId, row]));
      return {
        success: true,
        updatedOrders: groups.map((group) => ({
          ...group,
          billingState: 'invoiced',
          assignedInvoiceId: byStore.get(group.store.id)?.invoiceId,
          assignedInvoiceNumber: byStore.get(group.store.id)?.invoiceNumber,
          assignedInvoiceDate: invoiceDate,
        })),
      };
    } catch (error) {
      return { success: false, message: message(error) };
    }
  });

  handleTrustedIpc('billing:syncProducts', async () => {
    try {
      const count = await syncVrBakerCatalog();
      return { success: true, message: `${count} produse au fost sincronizate din VR Baker Platform.` };
    } catch (error) { return { success: false, message: message(error) }; }
  });
  handleTrustedIpc('billing:syncEntities', async () => {
    try {
      const result = await syncVrBakerEntities();
      return { success: true, message: `${result.companies} companii și ${result.stores} magazine au fost sincronizate.` };
    } catch (error) { return { success: false, message: message(error) }; }
  });
}
