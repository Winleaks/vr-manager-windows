import Database from 'better-sqlite3';
import { dbPath } from '../db';

function getDb() {
  return new Database(dbPath);
}

// Settings
export function getAppSetting(key: string): string | null {
  const db = getDb();
  const result = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any;
  db.close();
  return result ? result.value : null;
}

export function setAppSetting(key: string, value: string) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
  db.close();
}

// Clients
export function getClients() {
  const db = getDb();
  const clients = db.prepare('SELECT * FROM clients ORDER BY name').all();
  db.close();
  return clients;
}

export function createClient(name: string, supabaseClientId: string | null) {
  const db = getDb();
  const stmt = db.prepare('INSERT INTO clients (name, supabase_client_id) VALUES (?, ?)');
  const info = stmt.run(name, supabaseClientId);
  db.close();
  return info.lastInsertRowid;
}

export function updateClient(id: number, name: string, supabaseClientId: string | null, isActive: boolean) {
  const db = getDb();
  const stmt = db.prepare('UPDATE clients SET name = ?, supabase_client_id = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  stmt.run(name, supabaseClientId, isActive ? 1 : 0, id);
  db.close();
}

// Companies
export function getCompaniesByClientId(clientId: number) {
  const db = getDb();
  const companies = db.prepare('SELECT * FROM companies WHERE client_id = ? ORDER BY name').all(clientId);
  db.close();
  return companies;
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
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO companies (client_id, name, cui, reg_com, address, bank_account, bank_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(clientId, name, cui, regCom, address, bankAccount, bankName);
  db.close();
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
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE companies 
    SET name = ?, cui = ?, reg_com = ?, address = ?, bank_account = ?, bank_name = ?, is_active = ?
    WHERE id = ?
  `);
  stmt.run(name, cui, regCom, address, bankAccount, bankName, isActive ? 1 : 0, id);
  db.close();
}

// Stores
export function getStoresByCompanyId(companyId: number) {
  const db = getDb();
  const stores = db.prepare('SELECT * FROM stores WHERE company_id = ? ORDER BY name').all(companyId);
  db.close();
  return stores;
}

export function createStore(companyId: number, name: string, address: string | null, supabaseStoreId: string | null) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO stores (company_id, name, address, supabase_store_id)
    VALUES (?, ?, ?, ?)
  `);
  const info = stmt.run(companyId, name, address, supabaseStoreId);
  db.close();
  return info.lastInsertRowid;
}

export function updateStore(id: number, name: string, address: string | null, supabaseStoreId: string | null, isActive: boolean) {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE stores
    SET name = ?, address = ?, supabase_store_id = ?, is_active = ?
    WHERE id = ?
  `);
  stmt.run(name, address, supabaseStoreId, isActive ? 1 : 0, id);
  db.close();
}

export function getStoreBySupabaseId(supabaseStoreId: string) {
  const db = getDb();
  const store = db.prepare('SELECT id FROM stores WHERE supabase_store_id = ?').get(supabaseStoreId) as any;
  db.close();
  return store ? store.id : null;
}

// Invoices
export function getInvoicesByDateRange(startDate: string, endDate: string) {
  const db = getDb();
  const invoices = db.prepare(`
    SELECT i.*, s.name as store_name, c.name as company_name 
    FROM invoices i
    JOIN stores s ON i.store_id = s.id
    JOIN companies c ON s.company_id = c.id
    WHERE i.invoice_date >= ? AND i.invoice_date <= ?
    ORDER BY i.invoice_date DESC, i.invoice_number DESC
  `).all(startDate, endDate);
  db.close();
  return invoices;
}

export function createInvoiceWithItems(
  storeId: number, 
  invoiceNumber: string, 
  invoiceDate: string, 
  totalAmount: number,
  items: { productName: string, quantity: number, unitPrice: number, totalPrice: number }[]
) {
  const db = getDb();
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
  db.close();
  return invoiceId;
}

// Dashboard calculations
export function getBillingStats() {
  const db = getDb();
  const result = db.prepare(`
    SELECT 
      SUM(total_amount) as total_invoiced,
      SUM(paid_amount) as total_paid,
      SUM(total_amount - paid_amount) as total_unpaid
    FROM invoices
  `).get() as any;
  db.close();
  return {
    totalInvoiced: result?.total_invoiced || 0,
    totalPaid: result?.total_paid || 0,
    totalUnpaid: result?.total_unpaid || 0
  };
}
