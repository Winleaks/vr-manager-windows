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
      query.append('select', 'id,delivery_date,status,notes,client_store:client_store_id(id,name,address,postcode,client_company_id),order_items(qty_ordered,qty_delivered,unit_price_snapshot,products:product_id(name,unit,category))');
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
        return { success: false, message: `Eroare extragere comenzi: ${orders.message || orders.details || 'Unknown error'}` };
      }

      if (!orders || orders.length === 0) {
        return { success: true, newInvoices: 0, message: "Nu s-au găsit comenzi livrate în această perioadă." };
      }

      // Extract all unique company IDs
      const companyIds = new Set<string>();
      for (const order of orders) {
        if (order.client_store && order.client_store.client_company_id) {
          companyIds.add(order.client_store.client_company_id);
        }
      }

      // Fetch companies separately
      let companiesMap = new Map();
      if (companyIds.size > 0) {
        const compIdsArray = Array.from(companyIds).join(',');
        const compRes = await fetch(`${url}/rest/v1/client_company?id=in.(${compIdsArray})&select=id,name,registration_number,vat_number,address`, {
          method: 'GET',
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!compRes.ok) {
          const err = await compRes.json();
          return { success: false, message: `Eroare extragere companii (API): ${err.message || err.details || 'Unknown error'}` };
        }

        const companies = await compRes.json();
        for (const c of companies) {
          companiesMap.set(c.id, c);
        }
      }

      const ordersByStore = new Map();
      
      for (const order of orders) {
        if (!order.client_store) continue;
        
        // Auto-sync company & store
        const companyData = companiesMap.get(order.client_store.client_company_id);
        if (companyData) {
          billingRepo.upsertCompanyFromSupabase(companyData);
          billingRepo.upsertStoreFromSupabase({
            id: order.client_store.id,
            name: order.client_store.name,
            address: order.client_store.address || '',
            client_company_id: companyData.id
          });
        } else {
          return { success: false, message: `Magazinul "${order.client_store.name}" există în cloud, dar NU este legat de nicio companie (CUI/Reg.Com) în Supabase! Te rog să îi asociezi o companie pe platforma web înainte de facturare.` };
        }
        const storeId = order.client_store.id;
        
        if (!ordersByStore.has(storeId)) {
          ordersByStore.set(storeId, {
            store: order.client_store,
            items: []
          });
        }
        
        const storeData = ordersByStore.get(storeId);
        
        for (const item of order.order_items || []) {
          const qty = item.qty_delivered ?? item.qty_ordered;
          if (qty > 0) {
            storeData.items.push({
              productName: item.products?.name || 'Produs necunoscut',
              quantity: qty,
              unitPrice: item.unit_price_snapshot,
              totalPrice: qty * item.unit_price_snapshot
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

        billingRepo.createInvoiceWithItems(storeId, invoiceNumber, today, totalAmount, orderData.items);
        
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
}
