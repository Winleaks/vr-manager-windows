import * as billingRepo from '../database/repositories/billingRepo';
import { handleTrustedIpc } from './trustedHandler';
import { aggregateWeeklyOrders } from '../integrations/weeklyInvoiceImport';
import { createVrBakerClient, syncVrBakerCatalog, syncVrBakerEntities } from '../integrations/vrBakerIntegration';
import { hasVrBakerApiToken, removeLegacySupabaseCredential, setVrBakerApiToken } from '../integrations/vrBakerCredentials';
import { validateWeeklyPeriod, VR_BAKER_API_ENDPOINT } from '../integrations/vrBakerApiClient';
import { app, shell } from 'electron';
import fs from 'node:fs';
import { generateCreditNotePdf } from '../reports/creditNotePdf';
import { creditNoteFilename, saveCreditNotePdf } from '../reports/creditNoteDelivery';
import { downloadCreditNotePdfFromCloud, uploadCreditNotePdfToCloud } from '../database/cloudSync';

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
    ...billingRepo.getIssuerPreviewByStoreExternalId(group.store.id),
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
  handleTrustedIpc('billing:getInvoices', (_, startDate, endDate, issuerId) => billingRepo.getInvoicesByDateRange(startDate, endDate, issuerId));
  handleTrustedIpc('billing:updateInvoice', (_, data) => billingRepo.updateInvoiceWithItems(data.id, data.invoiceDate, data.items || []));
  handleTrustedIpc('billing:cancelInvoice', (_, data) => billingRepo.cancelInvoice(data.invoiceId, data.reason));
  handleTrustedIpc('billing:reissueCancelledInvoice', (_, invoiceId: number) => billingRepo.reissueCancelledInvoice(invoiceId, new Date().toISOString().slice(0, 10)));
  handleTrustedIpc('billing:getStats', (_, issuerId?: number) => billingRepo.getBillingStats(issuerId));
  handleTrustedIpc('billing:getProducts', () => billingRepo.getCloudProducts());
  handleTrustedIpc('billing:getIssuers', () => billingRepo.getBillingIssuers());
  handleTrustedIpc('billing:updateIssuer', (_, data) => billingRepo.updateBillingIssuer(data));
  handleTrustedIpc('billing:assignCompanyIssuer', (_, data) => billingRepo.assignCompanyIssuer(data.companyId, data.issuerId));
  handleTrustedIpc('billing:getCreditNoteDraft', (_, invoiceIds?: number[]) => billingRepo.readCreditNoteDraft(invoiceIds));
  handleTrustedIpc('billing:createCreditNote', (_, data) => billingRepo.issueCreditNote(data));
  handleTrustedIpc('billing:getCreditNotes', (_, filters?: any) => billingRepo.listCreditNotes(filters));
  handleTrustedIpc('billing:getCreditNote', (_, id: number) => billingRepo.readCreditNote(id));
  handleTrustedIpc('billing:cancelCreditNote', (_, data) => billingRepo.cancelCreditNote(data.id, data.reason, data.acknowledgeAccountingRisk));
  handleTrustedIpc('billing:applyCompanyCredit', (_, data) => billingRepo.applyCompanyCredit(data));
  handleTrustedIpc('billing:reverseCreditApplication', (_, data) => billingRepo.reverseCreditApplication(data.id, data.reason));
  handleTrustedIpc('billing:prepareCreditNotePdf', async (_, id: number) => {
    const note = billingRepo.readCreditNote(id);
    try {
      const pdf = generateCreditNotePdf(note);
      const saved = saveCreditNotePdf(app.getPath('documents'), note.issuer_code, note.reference, pdf);
      billingRepo.setCreditNotePdfState(id, saved.filePath, 'ready', 'pending');
      const cloud = await uploadCreditNotePdfToCloud(saved.filename, note.issuer_code, pdf);
      billingRepo.setCreditNotePdfState(id, saved.filePath, 'ready', cloud.success ? 'ready' : 'error');
      return { success: true, ...saved, cloud };
    } catch (error) {
      billingRepo.setCreditNotePdfState(id, null, 'error', 'error');
      return { success: false, message: message(error) };
    }
  });
  handleTrustedIpc('billing:openCreditNotePdf', async (_, id: number) => {
    const note = billingRepo.readCreditNote(id);
    let filePath = note.pdf_path && fs.existsSync(note.pdf_path) ? note.pdf_path : null;
    if (!filePath) {
      const cloud = await downloadCreditNotePdfFromCloud(creditNoteFilename(note.reference), note.issuer_code);
      if (cloud.success && cloud.buffer) filePath = saveCreditNotePdf(app.getPath('documents'), note.issuer_code, note.reference, cloud.buffer).filePath;
      else return { success: false, notFound: true, message: cloud.error };
    }
    const error = await shell.openPath(filePath);
    return error ? { success: false, message: error } : { success: true, filePath };
  });

  handleTrustedIpc('billing:getSettings', () => {
    const defaultIssuer = billingRepo.getBillingIssuers().find((issuer) => issuer.is_default === 1);
    return {
      ...(defaultIssuer?.settings || {}),
      invoiceStartNumber: String(defaultIssuer?.next_invoice_number || 1),
      invoiceLogo: billingRepo.getAppSetting('invoice_logo') || '',
    };
  });

  handleTrustedIpc('billing:saveSettings', (_, data) => {
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
          issuerId: byStore.get(group.store.id)?.issuerId,
          issuerSettings: byStore.get(group.store.id)?.issuerSettings,
          issuerName: byStore.get(group.store.id)?.issuerSettings.issuerName,
          issuerCode: byStore.get(group.store.id)?.issuerSettings.code,
          issuerColor: byStore.get(group.store.id)?.issuerSettings.invoiceColor,
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
