import { db } from '../db';
import {
  createInvoiceBatchTransaction,
  deleteUnpaidInvoiceTransaction,
  recordCompanyPaymentTransaction,
  updateInvoiceTransaction,
  createWeeklyInvoiceBatchTransaction,
  type WeeklyInvoiceInput,
  type CompanyPaymentInput,
  type InvoiceOrderInput,
} from './billingTransactions';
import type { VrBakerCompany, VrBakerProduct, VrBakerStore } from '../../integrations/vrBakerApiClient';

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
    INSERT INTO companies (client_id, name, cui, reg_com, address, bank_account, bank_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
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
      INSERT INTO companies (client_id, name, cui, reg_com, address, supabase_company_id)
      VALUES (?, ?, ?, ?, ?, ?)
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
      const info = db.prepare("INSERT INTO companies (client_id, name, supabase_company_id) VALUES (1, 'Magazine Neasociate', 'unassigned_company')").run();
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
  } catch(e) {}
}

export function getAllCompaniesAndStores() {
  cleanupOrphanCompanies();
  const companies = db.prepare('SELECT * FROM companies ORDER BY name').all() as any[];
  const stores = db.prepare('SELECT * FROM stores ORDER BY name').all() as any[];

  return companies.map(c => {
    const compStores = stores.filter(s => s.company_id === c.id);
    const storeIds = compStores.map(s => s.id);
    let unpaidInvoicesCount = 0;
    let unpaidTotal = 0;

    if (storeIds.length > 0) {
      const placeholders = storeIds.map(() => '?').join(',');
      const res = db.prepare(`
        SELECT COUNT(*) as cnt, SUM(total_amount - paid_amount) as unpaid 
        FROM invoices 
        WHERE store_id IN (${placeholders}) AND status != 'paid' AND (total_amount - paid_amount) > 0
      `).get(...storeIds) as any;
      unpaidInvoicesCount = res?.cnt || 0;
      unpaidTotal = res?.unpaid || 0;
    }

    return {
      ...c,
      credit_balance: c.credit_balance || 0,
      stores: compStores,
      unpaidInvoicesCount,
      unpaidTotal
    };
  });
}

export function getCompanyProfileDetails(companyId: number) {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId) as any;
  if (!company) return null;

  const stores = db.prepare('SELECT * FROM stores WHERE company_id = ? ORDER BY name').all(companyId) as any[];
  const storeIds = stores.map(s => s.id);

  let invoices: any[] = [];
  if (storeIds.length > 0) {
    const placeholders = storeIds.map(() => '?').join(',');
    invoices = db.prepare(`
      SELECT i.*, s.name as store_name
      FROM invoices i
      JOIN stores s ON i.store_id = s.id
      WHERE i.store_id IN (${placeholders})
      ORDER BY i.invoice_date DESC, i.id DESC
    `).all(...storeIds) as any[];

    invoices = invoices.map(inv => {
      const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(inv.id) as any[];
      return {
        ...inv,
        items: items.map(it => ({
          id: it.id,
          productName: it.product_name,
          quantity: it.quantity,
          unitPrice: it.unit_price,
          totalPrice: it.total_price
        }))
      };
    });
  }

  const payments = db.prepare(`
    SELECT p.*, i.invoice_number 
    FROM payments p
    LEFT JOIN invoices i ON p.invoice_id = i.id
    WHERE p.company_id = ?
    ORDER BY p.payment_date DESC, p.id DESC
  `).all(companyId) as any[];

  const totalInvoiced = invoices.reduce((acc, inv) => acc + (inv.total_amount || 0), 0);
  const totalPaid = invoices.reduce((acc, inv) => acc + (inv.paid_amount || 0), 0);
  const unpaidInvoices = invoices.filter(inv => inv.status !== 'paid' && (inv.total_amount - inv.paid_amount) > 0);
  const totalUnpaid = unpaidInvoices.reduce((acc, inv) => acc + ((inv.total_amount || 0) - (inv.paid_amount || 0)), 0);

  return {
    company: {
      ...company,
      credit_balance: company.credit_balance || 0
    },
    stores,
    invoices,
    unpaidInvoices,
    payments,
    stats: {
      totalInvoiced,
      totalPaid,
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
export function getInvoicesByDateRange(startDate?: string, endDate?: string) {
  let query = `
    SELECT i.*, 
           s.name as store_name, s.address as store_address, s.phone as store_phone,
           c.name as company_name, c.cui as company_cui, c.reg_com as company_reg_com, c.address as company_address, c.phone as company_phone, c.bank_account as company_bank_account, c.bank_name as company_bank_name,
           cl.name as client_name
    FROM invoices i
    JOIN stores s ON i.store_id = s.id
    JOIN companies c ON s.company_id = c.id
    JOIN clients cl ON c.client_id = cl.id
  `;
  const params: any[] = [];
  if (startDate && endDate) {
    query += ` WHERE i.invoice_date >= ? AND i.invoice_date <= ?`;
    params.push(startDate, endDate);
  }
  query += ` ORDER BY i.invoice_date DESC, i.invoice_number DESC`;

  const invoices = db.prepare(query).all(...params) as any[];

  return invoices.map(inv => {
    const items = db.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).all(inv.id) as any[];
    return {
      ...inv,
      items: items.map(item => ({
        id: item.id,
        productName: item.product_name,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        totalPrice: item.total_price
      }))
    };
  });
}

export function updateInvoiceWithItems(
  id: number,
  invoiceNumber: string,
  invoiceDate: string,
  items: { productName: string, quantity: number, unitPrice: number, totalPrice: number }[]
) {
  return updateInvoiceTransaction(db, id, invoiceNumber, invoiceDate, items);
}


// Dashboard calculations
export function getBillingStats() {
  const result = db.prepare(`
    SELECT 
      SUM(total_amount) as total_invoiced,
      SUM(paid_amount) as total_paid,
      SUM(total_amount - paid_amount) as total_unpaid
    FROM invoices
  `).get() as any;
  return {
    totalInvoiced: result?.total_invoiced || 0,
    totalPaid: result?.total_paid || 0,
    totalUnpaid: result?.total_unpaid || 0
  };
}

export function deleteInvoice(invoiceId: number) {
  return deleteUnpaidInvoiceTransaction(db, invoiceId);
}

export function getCloudProducts() {
  return db.prepare('SELECT * FROM cloud_products ORDER BY name').all();
}

export function upsertProductFromSupabase(product: {
  id: string,
  name: string,
  name_ro?: string,
  variant_label?: string,
  unit?: string,
  category?: string,
  price_standard?: number,
  available?: boolean
}) {
  let localProd = db.prepare('SELECT id FROM cloud_products WHERE supabase_product_id = ?').get(product.id) as any;
  if (!localProd && product.name) {
    localProd = db.prepare('SELECT id FROM cloud_products WHERE LOWER(name) = LOWER(?)').get(product.name) as any;
  }

  const availVal = product.available === false ? 0 : 1;

  if (localProd) {
    db.prepare(`
      UPDATE cloud_products
      SET name = ?, name_ro = ?, variant_label = ?, unit = ?, category = ?, price_standard = ?, available = ?, supabase_product_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      product.name,
      product.name_ro || null,
      product.variant_label || null,
      product.unit || null,
      product.category || null,
      product.price_standard || 0,
      availVal,
      product.id,
      localProd.id
    );
    return localProd.id as number;
  } else {
    const info = db.prepare(`
      INSERT INTO cloud_products (supabase_product_id, name, name_ro, variant_label, unit, category, price_standard, available)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      product.id,
      product.name,
      product.name_ro || null,
      product.variant_label || null,
      product.unit || null,
      product.category || null,
      product.price_standard || 0,
      availVal
    );
    return info.lastInsertRowid as number;
  }
}

export function syncProductsFromVrBaker(products: VrBakerProduct[]) {
  return db.transaction(() => {
    for (const product of products) {
      upsertProductFromSupabase({
        id: product.id,
        name: product.name,
        name_ro: product.nameRo,
        variant_label: product.variantLabel,
        unit: product.unit,
        category: product.category,
        price_standard: product.priceStandard,
        available: product.available,
      });
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
    SELECT b.invoice_id, b.source_fingerprint, i.invoice_number, i.invoice_date
    FROM invoice_import_batches b JOIN invoices i ON i.id = b.invoice_id
    WHERE b.source = 'vrbaker' AND b.store_external_id = ? AND b.period_start = ? AND b.period_end = ?
  `).get(storeExternalId, periodStart, periodEnd) as any;
  if (!row) return { billingState: 'ready' as const };
  return {
    billingState: row.source_fingerprint === fingerprint ? 'invoiced' as const : 'source_changed' as const,
    assignedInvoiceId: row.invoice_id,
    assignedInvoiceNumber: row.invoice_number,
    assignedInvoiceDate: row.invoice_date,
  };
}

export function createWeeklyInvoices(orders: WeeklyInvoiceInput[], invoiceDate: string) {
  return createWeeklyInvoiceBatchTransaction(db, orders, invoiceDate);
}
