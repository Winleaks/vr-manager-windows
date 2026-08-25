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
  const orders = await client.fetchWeeklyOrders(startDate, endDate);
  const stores = [...new Map(orders.map((order) => [order.store.id, order.store])).values()];
  const companies = [...new Map(stores.flatMap((store) => store.company ? [[store.company.id, store.company] as const] : [])).values()];
  billingRepo.syncEntitiesFromVrBaker(companies, stores);
  return aggregateWeeklyOrders(orders).map((group) => ({
    ...group,
    ...billingRepo.getWeeklyImportState(group.store.id, startDate, endDate, group.sourceFingerprint),
  }));
}

export function registerBillingHandlers() {
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

  handleTrustedIpc('billing:getSettings', () => ({
    invoiceSeries: billingRepo.getAppSetting('invoice_series') || 'FACT',
    invoiceStartNumber: billingRepo.getAppSetting('invoice_start_number') || '1',
    issuerName: billingRepo.getAppSetting('issuer_name') || '',
    issuerAddress: billingRepo.getAppSetting('issuer_address') || '',
    issuerCrn: billingRepo.getAppSetting('issuer_crn') || '',
    issuerVat: billingRepo.getAppSetting('issuer_vat') || '',
    invoiceBankName1: billingRepo.getAppSetting('invoice_bank_name_1') || billingRepo.getAppSetting('invoice_bank_name') || '',
    invoiceAccountNumber: billingRepo.getAppSetting('invoice_account_number') || '',
    invoiceSortCode: billingRepo.getAppSetting('invoice_sort_code') || '',
    invoiceBankName2: billingRepo.getAppSetting('invoice_bank_name_2') || '',
    invoiceAccountNumber2: billingRepo.getAppSetting('invoice_account_number_2') || '',
    invoiceSortCode2: billingRepo.getAppSetting('invoice_sort_code_2') || '',
    invoiceFooter: billingRepo.getAppSetting('invoice_footer') || '',
    invoiceColor: billingRepo.getAppSetting('invoice_color') || '#4F46E5',
    invoiceAlternateRowColor: billingRepo.getAppSetting('invoice_alternate_row_color') || '#4F46E5',
    invoiceAlternateRowOpacity: Number(billingRepo.getAppSetting('invoice_alternate_row_opacity') || 5),
    invoiceLogo: billingRepo.getAppSetting('invoice_logo') || '',
  }));

  handleTrustedIpc('billing:saveSettings', (_, data) => {
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
      const result = await syncVrBakerCatalog();
      return { success: true, message: `${result.received} produse au fost sincronizate o singură dată pentru producție și facturare.` };
    } catch (error) { return { success: false, message: message(error) }; }
  });
  handleTrustedIpc('billing:syncEntities', async () => {
    try {
      const result = await syncVrBakerEntities();
      return { success: true, message: `${result.companies} companii și ${result.stores} magazine au fost sincronizate.` };
    } catch (error) { return { success: false, message: message(error) }; }
  });
}
