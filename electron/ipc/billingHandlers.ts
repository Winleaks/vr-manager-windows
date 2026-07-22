import { ipcMain } from 'electron';
import * as billingRepo from '../database/repositories/billingRepo';

export function registerBillingHandlers() {
  ipcMain.handle('billing:getClients', () => {
    return billingRepo.getClients();
  });

  ipcMain.handle('billing:createClient', (_, data) => {
    return billingRepo.createClient(data.name, data.supabaseClientId);
  });

  ipcMain.handle('billing:updateClient', (_, data) => {
    billingRepo.updateClient(data.id, data.name, data.supabaseClientId, data.isActive);
    return true;
  });

  ipcMain.handle('billing:getCompanies', (_, clientId) => {
    return billingRepo.getCompaniesByClientId(clientId);
  });

  ipcMain.handle('billing:createCompany', (_, data) => {
    return billingRepo.createCompany(
      data.clientId, data.name, data.cui, data.regCom, data.address, data.bankAccount, data.bankName
    );
  });

  ipcMain.handle('billing:updateCompany', (_, data) => {
    billingRepo.updateCompany(
      data.id, data.name, data.cui, data.regCom, data.address, data.bankAccount, data.bankName, data.isActive
    );
    return true;
  });

  ipcMain.handle('billing:getStores', (_, companyId) => {
    return billingRepo.getStoresByCompanyId(companyId);
  });

  ipcMain.handle('billing:createStore', (_, data) => {
    return billingRepo.createStore(data.companyId, data.name, data.address, data.supabaseStoreId);
  });

  ipcMain.handle('billing:getAllCompaniesAndStores', () => {
    return billingRepo.getAllCompaniesAndStores();
  });

  ipcMain.handle('billing:updateStore', (_, data) => {
    billingRepo.updateStore(data.id, data.name, data.address, data.supabaseStoreId, data.isActive);
    return true;
  });

  ipcMain.handle('billing:getInvoices', (_, startDate, endDate) => {
    return billingRepo.getInvoicesByDateRange(startDate, endDate);
  });

  ipcMain.handle('billing:getStats', () => {
    return billingRepo.getBillingStats();
  });

  ipcMain.handle('billing:getSettings', () => {
    return {
      supabaseUrl: billingRepo.getAppSetting('supabase_url') || '',
      supabaseKey: billingRepo.getAppSetting('supabase_key') || '',
      supabaseEmail: billingRepo.getAppSetting('supabase_email') || '',
      supabasePassword: billingRepo.getAppSetting('supabase_password') || '',
      invoiceSeries: billingRepo.getAppSetting('invoice_series') || 'FACT',
      invoiceStartNumber: billingRepo.getAppSetting('invoice_start_number') || '1',
      issuerName: billingRepo.getAppSetting('issuer_name') || '',
      issuerCrn: billingRepo.getAppSetting('issuer_crn') || '',
      issuerVat: billingRepo.getAppSetting('issuer_vat') || '',
      invoiceAccountNumber: billingRepo.getAppSetting('invoice_account_number') || '',
      invoiceSortCode: billingRepo.getAppSetting('invoice_sort_code') || '',
      invoiceBankName: billingRepo.getAppSetting('invoice_bank_name') || '',
      invoiceIban: billingRepo.getAppSetting('invoice_iban') || '',
      invoiceFooter: billingRepo.getAppSetting('invoice_footer') || '',
      invoiceColor: billingRepo.getAppSetting('invoice_color') || '#4F46E5',
      invoiceLogo: billingRepo.getAppSetting('invoice_logo') || '',
    };
  });

  ipcMain.handle('billing:saveSettings', (_, data) => {
    billingRepo.setAppSetting('supabase_url', data.supabaseUrl);
    billingRepo.setAppSetting('supabase_key', data.supabaseKey);
    billingRepo.setAppSetting('supabase_email', data.supabaseEmail);
    billingRepo.setAppSetting('supabase_password', data.supabasePassword);
    billingRepo.setAppSetting('invoice_series', data.invoiceSeries);
    billingRepo.setAppSetting('invoice_start_number', data.invoiceStartNumber);
    billingRepo.setAppSetting('issuer_name', data.issuerName);
    billingRepo.setAppSetting('issuer_crn', data.issuerCrn);
    billingRepo.setAppSetting('issuer_vat', data.issuerVat);
    billingRepo.setAppSetting('invoice_account_number', data.invoiceAccountNumber);
    billingRepo.setAppSetting('invoice_sort_code', data.invoiceSortCode);
    billingRepo.setAppSetting('invoice_footer', data.invoiceFooter);
    billingRepo.setAppSetting('invoice_color', data.invoiceColor);
    billingRepo.setAppSetting('invoice_logo', data.invoiceLogo);
    return true;
  });

  ipcMain.handle('billing:syncSupabaseOrders', async (_, startDate, endDate) => {
    try {
      const url = billingRepo.getAppSetting('supabase_url');
      const key = billingRepo.getAppSetting('supabase_key');
      const email = billingRepo.getAppSetting('supabase_email');
      const password = billingRepo.getAppSetting('supabase_password');

      if (!url || !key || !email || !password) {
        return { success: false, message: "Datele de conectare la Supabase lipsesc în setări." };
      }

      // Native fetch approach to bypass Node/Vite bundling issues with supabase-js
      const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': key
        },
        body: JSON.stringify({ email, password })
      });
      const authData = await authRes.json();
      if (!authRes.ok) {
        return { success: false, message: `Eroare autentificare Supabase: ${authData.error_description || authData.msg || authData.message || 'Eroare necunoscută'}` };
      }
      const token = authData.access_token;

      const query = new URLSearchParams();
      query.append('select', 'id,delivery_date,status,notes,client_store:client_store_id(*,client_company:client_company_id(*)),order_items(qty_ordered,qty_delivered,unit_price_snapshot,products:product_id(*))');
      query.append('delivery_date', `gte.${startDate}`);
      query.append('delivery_date', `lte.${endDate}`);
      query.append('status', 'neq.cancelled');

      const ordersRes = await fetch(`${url}/rest/v1/orders?${query.toString()}`, {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${token}`
        }
      });
      const orders = await ordersRes.json();

      if (!ordersRes.ok) {
        return { success: false, message: `Eroare extragere comenzi: ${orders.message || orders.details || 'Eroare necunoscută'}` };
      }

      if (!orders || orders.length === 0) {
        return { success: true, newInvoices: 0, message: "Nu s-au găsit comenzi livrate în această perioadă." };
      }

      // Preluăm toate companiile și clienții din Supabase fără limitare de paginare (Range 0-9999)
      let companiesMap = new Map<string, any>();
      let companiesByClientIdMap = new Map<string, any>();
      let clientsMap = new Map<string, any>();

      const fetchTableData = async (tableName: string) => {
        try {
          const res = await fetch(`${url}/rest/v1/${tableName}?select=*&limit=10000`, {
            method: 'GET',
            headers: {
              'apikey': key,
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Range': '0-9999',
              'Prefer': 'count=exact'
            }
          });
          if (res.ok) {
            const data = await res.json();
            return Array.isArray(data) ? data : [];
          }
        } catch (e) {}
        return [];
      };

      const compList = await fetchTableData('client_company');
      const compListAlt = compList.length > 0 ? [] : await fetchTableData('client_companies');
      const allCompanies = [...compList, ...compListAlt];
      
      for (const c of allCompanies) {
        if (c.id) {
          const cleanId = String(c.id).trim();
          companiesMap.set(cleanId, c);
          companiesMap.set(cleanId.toLowerCase(), c);
        }
        if (c.client_id) {
          const cleanClientId = String(c.client_id).trim();
          companiesByClientIdMap.set(cleanClientId, c);
          companiesByClientIdMap.set(cleanClientId.toLowerCase(), c);
        }
      }

      const clientList = await fetchTableData('client');
      const clientListAlt = clientList.length > 0 ? [] : await fetchTableData('clients');
      const allClients = [...clientList, ...clientListAlt];
      
      for (const cl of allClients) {
        if (cl.id) {
          const cleanId = String(cl.id).trim();
          clientsMap.set(cleanId, cl);
          clientsMap.set(cleanId.toLowerCase(), cl);
        }
      }

      const ordersByStore = new Map();
      
      for (const order of orders) {
        if (!order.client_store) continue;
        
        const store = order.client_store;
        const targetCompanyId = String(store.client_company_id || store.company_id || store.client_id || '').trim();
        
        let companyData = store.client_company || 
          (targetCompanyId ? (companiesMap.get(targetCompanyId) || companiesMap.get(targetCompanyId.toLowerCase())) : null);
        
        if (!companyData && store.client_id) {
          const cleanClientId = String(store.client_id).trim();
          companyData = companiesByClientIdMap.get(cleanClientId) || companiesByClientIdMap.get(cleanClientId.toLowerCase());
        }

        // Căutare după potrivire nume dacă nu s-a găsit prin ID
        if (!companyData && store.company_name) {
          companyData = Array.from(companiesMap.values()).find(
            c => c.name && c.name.toLowerCase() === String(store.company_name).toLowerCase()
          );
        }

        // Fallback inteligent dacă magazinul nu avea compania legată direct în cloud
        if (!companyData) {
          const fallbackName = store.company_name || store.client_company_name || (allCompanies.length === 1 ? allCompanies[0].name : null);
          if (fallbackName) {
            companyData = {
              id: `virtual_${store.id}`,
              name: fallbackName,
              vat_number: store.vat_number || store.vat || store.cui || '',
              registration_number: store.registration_number || store.crn || store.reg_com || '',
              address: store.address || ''
            };
          } else {
            companyData = {
              id: `virtual_${store.id}`,
              name: store.name,
              vat_number: store.vat_number || store.vat || store.cui || '',
              registration_number: store.registration_number || store.crn || store.reg_com || '',
              address: store.address || ''
            };
          }
        }

        // 1. Sincronizăm Clientul în baza locală
        const rawClient = store.client_id ? clientsMap.get(String(store.client_id)) : null;
        const clientData = rawClient || { id: store.client_id || `client_${store.id}`, name: companyData.name || store.name };
        const localClientId = billingRepo.upsertClientFromSupabase(clientData);

        // 2. Sincronizăm Compania în baza locală
        const localCompanyId = billingRepo.upsertCompanyFromSupabase({
          id: String(companyData.id || `comp_${store.id}`),
          name: companyData.name || store.company_name || store.name,
          vat_number: companyData.vat_number || companyData.cui || store.vat_number || '',
          registration_number: companyData.registration_number || companyData.reg_com || store.registration_number || '',
          address: companyData.address || store.address || ''
        }, localClientId);

        // 3. Sincronizăm Magazinul în baza locală
        billingRepo.upsertStoreFromSupabase({
          id: String(store.id),
          name: store.name,
          address: store.address || '',
          client_company_id: String(companyData.id || `comp_${store.id}`)
        }, localCompanyId);

        // Atașăm datele de companie direct pe obiectul magazinului pentru UI și generare PDF
        store.client_company = companyData;
        const storeId = store.id;
        
        if (!ordersByStore.has(storeId)) {
          ordersByStore.set(storeId, {
            store: store,
            items: []
          });
        }
        
        const storeData = ordersByStore.get(storeId);
        
        for (const item of order.order_items || []) {
          const qty = item.qty_delivered ?? item.qty_ordered;
          if (qty > 0) {
            if (item.products?.name) {
              billingRepo.upsertProductFromSupabase({
                id: String(item.product_id || item.products.id || item.products.name),
                name: item.products.name,
                name_ro: item.products.name_ro || '',
                variant_label: item.products.variant_label || '',
                unit: item.products.unit || 'buc',
                category: item.products.category || 'Patiserie',
                price_standard: item.products.price_standard || item.products.price || item.unit_price_snapshot || 0,
                available: item.products.available !== false
              });
            }

            storeData.items.push({
              productName: item.products?.name || 'Produs necunoscut',
              name_ro: item.products?.name_ro || '',
              variant_label: item.products?.variant_label || '',
              quantity: qty,
              unitPrice: item.unit_price_snapshot || 0,
              totalPrice: qty * (item.unit_price_snapshot || 0)
            });
          }
        }
      }

      return { 
        success: true, 
        message: "Comenzile au fost extrase cu succes din cloud.",
        ordersByStore: Array.from(ordersByStore.values())
      };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  });

  ipcMain.handle('billing:createInvoicesFromSync', async (_event, orders: any[]) => {
    try {
      // NOTE: getSettings is handled from frontend, here we might not need to manipulate settings or we do it if needed.
      // Wait, there is a reference to getSettings() here which was wrong in the previous version (billingRepo.getSettings() doesn't exist).
      // I will fix it since I am looking at it.
      
      const invoiceSeries = billingRepo.getAppSetting('invoice_series') || 'FACT';
      let currentNumber = parseInt(billingRepo.getAppSetting('invoice_start_number') || '1', 10);
      
      const today = new Date().toISOString().split('T')[0];

      for (const orderData of orders) {
        const supabaseStoreId = orderData.store?.id;
        const localStoreId = supabaseStoreId ? billingRepo.getStoreBySupabaseId(supabaseStoreId) : null;
        
        if (!localStoreId) {
          throw new Error(`Magazinul "${orderData.store?.name || 'Necunoscut'}" nu a putut fi găsit în baza de date locală (Eroare Mapare Internă). Te rugăm să apeși din nou butonul "Preluare Comenzi" pentru a forța o sincronizare completă a clienților.`);
        }

        let storeId = localStoreId;
        const invoiceNumber = currentNumber.toString();
        const totalAmount = orderData.items.reduce((acc: number, item: any) => acc + item.totalPrice, 0);

        const createdId = billingRepo.createInvoiceWithItems(storeId, invoiceNumber, today, totalAmount, orderData.items);
        
        orderData.assignedInvoiceId = createdId;
        orderData.assignedInvoiceNumber = invoiceNumber;
        orderData.assignedInvoiceDate = new Date().toLocaleDateString('ro-RO');

        currentNumber++;
      }

      billingRepo.setAppSetting('invoice_start_number', currentNumber.toString());

      return { success: true, updatedOrders: orders };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  });

  ipcMain.handle('billing:deleteInvoice', (_, invoiceId: number) => {
    return billingRepo.deleteInvoice(invoiceId);
  });

  ipcMain.handle('billing:getProducts', () => {
    return billingRepo.getCloudProducts();
  });

  ipcMain.handle('billing:syncProducts', async () => {
    try {
      const url = billingRepo.getAppSetting('supabase_url');
      const key = billingRepo.getAppSetting('supabase_key');
      const email = billingRepo.getAppSetting('supabase_email');
      const password = billingRepo.getAppSetting('supabase_password');

      if (!url || !key || !email || !password) {
        return { success: false, message: "Datele de conectare la Supabase lipsesc în setări." };
      }

      const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': key },
        body: JSON.stringify({ email, password })
      });
      if (!authRes.ok) return { success: false, message: "Eroare autentificare Supabase." };
      const authData = await authRes.json();
      const token = authData.access_token;

      let prodRes = await fetch(`${url}/rest/v1/product?select=*&limit=10000`, {
        headers: { 'apikey': key, 'Authorization': `Bearer ${token}`, 'Range': '0-9999' }
      });
      if (!prodRes.ok) {
        prodRes = await fetch(`${url}/rest/v1/products?select=*&limit=10000`, {
          headers: { 'apikey': key, 'Authorization': `Bearer ${token}`, 'Range': '0-9999' }
        });
      }

      if (prodRes.ok) {
        const products = await prodRes.json();
        if (Array.isArray(products)) {
          for (const p of products) {
            billingRepo.upsertProductFromSupabase({
              id: String(p.id),
              name: p.name || 'Produs fără nume',
              name_ro: p.name_ro || '',
              variant_label: p.variant_label || '',
              unit: p.unit || 'buc',
              category: p.category || 'Patiserie',
              price_standard: p.price_standard ?? p.price ?? p.unit_price ?? 0,
              available: p.available !== false
            });
          }
        }
      }

      return { success: true, message: "Produsele au fost sincronizate cu succes din server." };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  });

  ipcMain.handle('billing:syncEntities', async () => {
    try {
      const url = billingRepo.getAppSetting('supabase_url');
      const key = billingRepo.getAppSetting('supabase_key');
      const email = billingRepo.getAppSetting('supabase_email');
      const password = billingRepo.getAppSetting('supabase_password');

      if (!url || !key || !email || !password) {
        return { success: false, message: "Datele de conectare la Supabase lipsesc în setări." };
      }

      const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': key },
        body: JSON.stringify({ email, password })
      });
      if (!authRes.ok) return { success: false, message: "Eroare autentificare Supabase." };
      const authData = await authRes.json();
      const token = authData.access_token;

      const fetchTableData = async (tableName: string) => {
        try {
          const res = await fetch(`${url}/rest/v1/${tableName}?select=*&limit=10000`, {
            headers: { 'apikey': key, 'Authorization': `Bearer ${token}`, 'Range': '0-9999' }
          });
          if (res.ok) {
            const data = await res.json();
            return Array.isArray(data) ? data : [];
          }
        } catch (e) {}
        return [];
      };

      const compList = await fetchTableData('client_company');
      const compListAlt = compList.length > 0 ? [] : await fetchTableData('client_companies');
      const allCompanies = [...compList, ...compListAlt];

      const clientList = await fetchTableData('client');
      const clientListAlt = clientList.length > 0 ? [] : await fetchTableData('clients');
      const allClients = [...clientList, ...clientListAlt];

      const storeList = await fetchTableData('client_store');
      const storeListAlt = storeList.length > 0 ? [] : await fetchTableData('client_stores');
      const allStores = [...storeList, ...storeListAlt];

      const clientsMap = new Map();
      for (const cl of allClients) {
        if (cl.id) {
          clientsMap.set(String(cl.id).trim(), cl);
          billingRepo.upsertClientFromSupabase({ id: String(cl.id), name: cl.name || 'Client' });
        }
      }

      const companiesMap = new Map();
      for (const c of allCompanies) {
        if (c.id) {
          const cleanId = String(c.id).trim();
          companiesMap.set(cleanId, c);
          const rawClient = c.client_id ? clientsMap.get(String(c.client_id).trim()) : null;
          const clientData = rawClient || { id: c.client_id || `client_${c.id}`, name: c.name };
          const localClientId = billingRepo.upsertClientFromSupabase(clientData);

          billingRepo.upsertCompanyFromSupabase({
            id: cleanId,
            name: c.name || 'Companie',
            vat_number: c.vat_number || c.cui || '',
            registration_number: c.registration_number || c.reg_com || '',
            address: c.address || ''
          }, localClientId);
        }
      }

      for (const s of allStores) {
        if (s.id) {
          const cleanCompId = String(s.client_company_id || s.company_id || '').trim();
          billingRepo.upsertStoreFromSupabase({
            id: String(s.id),
            name: s.name,
            address: s.address || '',
            client_company_id: cleanCompId
          });
        }
      }

      return { success: true, message: "Toți clienții, companiile și magazinele au fost sincronizate cu succes din server." };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  });
}
