import * as billingRepo from '../database/repositories/billingRepo';
import { isBillingPublishing } from '../integrations/billingPublisher';
import { handleTrustedIpc } from './trustedHandler';
import { aggregateWeeklyOrders } from '../integrations/weeklyInvoiceImport';
import { createVrBakerClient, syncVrBakerCatalog, syncVrBakerEntities } from '../integrations/vrBakerIntegration';
import { hasVrBakerApiToken, removeLegacySupabaseCredential, setVrBakerApiToken } from '../integrations/vrBakerCredentials';
import { validateWeeklyPeriod, VR_BAKER_API_ENDPOINT, type VrBakerZone } from '../integrations/vrBakerApiClient';
import { app, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { generateCreditNotePdf } from '../reports/creditNotePdf';
import { creditNoteFilename, saveCreditNotePdf } from '../reports/creditNoteDelivery';
import { localClientDocumentDirectory } from '../reports/clientDocumentStorage';
import { validatePdfFilename } from '../security/fileValidation';
import {
  deleteClientFinancialDocumentFromCloud,
  downloadCreditNotePdfFromCloud,
  uploadCreditNotePdfToCloud,
} from '../database/cloudSync';
import { db, backupDb } from '../database/db';
import { selectReadyGroupsForZone } from '../integrations/weeklyZoneBilling';
import {
  assertNormalStoreAllowed,
  filterNormalWeeklyGroups,
  getNormalManualInvoiceCompanies,
  loadProtectedRoutingPolicy,
  withRegistryRoutingLock,
} from '../protectedRegistry/service';
import { assignEstimatedInvoiceReferences } from '../../src/utils/invoicePreviewNumbering';
import { priceInvoiceCatalog } from '../integrations/invoiceCatalogPricing';

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Operațiunea a eșuat.';
}

function setting(key: string, value: unknown) {
  billingRepo.setAppSetting(key, value === undefined || value === null ? '' : String(value));
}

async function prepareWeeklyPreview(startDate: string, endDate: string) {
  validateWeeklyPeriod(startDate, endDate);
  const client = createVrBakerClient();
  const snapshot = await client.fetchWeeklyBillingSnapshot(startDate, endDate);
  const { orders, zones } = snapshot;
  const stores = [...new Map(orders.map((order) => [order.store.id, order.store])).values()];
  const companies = [...new Map(stores.flatMap((store) => store.company ? [[store.company.id, store.company] as const] : [])).values()];
  billingRepo.syncEntitiesFromVrBaker(companies, stores);
  const visibleGroups = await filterNormalWeeklyGroups(aggregateWeeklyOrders(orders));
  const ordersByStore = assignEstimatedInvoiceReferences(visibleGroups.map((group) => ({
    ...group,
    ...billingRepo.getIssuerPreviewByStoreExternalId(group.store.id),
    ...billingRepo.getWeeklyImportState(group.store.id, startDate, endDate, group.sourceFingerprint),
  })));
  return { ordersByStore, zones };
}

type PreparedWeeklyPreview = Awaited<ReturnType<typeof prepareWeeklyPreview>>;
type PreparedWeeklyGroup = PreparedWeeklyPreview['ordersByStore'][number];

async function issueWeeklyGroups(
  groups: PreparedWeeklyGroup[],
  startDate: string,
  endDate: string,
  zone?: VrBakerZone | null,
) {
  if (groups.length === 0 || groups.length > 500) throw new Error('Lotul de facturi este gol sau depășește limita permisă.');
  const changed = groups.find((group) => group.billingState !== 'ready');
  if (changed) throw new Error(changed.billingState === 'source_changed' ? 'Sursa unei facturi emise s-a modificat; este necesară rezolvare manuală.' : 'Factura pentru unul dintre magazine există deja.');
  const allowedGroups = await filterNormalWeeklyGroups(groups);
  if (allowedGroups.length !== groups.length) throw new Error('Unul dintre magazine a fost mutat în registrul separat. Reîncarcă previzualizarea.');
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
  const auditContext = zone === undefined ? undefined : {
    kind: 'zone' as const,
    zoneId: zone?.id ?? null,
    zoneName: zone?.name ?? 'FĂRĂ ZONĂ ALOCATĂ',
    driverId: zone?.driver?.id ?? null,
    driverName: zone?.driver?.name ?? null,
    storeCount: groups.length,
  };
  const created = billingRepo.createWeeklyInvoices(prepared, invoiceDate, auditContext);
  const byStore = new Map(created.map((row) => [row.storeExternalId, row]));
  return groups.map((group) => ({
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
    issuerInvoiceSeries: byStore.get(group.store.id)?.issuerSettings.invoiceSeries,
    issuerNextInvoiceNumber: (() => {
      const reference = byStore.get(group.store.id)?.invoiceNumber || '';
      const sequence = Number(reference.match(/(\d+)$/)?.[1]);
      return Number.isSafeInteger(sequence) ? sequence + 1 : group.issuerNextInvoiceNumber;
    })(),
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
  handleTrustedIpc('billing:getManualInvoiceCompanies', () => getNormalManualInvoiceCompanies());
  handleTrustedIpc('billing:getCompanyProfile', (_, companyId) => billingRepo.getCompanyProfileDetails(companyId));
  handleTrustedIpc('billing:recordCompanyPayment', (_, data) => billingRepo.recordCompanyPayment(data));
  handleTrustedIpc('billing:updatePayment', (_, data) => billingRepo.updatePayment(data));
  handleTrustedIpc('billing:getInvoices', (_, startDate, endDate, issuerId) => billingRepo.getInvoicesByDateRange(startDate, endDate, issuerId));
  handleTrustedIpc('billing:getInvoice', (_, invoiceId) => billingRepo.getInvoiceById(invoiceId));
  // Writer-only: derive the external store from the invoice, never renderer input.
  handleTrustedIpc('billing:getInvoiceProducts', (_, invoiceId: number) => priceInvoiceCatalog(
    billingRepo.getInvoiceProductContext(invoiceId),
    (storeId) => createVrBakerClient().fetchInvoicePrices(storeId),
  ));
  handleTrustedIpc('billing:createManualInvoice', async (_, data) => {
    return withRegistryRoutingLock(async () => {
      await assertNormalStoreAllowed(data.storeId);
      const created = billingRepo.createManualInvoice(data);
      return { ...created, invoice: billingRepo.getInvoiceById(created.invoiceId) };
    });
  });
  handleTrustedIpc('billing:updateInvoice', (_, data) => {
    const saved = billingRepo.updateInvoiceWithItems(data.id, data.invoiceDate, data.items || []);
    return { ...saved, invoice: billingRepo.getInvoiceById(saved.invoiceId) };
  });
  handleTrustedIpc('billing:cancelInvoice', (_, data) => billingRepo.cancelInvoice(data.invoiceId, data.reason));
  handleTrustedIpc('billing:getTestMode', () => billingRepo.getBillingTestMode());
  handleTrustedIpc('billing:setTestMode', (_, data) => billingRepo.setBillingTestMode(data.enabled, data.confirmation));
  handleTrustedIpc('billing:deleteTestInvoice', async (_, data) => {
    const backup = await backupDb();
    if (!backup.success) {
      throw new Error('Copia de siguranță nu a putut fi creată. Scenariul de test nu a fost șters.');
    }
    const invoice = billingRepo.getInvoiceById(data.invoiceId) as any;
    if (!billingRepo.getBillingTestMode().enabled) {
      throw new Error('Ștergerea definitivă este disponibilă numai când Modul test facturare este activ.');
    }
    const confirmation = String(data.confirmation || '').trim().toLocaleUpperCase('ro-RO');
    const acceptedConfirmations = new Set([
      `STERGE ${invoice.invoice_number}`.toLocaleUpperCase('ro-RO'),
      `STERGE ${invoice.invoice_reference || invoice.invoice_number}`.toLocaleUpperCase('ro-RO'),
    ]);
    if (!acceptedConfirmations.has(confirmation)) {
      throw new Error(`Pentru confirmare scrie exact: STERGE ${invoice.invoice_number}`);
    }
    const relatedCreditNotes = billingRepo.listCreditNotes({ companyId: invoice.company_id })
      .filter((note: any) => String(note.invoice_references || '').split(', ').includes(invoice.invoice_number));
    const documents = [
      { kind: 'Facturi' as const, filename: `Factura_${invoice.invoice_number}.pdf`, issuerCode: invoice.issuer_code, localPath: invoice.pdf_path },
      ...relatedCreditNotes.map((note: any) => ({
        kind: 'Credit Notes' as const,
        filename: creditNoteFilename(note.reference),
        issuerCode: note.issuer_code,
        localPath: note.pdf_path,
      })),
    ];
    for (const document of documents) {
      const cloudDelete = await deleteClientFinancialDocumentFromCloud(
        invoice.company_name,
        document.kind,
        document.filename,
        document.issuerCode,
      );
      if (!cloudDelete.success) throw new Error(cloudDelete.error || 'Documentele facturii nu au putut fi șterse din Google Drive.');
    }
    const result = billingRepo.deleteInvoiceForTesting(data.invoiceId, data.confirmation);
    for (const document of documents) {
      const filename = validatePdfFilename(document.filename);
      const localCandidates = new Set<string>([
        document.localPath || '',
        path.join(localClientDocumentDirectory(app.getPath('documents'), invoice.company_name, document.kind), filename),
        document.kind === 'Facturi'
          ? path.join(app.getPath('documents'), 'VR - Hub Management', 'Invoices', String(document.issuerCode || 'goodness').toLowerCase(), filename)
          : path.join(app.getPath('documents'), 'VR - Hub Management', 'Credit Notes', String(document.issuerCode || 'goodness').toLowerCase(), filename),
      ].filter(Boolean));
      for (const localPath of localCandidates) {
        if (!fs.existsSync(localPath)) continue;
        try { fs.unlinkSync(localPath); } catch (error) { console.error('Local billing PDF cleanup failed:', error); }
      }
    }
    void backupDb();
    return result;
  });
  handleTrustedIpc('billing:reissueCancelledInvoice', async (_, invoiceId: number) => withRegistryRoutingLock(async () => {
    const source = billingRepo.getInvoiceById(invoiceId) as any;
    if (!source) throw new Error('Factura anulată nu există.');
    await assertNormalStoreAllowed(source.store_id);
    return billingRepo.reissueCancelledInvoice(invoiceId, new Date().toISOString().slice(0, 10));
  }));
  handleTrustedIpc('billing:getStats', (_, issuerId?: number) => billingRepo.getBillingStats(issuerId));
  handleTrustedIpc('billing:getProducts', () => billingRepo.getCloudProducts());
  handleTrustedIpc('billing:getIssuers', () => billingRepo.getBillingIssuers());
  handleTrustedIpc('billing:updateIssuer', (_, data) => billingRepo.updateBillingIssuer(data));
  handleTrustedIpc('billing:assignCompanyIssuer', (_, data) => billingRepo.assignCompanyIssuer(data.companyId, data.issuerId));
  handleTrustedIpc('billing:getCreditNoteDraft', (_, invoiceIds?: number[]) => billingRepo.readCreditNoteDraft(invoiceIds));
  handleTrustedIpc('billing:createCreditNote', async (_, data) => withRegistryRoutingLock(async () => {
    await loadProtectedRoutingPolicy();
    return billingRepo.issueCreditNote(data);
  }));
  handleTrustedIpc('billing:getCreditNotes', (_, filters?: any) => billingRepo.listCreditNotes(filters));
  handleTrustedIpc('billing:getCreditNote', (_, id: number) => billingRepo.readCreditNote(id));
  handleTrustedIpc('billing:cancelCreditNote', (_, data) => billingRepo.cancelCreditNote(data.id, data.reason, data.acknowledgeAccountingRisk));
  handleTrustedIpc('billing:applyCompanyCredit', (_, data) => billingRepo.applyCompanyCredit(data));
  handleTrustedIpc('billing:reverseCreditApplication', (_, data) => billingRepo.reverseCreditApplication(data.id, data.reason));
  handleTrustedIpc('billing:prepareCreditNotePdf', async (_, id: number) => {
    const note = billingRepo.readCreditNote(id);
    try {
      const pdf = generateCreditNotePdf(note);
      const saved = saveCreditNotePdf(app.getPath('documents'), note.company_name, note.reference, pdf);
      const legacyLocalPath = path.join(
        app.getPath('documents'),
        'VR - Hub Management',
        'Credit Notes',
        String(note.issuer_code).toLowerCase(),
        saved.filename,
      );
      if (legacyLocalPath !== saved.filePath && fs.existsSync(legacyLocalPath)) {
        try { fs.unlinkSync(legacyLocalPath); } catch (error) { console.error('Legacy Credit Note PDF cleanup failed:', error); }
      }
      billingRepo.setCreditNotePdfState(id, saved.filePath, 'ready', 'pending');
      const cloud = await uploadCreditNotePdfToCloud(saved.filename, note.company_name, note.issuer_code, pdf);
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
      const cloud = await downloadCreditNotePdfFromCloud(creditNoteFilename(note.reference), note.company_name, note.issuer_code);
      if (cloud.success && cloud.buffer) filePath = saveCreditNotePdf(app.getPath('documents'), note.company_name, note.reference, cloud.buffer).filePath;
      else return { success: false, notFound: true, message: cloud.error };
    }
    const error = await shell.openPath(filePath);
    return error ? { success: false, message: error } : { success: true, filePath };
  });

  handleTrustedIpc('billing:publicationStatus', () => ({
    publishing:isBillingPublishing(),
    identity:db.prepare('SELECT source_id FROM billing_publication_identity WHERE id=1').get(),
    pending:db.prepare('SELECT q.*,c.name FROM billing_publication_queue q JOIN companies c ON c.id=q.company_id WHERE q.revision>q.published_revision AND c.vrbaker_missing=0').all(),
    excluded:db.prepare('SELECT c.id,c.name FROM companies c WHERE c.vrbaker_missing=1').all(),
    invoiceCount:(db.prepare('SELECT count(*) AS n FROM invoices').get() as {n:number}).n,
    folderId:billingRepo.getAppSetting('invoice_drive_folder_id')||'',
  }));
  handleTrustedIpc('billing:publishNow', async () => {
    db.prepare('UPDATE billing_publication_queue SET retry_at=0').run();
    const {publishBilling}=await import('../integrations/billingPublisher');
    await publishBilling();return {success:true};
  });
  handleTrustedIpc('billing:getSettings' , () => {
    const defaultIssuer = billingRepo.getBillingIssuers().find((issuer) => issuer.is_default === 1);
    return {
      ...(defaultIssuer?.settings || {}),
      invoiceStartNumber: String(defaultIssuer?.next_invoice_number || 1),
      invoiceLogo: billingRepo.getAppSetting('invoice_logo') || '',
    };
  });

  handleTrustedIpc('billing:saveSettings', (_, data) => {
    if(data.invoiceLogo !== undefined) setting('invoice_logo', data.invoiceLogo);
    if(data.invoiceDriveFolderId !== undefined) {
      const folder=String(data.invoiceDriveFolderId).trim();
      if(folder && !/^[A-Za-z0-9_-]{10,200}$/.test(folder)) throw new Error('ID-ul folderului este invalid.');
      setting('invoice_drive_folder_id',folder);
    }
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
      const { ordersByStore, zones } = await prepareWeeklyPreview(startDate, endDate);
      return { success: true, message: `Au fost găsite ${ordersByStore.length} magazine cu comenzi open/locked.`, ordersByStore, zones };
    } catch (error) {
      return { success: false, message: message(error), ordersByStore: [], zones: [] };
    }
  });

  handleTrustedIpc('billing:createWeeklyInvoices', async (_, startDate: string, endDate: string, storeExternalIds: string[]) => {
    try {
      if (!Array.isArray(storeExternalIds) || storeExternalIds.length === 0 || storeExternalIds.length > 500) throw new Error('Selecția magazinelor este invalidă.');
      const requested = new Set(storeExternalIds);
      if (requested.size !== storeExternalIds.length) throw new Error('Selecția magazinelor conține duplicate.');
      return await withRegistryRoutingLock(async () => {
        const groups = (await prepareWeeklyPreview(startDate, endDate)).ordersByStore.filter((group) => requested.has(group.store.id));
        if (groups.length !== requested.size) throw new Error('Unele magazine selectate nu mai există în exportul actual.');
        return { success: true, updatedOrders: await issueWeeklyGroups(groups, startDate, endDate) };
      });
    } catch (error) {
      return { success: false, message: message(error) };
    }
  });

  handleTrustedIpc('billing:createWeeklyInvoicesByZone', async (_, startDate: string, endDate: string, zoneIdInput: unknown) => {
    try {
      return await withRegistryRoutingLock(async () => {
        const preview = await prepareWeeklyPreview(startDate, endDate);
        const { zone, groups } = selectReadyGroupsForZone(preview.ordersByStore, preview.zones, zoneIdInput);
        return { success: true, updatedOrders: await issueWeeklyGroups(groups, startDate, endDate, zone) };
      });
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
      return { success: true, ...result, message: `${result.companies} companii și ${result.stores} magazine au fost sincronizate.` };
    } catch (error) { return { success: false, message: message(error) }; }
  });
}
