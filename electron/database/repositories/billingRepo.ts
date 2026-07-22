import { db } from '../db';

// Settings
export function getAppSetting(key: string): string | null {
  const result = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any;
  return result ? result.value : null;
}

export function setAppSetting(key: string, value: string) {
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
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

  if (!localCompany && cuiVal) {
    localCompany = db.prepare('SELECT id FROM companies WHERE cui = ?').get(cuiVal) as any;
  }
  if (!localCompany && companyData.name) {
    localCompany = db.prepare('SELECT id FROM companies WHERE LOWER(name) = LOWER(?)').get(companyData.name) as any;
  }

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
    let client = db.prepare('SELECT id FROM clients ORDER BY id LIMIT 1').get() as any;
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
  if (!localStore && storeData.name) {
    localStore = db.prepare('SELECT id, company_id FROM stores WHERE LOWER(name) = LOWER(?)').get(storeData.name) as any;
  }

  let companyId = localCompanyId;
  if (!companyId) {
    const company = db.prepare('SELECT id FROM companies WHERE supabase_company_id = ?').get(storeData.client_company_id) as any;
    if (company) {
      companyId = company.id;
    }
  }

  if (!companyId) {
    const firstCompany = db.prepare('SELECT id FROM companies ORDER BY id LIMIT 1').get() as any;
    companyId = firstCompany ? firstCompany.id : 1;
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

export function getAllCompaniesAndStores() {
  const companies = db.prepare('SELECT * FROM companies ORDER BY name').all() as any[];
  const stores = db.prepare('SELECT * FROM stores ORDER BY name').all() as any[];

  return companies.map(c => ({
    ...c,
    stores: stores.filter(s => s.company_id === c.id)
  }));
}

export function getStoreBySupabaseId(supabaseStoreId: string) {
  const store = db.prepare('SELECT id FROM stores WHERE supabase_store_id = ?').get(supabaseStoreId) as any;
  return store ? store.id : null;
}

// Invoices
export function getInvoicesByDateRange(startDate: string, endDate: string) {
  const invoices = db.prepare(`
    SELECT i.*, s.name as store_name, c.name as company_name 
    FROM invoices i
    JOIN stores s ON i.store_id = s.id
    JOIN companies c ON s.company_id = c.id
    WHERE i.invoice_date >= ? AND i.invoice_date <= ?
    ORDER BY i.invoice_date DESC, i.invoice_number DESC
  `).all(startDate, endDate);
  return invoices;
}

export function createInvoiceWithItems(
  storeId: number, 
  invoiceNumber: string, 
  invoiceDate: string, 
  totalAmount: number,
  items: { productName: string, quantity: number, unitPrice: number, totalPrice: number }[]
) {
  let invoiceId = -1;
  const insertInvoice = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO invoices (store_id, invoice_number, invoice_date, total_amount, paid_amount, status)
      VALUES (?, ?, ?, ?, 0, 'unpaid')
    `);
    const info = stmt.run(storeId, invoiceNumber, invoiceDate, totalAmount);
    invoiceId = info.lastInsertRowid as number;

    const stmtItems = db.prepare(`
      INSERT INTO invoice_items (invoice_id, product_name, quantity, unit_price, total_price)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    for (const item of items) {
      stmtItems.run(invoiceId, item.productName, item.quantity, item.unitPrice, item.totalPrice);
    }
  });

  insertInvoice();
  return invoiceId;
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
