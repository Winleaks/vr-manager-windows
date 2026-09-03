import { db } from '../db';
import {
  createInvoiceBatchTransaction,
  recordCompanyPaymentTransaction,
  updateInvoiceTransaction,
  createWeeklyInvoiceBatchTransaction,
  cancelInvoiceTransaction,
  reissueCancelledWeeklyInvoiceTransaction,
  type WeeklyInvoiceInput,
  type CompanyPaymentInput,
  type InvoiceOrderInput,
} from './billingTransactions';
import {
  assignCompanyIssuer as assignCompanyIssuerTransaction,
  getBillingIssuers as readBillingIssuers,
  invoiceSettingsFromIdentity,
  updateBillingIssuer as updateBillingIssuerTransaction,
  type UpdateBillingIssuerInput,
} from '../billingIssuers';
import type { VrBakerCompany, VrBakerProduct, VrBakerStore } from '../../integrations/vrBakerApiClient';
import {
  applyCompanyCreditTransaction,
  cancelCreditNoteTransaction,
  createCreditNoteTransaction,
  getCompanyCreditLedger,
  getCreditNote,
  getCreditNoteDraft,
  getCreditNotes,
  getInvoiceFinancials,
  reverseCreditApplicationTransaction,
  type ApplyCompanyCreditInput,
  type CreateCreditNoteInput,
} from '../creditNotes';

// Settings
export function getAppSetting(key: string): string | null {
  const result = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any;
  return result ? result.value : null;
}

export function setAppSetting(key: string, value: string) {
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
}

export function deleteAppSetting(key: string) {
  db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
}

export function getBillingIssuers() {
  return readBillingIssuers(db);
}

export function updateBillingIssuer(data: UpdateBillingIssuerInput) {
  return updateBillingIssuerTransaction(db, data);
}

export function assignCompanyIssuer(companyId: number, issuerId: number) {
  return assignCompanyIssuerTransaction(db, companyId, issuerId);
}

// Clients
export function getClients() {
  return db.prepare('SELECT * FROM clients ORDER BY name').all();
}

export function createClient(name: string, supabaseClientId: string | null) {
  const stmt = db.prepare('INSERT INTO clients (name, supabase_client_id) VALUES (?, ?)');
  const info = stmt.run(name, supabaseClientId);
  return info.lastInsertRowid;
}

export function updateClient(id: number, name: string, supabaseClientId: string | null, isActive: boolean) {
  const stmt = db.prepare('UPDATE clients SET name = ?, supabase_client_id = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  stmt.run(name, supabaseClientId, isActive ? 1 : 0, id);
}

// Companies
export function getCompaniesByClientId(clientId: number) {
  return db.prepare('SELECT * FROM companies WHERE client_id = ? ORDER BY name').all(clientId);
}

export function createCompany(
  clientId: number,
  name: string,
  cui: string | null,
  regCom: string | null,
  address: string | null,
  bankAccount: string | null,
  bankName: string | null
) {
  const stmt = db.prepare(`
    INSERT INTO companies (client_id, name, cui, reg_com, address, bank_account, bank_name, issuer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT id FROM billing_issuers WHERE is_default = 1))
  `);
  const info = stmt.run(clientId, name, cui, regCom, address, bankAccount, bankName);
  return info.lastInsertRowid;
}

export function updateCompany(
  id: number,
  name: string,
  cui: string | null,
  regCom: string | null,
  address: string | null,
  bankAccount: string | null,
  bankName: string | null,
  isActive: boolean
) {
  const stmt = db.prepare(`
    UPDATE companies 
    SET name = ?, cui = ?, reg_com = ?, address = ?, bank_account = ?, bank_name = ?, is_active = ?
    WHERE id = ?
  `);
  stmt.run(name, cui, regCom, address, bankAccount, bankName, isActive ? 1 : 0, id);
}

// Stores
export function getStoresByCompanyId(companyId: number) {
  return db.prepare('SELECT * FROM stores WHERE company_id = ? ORDER BY name').all(companyId);
}

export function createStore(companyId: number, name: string, address: string | null, supabaseStoreId: string | null) {
  const stmt = db.prepare(`
    INSERT INTO stores (company_id, name, address, supabase_store_id)
    VALUES (?, ?, ?, ?)
  `);
  const info = stmt.run(companyId, name, address, supabaseStoreId);
  return info.lastInsertRowid;
}

export function updateStore(id: number, name: string, address: string | null, supabaseStoreId: string | null, isActive: boolean) {
  const stmt = db.prepare(`
    UPDATE stores
    SET name = ?, address = ?, supabase_store_id = ?, is_active = ?
    WHERE id = ?
  `);
  stmt.run(name, address, supabaseStoreId, isActive ? 1 : 0, id);
}

export function upsertClientFromSupabase(clientData: { id: string, name: string }) {
  let localClient = db.prepare('SELECT id FROM clients WHERE supabase_client_id = ?').get(clientData.id) as any;
  if (!localClient && clientData.name) {
    localClient = db.prepare('SELECT id FROM clients WHERE LOWER(name) = LOWER(?)').get(clientData.name) as any;
  }

  if (localClient) {
    db.prepare(`
      UPDATE clients 
      SET name = ?, supabase_client_id = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(clientData.name, clientData.id, localClient.id);
    return localClient.id as number;
  } else {
    const info = db.prepare(`
      INSERT INTO clients (name, supabase_client_id)
      VALUES (?, ?)
    `).run(clientData.name, clientData.id);
    return info.lastInsertRowid as number;
  }
}

export function upsertCompanyFromSupabase(companyData: { id: string, name: string, registration_number?: string, vat_number?: string, address?: string, cui?: string, reg_com?: string, client_id?: string }, localClientId?: number) {
  let localCompany = db.prepare('SELECT id FROM companies WHERE supabase_company_id = ?').get(companyData.id) as any;
  
  const cuiVal = companyData.vat_number || companyData.cui || null;
  const regComVal = companyData.registration_number || companyData.reg_com || null;

  if (localCompany) {
    db.prepare(`
      UPDATE companies 
      SET name = ?, cui = ?, reg_com = ?, address = ?, supabase_company_id = ? 
      WHERE id = ?
    `).run(
      companyData.name, 
      cuiVal, 
      regComVal, 
      companyData.address || null, 
      companyData.id,
      localCompany.id
    );
    return localCompany.id as number;
  } else {
    // Înregistrare companie nouă
    let client = localClientId ? { id: localClientId } : db.prepare('SELECT id FROM clients ORDER BY id LIMIT 1').get() as any;
    if (!client) {
      const info = db.prepare('INSERT INTO clients (name) VALUES (?)').run('Client Implicit');
      client = { id: info.lastInsertRowid };
    }
    
    const info = db.prepare(`
      INSERT INTO companies (client_id, name, cui, reg_com, address, supabase_company_id, issuer_id)
      VALUES (?, ?, ?, ?, ?, ?, (SELECT id FROM billing_issuers WHERE is_default = 1))
    `).run(
      client.id,
      companyData.name,
      cuiVal,
      regComVal,
      companyData.address || null,
      companyData.id
    );
    return info.lastInsertRowid as number;
  }
}

export function upsertStoreFromSupabase(storeData: { id: string, name: string, address?: string, client_company_id: string }, localCompanyId?: number) {
  let localStore = db.prepare('SELECT id, company_id FROM stores WHERE supabase_store_id = ?').get(storeData.id) as any;

  let companyId = localCompanyId;
  if (!companyId && storeData.client_company_id) {
    const company = db.prepare('SELECT id FROM companies WHERE supabase_company_id = ?').get(storeData.client_company_id) as any;
    if (company) {
      companyId = company.id;
    }
  }

  if (!companyId && localStore) {
    companyId = localStore.company_id;
  }

  if (!companyId) {
    let unassignedComp = db.prepare("SELECT id FROM companies WHERE supabase_company_id = 'unassigned_company'").get() as any;
    if (!unassignedComp) {
      const info = db.prepare("INSERT INTO companies (client_id, name, supabase_company_id, issuer_id) VALUES (1, 'Magazine Neasociate', 'unassigned_company', (SELECT id FROM billing_issuers WHERE is_default = 1))").run();
      unassignedComp = { id: info.lastInsertRowid };
    }
    companyId = unassignedComp.id;
  }

  if (localStore) {
    db.prepare(`
      UPDATE stores 
      SET name = ?, address = ?, company_id = ?, supabase_store_id = ? 
      WHERE id = ?
    `).run(storeData.name, storeData.address || null, companyId, storeData.id, localStore.id);
    return localStore.id as number;
  } else {
    const info = db.prepare(`
      INSERT INTO stores (company_id, name, address, supabase_store_id)
      VALUES (?, ?, ?, ?)
    `).run(companyId, storeData.name, storeData.address || null, storeData.id);
    return info.lastInsertRowid as number;
  }
}

export function cleanupOrphanCompanies() {
  try {
    db.prepare(`
      DELETE FROM companies 
      WHERE id NOT IN (SELECT DISTINCT company_id FROM stores)
        AND (cui IS NULL OR cui = '')
        AND (reg_com IS NULL OR reg_com = '')
    `).run();
  } catch {}
}

export function getAllCompaniesAndStores() {
  cleanupOrphanCompanies();
  const companies = db.prepare(`
    SELECT c.*, bi.legal_name AS issuer_name, bi.code AS issuer_code, bi.color AS issuer_color,
           bi.is_default AS issuer_is_default
    FROM companies c LEFT JOIN billing_issuers bi ON bi.id = c.issuer_id
    ORDER BY c.name
  `).all() as any[];
  const stores = db.prepare('SELECT * FROM stores ORDER BY name').all() as any[];

  return companies.map(c => {
    const compStores = stores.filter(s => s.company_id === c.id);
    const storeIds = compStores.map(s => s.id);
    let unpaidInvoicesCount = 0;
    let unpaidTotal = 0;

    if (storeIds.length > 0) {
      const placeholders = storeIds.map(() => '?').join(',');
      const invoiceIds = db.prepare(`SELECT id FROM invoices WHERE store_id IN (${placeholders}) AND status != 'cancelled'`).all(...storeIds) as Array<{ id: number }>;
      const balances = invoiceIds.map((row) => getInvoiceFinancials(db, row.id)).filter((row) => row.outstanding > 0.005);
      unpaidInvoicesCount = balances.length;
      unpaidTotal = balances.reduce((sum, row) => sum + row.outstanding, 0);
    }

    return {
      ...c,
      credit_balance: c.credit_balance || 0,
      issuerCredits: db.prepare(`
        SELECT cic.issuer_id, cic.balance, bi.legal_name AS issuer_name, bi.code AS issuer_code, bi.color AS issuer_color
        FROM company_issuer_credits cic JOIN billing_issuers bi ON bi.id = cic.issuer_id
        WHERE cic.company_id = ? ORDER BY bi.is_default DESC, bi.legal_name
      `).all(c.id),
      stores: compStores,
      unpaidInvoicesCount,
      unpaidTotal
    };
  });
}

export function getCompanyProfileDetails(companyId: number) {
  const company = db.prepare(`
    SELECT c.*, bi.legal_name AS issuer_name, bi.code AS issuer_code, bi.color AS issuer_color
    FROM companies c LEFT JOIN billing_issuers bi ON bi.id = c.issuer_id WHERE c.id = ?
  `).get(companyId) as any;
  if (!company) return null;

  const stores = db.prepare('SELECT * FROM stores WHERE company_id = ? ORDER BY name').all(companyId) as any[];
  const storeIds = stores.map(s => s.id);

  let invoices: any[] = [];
  if (storeIds.length > 0) {
    const placeholders = storeIds.map(() => '?').join(',');
    invoices = db.prepare(`
      SELECT i.*, s.name as store_name, ii.issuer_id, ii.series AS invoice_series,
             ii.sequence_number AS invoice_sequence, ii.reference AS invoice_reference,
             ii.issuer_snapshot_json, bi.legal_name AS issuer_name, bi.code AS issuer_code,
             bi.color AS issuer_color
      FROM invoices i
      JOIN stores s ON i.store_id = s.id
      LEFT JOIN invoice_identities ii ON ii.invoice_id = i.id
      LEFT JOIN billing_issuers bi ON bi.id = ii.issuer_id
      WHERE i.store_id IN (${placeholders})
      ORDER BY i.invoice_date DESC, i.id DESC
    `).all(...storeIds) as any[];

    invoices = invoices.map(inv => {
      const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(inv.id) as any[];
      const financials = getInvoiceFinancials(db, inv.id);
      return {
        ...inv,
        ...financials,
        issuer_settings: invoiceSettingsFromIdentity(inv),
        items: items.map(it => ({
          id: it.id,
          productName: it.product_name,
          name_ro: it.product_name_ro,
          variant_label: it.variant_label,
          unit: it.unit,
          quantity: it.quantity,
          unitPrice: it.unit_price,
          totalPrice: it.total_price,
          externalProductId: it.external_product_id,
          finishedProductId: it.finished_product_id,
        }))
      };
    });
  }

  const payments = db.prepare(`
    SELECT p.*, i.invoice_number, bi.legal_name AS issuer_name, bi.code AS issuer_code
    FROM payments p
    LEFT JOIN invoices i ON p.invoice_id = i.id
    LEFT JOIN billing_issuers bi ON bi.id = p.issuer_id
    WHERE p.company_id = ?
    ORDER BY p.payment_date DESC, p.id DESC
  `).all(companyId) as any[];

  const activeInvoices = invoices.filter((inv) => inv.status !== 'cancelled');
  const totalInvoiced = activeInvoices.reduce((acc, inv) => acc + (inv.grossAmount || 0), 0);
  const totalCredited = activeInvoices.reduce((acc, inv) => acc + (inv.creditedAmount || 0), 0);
  const totalNet = activeInvoices.reduce((acc, inv) => acc + (inv.netAmount || 0), 0);
  const totalPaid = activeInvoices.reduce((acc, inv) => acc + (inv.cashPaid || 0), 0);
  const totalCreditApplied = activeInvoices.reduce((acc, inv) => acc + (inv.appliedCredit || 0), 0);
  const unpaidInvoices = activeInvoices.filter(inv => inv.outstanding > 0.005);
  const totalUnpaid = unpaidInvoices.reduce((acc, inv) => acc + (inv.outstanding || 0), 0);

  return {
    company: {
      ...company,
      credit_balance: company.credit_balance || 0
    },
    issuerCredits: db.prepare(`
      SELECT cic.issuer_id, cic.balance, bi.legal_name AS issuer_name, bi.code AS issuer_code, bi.color AS issuer_color
      FROM company_issuer_credits cic JOIN billing_issuers bi ON bi.id = cic.issuer_id
      WHERE cic.company_id = ? ORDER BY bi.is_default DESC, bi.legal_name
    `).all(companyId),
    issuers: getBillingIssuers(),
    stores,
    invoices,
    unpaidInvoices,
    payments,
    creditLedger: getCompanyCreditLedger(db, companyId),
    stats: {
      totalInvoiced,
      totalCredited,
      totalNet,
      totalPaid,
      totalCreditApplied,
      totalUnpaid,
      creditBalance: company.credit_balance || 0
    }
  };
}

export function recordCompanyPayment(data: CompanyPaymentInput) {
  return recordCompanyPaymentTransaction(db, data);
}

export function createInvoiceBatchFromSync(orders: InvoiceOrderInput[], invoiceDate: string) {
  return createInvoiceBatchTransaction(db, orders, invoiceDate);
}

export function getStoreBySupabaseId(supabaseStoreId: string) {
  const store = db.prepare('SELECT id FROM stores WHERE supabase_store_id = ?').get(supabaseStoreId) as any;
  return store ? store.id : null;
}

// Invoices
export function getInvoicesByDateRange(startDate?: string, endDate?: string, issuerId?: number) {
  let query = `
    SELECT i.*, 
           ii.issuer_id, ii.series AS invoice_series, ii.sequence_number AS invoice_sequence,
           ii.reference AS invoice_reference, ii.issuer_snapshot_json,
           bi.legal_name AS issuer_name, bi.code AS issuer_code, bi.color AS issuer_color,
           s.name as store_name, s.address as store_address, s.phone as store_phone,
           c.name as company_name, c.cui as company_cui, c.reg_com as company_reg_com, c.address as company_address, c.phone as company_phone, c.bank_account as company_bank_account, c.bank_name as company_bank_name,
           cl.name as client_name
    FROM invoices i
    JOIN stores s ON i.store_id = s.id
    JOIN companies c ON s.company_id = c.id
    JOIN clients cl ON c.client_id = cl.id
    LEFT JOIN invoice_identities ii ON ii.invoice_id = i.id
    LEFT JOIN billing_issuers bi ON bi.id = ii.issuer_id
  `;
  const params: any[] = [];
  const conditions: string[] = [];
  if (startDate && endDate) {
    conditions.push('i.invoice_date >= ? AND i.invoice_date <= ?');
    params.push(startDate, endDate);
  }
  if (issuerId !== undefined) {
    conditions.push('ii.issuer_id = ?');
    params.push(issuerId);
  }
  if (conditions.length) query += ` WHERE ${conditions.join(' AND ')}`;
  query += ` ORDER BY i.invoice_date DESC, ii.sequence_number DESC, i.id DESC`;

  const invoices = db.prepare(query).all(...params) as any[];

  return invoices.map(inv => {
    const items = db.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).all(inv.id) as any[];
    return {
      ...inv,
      ...getInvoiceFinancials(db, inv.id),
      issuer_settings: invoiceSettingsFromIdentity(inv),
      items: items.map(item => ({
        id: item.id,
        productName: item.product_name,
        name_ro: item.product_name_ro,
        variant_label: item.variant_label,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        totalPrice: item.total_price,
        externalProductId: item.external_product_id,
        finishedProductId: item.finished_product_id,
      }))
    };
  });
}

export function updateInvoiceWithItems(
  id: number,
  invoiceDate: string,
  items: { productName: string, name_ro?: string, variant_label?: string, unit?: string, quantity: number, unitPrice: number, totalPrice: number }[]
) {
  const invoice = db.prepare('SELECT invoice_number FROM invoices WHERE id = ?').get(id) as { invoice_number: string } | undefined;
  if (!invoice) throw new Error('Factura nu există.');
  return updateInvoiceTransaction(db, id, invoice.invoice_number, invoiceDate, items);
}


// Dashboard calculations
export function getBillingStats(issuerId?: number) {
  const invoiceIds = db.prepare(`SELECT i.id FROM invoices i LEFT JOIN invoice_identities ii ON ii.invoice_id = i.id WHERE i.status != 'cancelled' AND (? IS NULL OR ii.issuer_id = ?)`).all(issuerId ?? null, issuerId ?? null) as Array<{ id: number }>;
  const rows = invoiceIds.map((row) => getInvoiceFinancials(db, row.id));
  return {
    totalInvoiced: rows.reduce((sum, row) => sum + row.grossAmount, 0),
    totalCredited: rows.reduce((sum, row) => sum + row.creditedAmount, 0),
    totalNet: rows.reduce((sum, row) => sum + row.netAmount, 0),
    totalPaid: rows.reduce((sum, row) => sum + row.cashPaid, 0),
    totalCreditApplied: rows.reduce((sum, row) => sum + row.appliedCredit, 0),
    totalUnpaid: rows.reduce((sum, row) => sum + row.outstanding, 0),
  };
}

export function readCreditNoteDraft(invoiceIds?: number[]) { return getCreditNoteDraft(db, invoiceIds); }
export function issueCreditNote(data: CreateCreditNoteInput) { return createCreditNoteTransaction(db, data); }
export function listCreditNotes(filters?: any) { return getCreditNotes(db, filters); }
export function readCreditNote(id: number) { return getCreditNote(db, id); }
export function cancelCreditNote(id: number, reason: string, acknowledgeAccountingRisk: boolean) { return cancelCreditNoteTransaction(db, id, reason, acknowledgeAccountingRisk); }
export function applyCompanyCredit(data: ApplyCompanyCreditInput) { return applyCompanyCreditTransaction(db, data); }
export function reverseCreditApplication(id: number, reason: string) { return reverseCreditApplicationTransaction(db, id, reason); }
export function setCreditNotePdfState(id: number, pdfPath: string | null, pdfStatus: 'pending' | 'ready' | 'error', cloudStatus?: 'pending' | 'ready' | 'error') {
  db.prepare(`UPDATE credit_notes SET pdf_path = ?, pdf_status = ?, cloud_status = COALESCE(?, cloud_status) WHERE id = ?`).run(pdfPath, pdfStatus, cloudStatus || null, id);
}

export function cancelInvoice(invoiceId: number, reason: string) {
  return cancelInvoiceTransaction(db, invoiceId, reason);
}

export function reissueCancelledInvoice(invoiceId: number, invoiceDate: string) {
  return reissueCancelledWeeklyInvoiceTransaction(db, invoiceId, invoiceDate);
}

export function getCloudProducts() {
  return db.prepare('SELECT * FROM cloud_products ORDER BY name').all();
}

export function syncProductsFromVrBaker(products: VrBakerProduct[]) {
  if (!Array.isArray(products) || products.length > 1000) throw new Error('Catalogul VR Baker este prea mare.');
  if (new Set(products.map((product) => product.id)).size !== products.length) {
    throw new Error('Catalogul VR Baker conține produse duplicate.');
  }
  return db.transaction(() => {
    const findByExternalId = db.prepare('SELECT id FROM cloud_products WHERE supabase_product_id = ?');
    const findByName = db.prepare('SELECT id FROM cloud_products WHERE LOWER(name) = LOWER(?)');
    const update = db.prepare(`
      UPDATE cloud_products
      SET name = ?, name_ro = ?, variant_label = ?, unit = ?, category = ?, price_standard = ?, available = ?, supabase_product_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    const insert = db.prepare(`
      INSERT INTO cloud_products (supabase_product_id, name, name_ro, variant_label, unit, category, price_standard, available)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const product of products) {
      const local = (findByExternalId.get(product.id) || findByName.get(product.name)) as { id: number } | undefined;
      const values = [
        product.name,
        product.nameRo || null,
        product.variantLabel || null,
        product.unit || null,
        product.category || null,
        product.priceStandard,
        product.available ? 1 : 0,
      ] as const;
      if (local) update.run(...values, product.id, local.id);
      else insert.run(product.id, ...values);
    }
    if (products.length > 0) {
      const placeholders = products.map(() => '?').join(', ');
      db.prepare(`
        UPDATE cloud_products
        SET available = 0, updated_at = CURRENT_TIMESTAMP
        WHERE supabase_product_id IS NOT NULL
          AND supabase_product_id NOT IN (${placeholders})
          AND available != 0
      `).run(...products.map((product) => product.id));
    }
    return products.length;
  })();
}

export function syncEntitiesFromVrBaker(companies: VrBakerCompany[], stores: VrBakerStore[]) {
  return db.transaction(() => {
    const companyIds = new Map<string, number>();
    for (const company of companies) {
      const clientId = upsertClientFromSupabase({ id: company.id, name: company.name });
      const companyId = upsertCompanyFromSupabase({
        id: company.id,
        name: company.name,
        vat_number: company.vatNumber,
        registration_number: company.registrationNumber,
        address: company.address,
      }, clientId);
      companyIds.set(company.id, companyId);
    }
    let unassignedCompanyId: number | undefined;
    for (const store of stores) {
      let companyId = store.company ? companyIds.get(store.company.id) : undefined;
      if (!companyId) {
        const clientId = upsertClientFromSupabase({ id: 'vrbaker-unassigned-client', name: 'Magazine fără companie mamă' });
        unassignedCompanyId ||= upsertCompanyFromSupabase({ id: 'vrbaker-unassigned-company', name: 'Magazine neasociate' }, clientId);
        companyId = unassignedCompanyId;
      }
      upsertStoreFromSupabase({ id: store.id, name: store.name, address: store.address, client_company_id: store.company?.id || '' }, companyId);
      db.prepare('UPDATE stores SET phone = ? WHERE supabase_store_id = ?').run(store.phone || null, store.id);
    }
    return { companies: companies.length, stores: stores.length };
  })();
}

export function getWeeklyImportState(storeExternalId: string, periodStart: string, periodEnd: string, fingerprint: string) {
  const row = db.prepare(`
    SELECT b.invoice_id AS source_invoice_id, b.source_fingerprint,
           COALESCE(r.replacement_invoice_id, b.invoice_id) AS invoice_id,
           current.invoice_number, current.invoice_date, current.status,
           ii.issuer_id, ii.reference AS invoice_reference, ii.issuer_snapshot_json,
           bi.legal_name AS issuer_name, bi.code AS issuer_code, bi.color AS issuer_color
    FROM invoice_import_batches b
    JOIN invoices original ON original.id = b.invoice_id
    LEFT JOIN invoice_replacements r ON r.cancelled_invoice_id = original.id
    JOIN invoices current ON current.id = COALESCE(r.replacement_invoice_id, original.id)
    LEFT JOIN invoice_identities ii ON ii.invoice_id = current.id
    LEFT JOIN billing_issuers bi ON bi.id = ii.issuer_id
    WHERE b.source = 'vrbaker' AND b.store_external_id = ? AND b.period_start = ? AND b.period_end = ?
  `).get(storeExternalId, periodStart, periodEnd) as any;
  if (!row) return { billingState: 'ready' as const };
  return {
    billingState: row.status === 'cancelled'
      ? 'cancelled' as const
      : row.source_fingerprint === fingerprint ? 'invoiced' as const : 'source_changed' as const,
    assignedInvoiceId: row.invoice_id,
    assignedInvoiceNumber: row.invoice_number,
    assignedInvoiceDate: row.invoice_date,
    issuerId: row.issuer_id,
    issuerName: row.issuer_name,
    issuerCode: row.issuer_code,
    issuerColor: row.issuer_color,
    issuerSettings: invoiceSettingsFromIdentity(row),
  };
}

export function getIssuerPreviewByStoreExternalId(storeExternalId: string) {
  const row = db.prepare(`
    SELECT bi.* FROM stores s JOIN companies c ON c.id = s.company_id
    JOIN billing_issuers bi ON bi.id = c.issuer_id
    WHERE s.supabase_store_id = ?
  `).get(storeExternalId) as any;
  if (!row) return null;
  return {
    issuerId: row.id,
    issuerName: row.legal_name,
    issuerCode: row.code,
    issuerColor: row.color,
    issuerReady: Boolean(row.is_active && row.address && row.company_number && row.invoice_series && row.bank_name_1 && row.account_number_1 && row.sort_code_1 && (!row.vat_registered || row.vat_number)),
    estimatedInvoiceReference: row.invoice_series ? `${row.invoice_series}-${row.next_invoice_number}` : null,
  };
}

export function createWeeklyInvoices(orders: WeeklyInvoiceInput[], invoiceDate: string) {
  return createWeeklyInvoiceBatchTransaction(db, orders, invoiceDate);
}
