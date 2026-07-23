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

export function recordCompanyPayment(data: {
  companyId: number;
  invoiceId?: number;
  amount: number;
  paymentDate: string;
  method: string;
  bankName?: string;
  notes?: string;
}) {
  const { companyId, invoiceId, amount, paymentDate, method, bankName, notes } = data;
  if (!companyId || !amount || amount <= 0) {
    throw new Error('Suma încasată trebuie să fie mai mare decât 0!');
  }

  const comp = db.prepare('SELECT client_id FROM companies WHERE id = ?').get(companyId) as any;
  const clientId = comp?.client_id || 1;

  let remainingAmount = amount;

  const processPaymentTransaction = db.transaction(() => {
    // 1. Dacă s-a selectat o factură specifică
    if (invoiceId) {
      const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
      if (inv) {
        const due = Math.max(0, inv.total_amount - inv.paid_amount);
        if (due > 0) {
          const payForThis = Math.min(remainingAmount, due);
          const newPaid = inv.paid_amount + payForThis;
          const newStatus = (newPaid >= inv.total_amount) ? 'paid' : 'partial';

          db.prepare('UPDATE invoices SET paid_amount = ?, status = ? WHERE id = ?')
            .run(newPaid, newStatus, inv.id);

          db.prepare(`
            INSERT INTO payments (client_id, company_id, invoice_id, amount, payment_date, method, bank_name, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(clientId, companyId, inv.id, payForThis, paymentDate, method, bankName || null, notes || null);

          remainingAmount -= payForThis;
        }
      }
    }

    // 2. Cascadăm pe următoarele cele mai vechi facturi neachitate ale companiei
    if (remainingAmount > 0) {
      const stores = db.prepare('SELECT id FROM stores WHERE company_id = ?').all(companyId) as any[];
      const storeIds = stores.map(s => s.id);

      if (storeIds.length > 0) {
        const placeholders = storeIds.map(() => '?').join(',');
        let query = `
          SELECT * FROM invoices 
          WHERE store_id IN (${placeholders}) AND status != 'paid' AND (total_amount - paid_amount) > 0
        `;
        const params: any[] = [...storeIds];

        if (invoiceId) {
          query += ` AND id != ?`;
          params.push(invoiceId);
        }
        query += ` ORDER BY invoice_date ASC, id ASC`;

        const unpaidInvoices = db.prepare(query).all(...params) as any[];

        for (const inv of unpaidInvoices) {
          if (remainingAmount <= 0) break;
          const due = inv.total_amount - inv.paid_amount;
          if (due <= 0) continue;

          const payForThis = Math.min(remainingAmount, due);
          const newPaid = inv.paid_amount + payForThis;
          const newStatus = (newPaid >= inv.total_amount) ? 'paid' : 'partial';

          db.prepare('UPDATE invoices SET paid_amount = ?, status = ? WHERE id = ?')
            .run(newPaid, newStatus, inv.id);

          db.prepare(`
            INSERT INTO payments (client_id, company_id, invoice_id, amount, payment_date, method, bank_name, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            clientId,
            companyId, 
            inv.id, 
            payForThis, 
            paymentDate, 
            method, 
            bankName || null, 
            notes ? `${notes} (Distribuire automata surplus)` : 'Distribuire automată surplus pe factură restantă'
          );

          remainingAmount -= payForThis;
        }
      }
    }

    // 3. Supra-plată -> adăugare în soldul de credit al companiei
    if (remainingAmount > 0) {
      db.prepare('UPDATE companies SET credit_balance = credit_balance + ? WHERE id = ?')
        .run(remainingAmount, companyId);

      db.prepare(`
        INSERT INTO payments (client_id, company_id, invoice_id, amount, payment_date, method, bank_name, notes)
        VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
      `).run(
        clientId,
        companyId,
        remainingAmount,
        paymentDate,
        method,
        bankName || null,
        notes ? `${notes} (Avans / Credit companie)` : 'Avans / Credit înregistrat în balanța companiei'
      );

      remainingAmount = 0;
    }
  });

  processPaymentTransaction();
  return true;
}

export function getStoreBySupabaseId(supabaseStoreId: string) {
  const store = db.prepare('SELECT id FROM stores WHERE supabase_store_id = ?').get(supabaseStoreId) as any;
  return store ? store.id : null;
}

// Invoices
export function getInvoicesByDateRange(startDate?: string, endDate?: string) {
  let query = `
    SELECT i.*, 
           s.name as store_name, s.address as store_address,
           c.name as company_name, c.cui as company_cui, c.reg_com as company_reg_com, c.address as company_address, c.bank_account as company_bank_account, c.bank_name as company_bank_name,
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
  totalAmount: number,
  paidAmount: number,
  status: string,
  items: { productName: string, quantity: number, unitPrice: number, totalPrice: number }[]
) {
  const updateTransaction = db.transaction(() => {
    db.prepare(`
      UPDATE invoices 
      SET invoice_number = ?, invoice_date = ?, total_amount = ?, paid_amount = ?, status = ?
      WHERE id = ?
    `).run(invoiceNumber, invoiceDate, totalAmount, paidAmount, status, id);

    db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(id);

    const stmtItems = db.prepare(`
      INSERT INTO invoice_items (invoice_id, product_name, quantity, unit_price, total_price)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    for (const item of items) {
      stmtItems.run(id, item.productName, item.quantity, item.unitPrice, item.totalPrice);
    }
  });

  updateTransaction();
  return true;
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

export function deleteInvoice(invoiceId: number) {
  const deleteTransaction = db.transaction(() => {
    db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoiceId);
    db.prepare('DELETE FROM payments WHERE invoice_id = ?').run(invoiceId);
    db.prepare('DELETE FROM invoices WHERE id = ?').run(invoiceId);
  });
  deleteTransaction();
  return true;
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
