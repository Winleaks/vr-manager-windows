import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Building2, CheckCircle2, FilePlus2, Loader2, Package, Plus, Store, Trash2 } from 'lucide-react';
import { api } from '../shared/api';
import { NumericInput } from '../components/NumericInput';
import { BilingualProductName } from '../components/BilingualProductName';
import { generateInvoicePDF } from '../utils/pdfGenerator';

interface ManualLine {
  productId: number;
  quantity: string;
  unitPrice: string;
}

function todayLocal() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function BillingManualInvoice() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [issuers, setIssuers] = useState<any[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [productId, setProductId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayLocal());
  const [lines, setLines] = useState<ManualLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [isWriter, setIsWriter] = useState(false);

  useEffect(() => {
    Promise.all([
      api.billing.getAllCompaniesAndStores(),
      api.billing.getProducts(),
      api.billing.getIssuers(),
      api.system.getDeviceRole(),
    ]).then(([nextCompanies, nextProducts, nextIssuers, device]) => {
      const activeCompanies = (nextCompanies || []).filter((company: any) => company.is_active !== 0);
      setCompanies(activeCompanies);
      setProducts((nextProducts || []).filter((product: any) => product.available !== 0 && product.available !== false));
      setIssuers(nextIssuers || []);
      setIsWriter(device.role === 'writer');
      if (activeCompanies[0]) setCompanyId(String(activeCompanies[0].id));
    }).catch((error) => {
      console.error(error);
      window.alert(error instanceof Error ? error.message : 'Datele pentru factura manuală nu au putut fi încărcate.');
    }).finally(() => setLoading(false));
  }, []);

  const company = companies.find((item) => String(item.id) === companyId);
  const stores = (company?.stores || []).filter((store: any) => store.is_active !== 0);
  const issuer = issuers.find((item) => Number(item.id) === Number(company?.issuer_id));

  useEffect(() => {
    const nextCompany = companies.find((item) => String(item.id) === companyId);
    const nextStore = (nextCompany?.stores || []).find((store: any) => store.is_active !== 0);
    setStoreId(nextStore ? String(nextStore.id) : '');
  }, [companyId, companies]);

  const selectedStore = stores.find((item: any) => String(item.id) === storeId);
  const availableProducts = products.filter((product) => !lines.some((line) => line.productId === Number(product.id)));
  const resolvedLines = useMemo(() => lines.map((line) => {
    const product = products.find((item) => Number(item.id) === line.productId);
    const quantity = Number(line.quantity || 0);
    const unitPrice = Number(line.unitPrice || 0);
    return { ...line, product, quantity, unitPrice, totalPrice: quantity * unitPrice };
  }), [lines, products]);
  const total = resolvedLines.reduce((sum, line) => sum + (Number.isFinite(line.totalPrice) ? line.totalPrice : 0), 0);

  const addProduct = () => {
    const product = products.find((item) => String(item.id) === productId);
    if (!product || lines.some((line) => line.productId === Number(product.id))) return;
    setLines((current) => [...current, {
      productId: Number(product.id),
      quantity: '1',
      unitPrice: Number(product.price_standard || 0).toFixed(2),
    }].sort((a, b) => {
      const productA = products.find((item) => Number(item.id) === a.productId);
      const productB = products.find((item) => Number(item.id) === b.productId);
      const orderA = productA?.display_order ?? Number.MAX_SAFE_INTEGER;
      const orderB = productB?.display_order ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB || String(productA?.name || '').localeCompare(String(productB?.name || ''), 'en-GB');
    }));
    setProductId('');
  };

  const updateLine = (index: number, patch: Partial<ManualLine>) => {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  };

  const issueInvoice = async () => {
    if (!isWriter) return window.alert('Factura manuală poate fi emisă numai de pe calculatorul Writer.');
    if (!company || !selectedStore) return window.alert('Selectează compania și magazinul facturat.');
    if (!issuer) return window.alert('Compania selectată nu are o societate emitentă atribuită.');
    if (!invoiceDate) return window.alert('Selectează data facturii.');
    if (resolvedLines.length === 0) return window.alert('Adaugă cel puțin un produs pe factură.');
    if (resolvedLines.some((line) => !line.product || line.quantity <= 0 || line.unitPrice < 0 || !Number.isFinite(line.totalPrice))) {
      return window.alert('Verifică produsele, cantitățile și prețurile introduse.');
    }
    const estimatedReference = issuer.invoice_series ? `${issuer.invoice_series}-${issuer.next_invoice_number}` : 'numărul următor';
    if (!window.confirm(`Emiți factura ${estimatedReference} pentru ${company.name}, în valoare de £${total.toFixed(2)}?`)) return;

    setIssuing(true);
    let created: any;
    try {
      created = await api.billing.createManualInvoice({
        storeId: Number(selectedStore.id),
        invoiceDate,
        items: resolvedLines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      });
    } catch (error) {
      setIssuing(false);
      return window.alert(`Factura nu a fost emisă: ${error instanceof Error ? error.message : 'eroare necunoscută'}`);
    }

    try {
      const sharedSettings = await api.billing.getSettings();
      const invoice = created.invoice;
      if (!invoice?.issuer_settings || !Array.isArray(invoice.items)) throw new Error('Factura nu a putut fi recitită din SQLite.');
      const buffer = generateInvoicePDF(
        { ...invoice.issuer_settings, invoiceLogo: sharedSettings.invoiceLogo },
        {
          invoiceNumber: invoice.invoice_number,
          invoiceDate: invoice.invoice_date,
          client: {
            name: invoice.company_name || invoice.client_name || invoice.store_name,
            cui: invoice.company_cui,
            regCom: invoice.company_reg_com,
            address: invoice.company_address,
          },
          store: {
            name: invoice.store_name,
            address: invoice.store_address,
            postcode: invoice.store_postcode,
            phone: invoice.store_phone,
          },
          items: invoice.items,
          totalAmount: invoice.total_amount,
        },
      );
      const filename = `Factura_${created.invoiceNumber}.pdf`;
      const localSave = await api.system.savePdfAuto({ buffer, filename, issuerCode: invoice.issuer_code || invoice.issuer_settings.code });
      if (!localSave.success) throw new Error(localSave.error || 'PDF-ul nu a putut fi salvat local.');
      const cloudSave = await api.system.uploadPdfToCloud(filename, buffer);
      window.alert(cloudSave.success
        ? `Factura #${created.invoiceNumber} a fost emisă, salvată local și verificată în Google Drive.`
        : `Factura #${created.invoiceNumber} a fost emisă și salvată local, dar nu a fost confirmată în Google Drive: ${cloudSave.error || 'Eroare necunoscută'}`);
    } catch (error) {
      window.alert(`Factura #${created.invoiceNumber} a fost emisă, dar PDF-ul nu a putut fi pregătit acum. Îl poți regenera din pagina Facturi. ${error instanceof Error ? error.message : ''}`);
    } finally {
      setIssuing(false);
      window.location.hash = '/facturare/facturi';
    }
  };

  if (loading) return <div className="p-12 flex items-center justify-center gap-3 text-slate-500"><Loader2 className="animate-spin" />Se încarcă datele...</div>;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3"><div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center"><FilePlus2 size={22} /></div><h1 className="text-3xl font-bold text-slate-900">Factură manuală</h1></div>
          <p className="text-slate-500 mt-2">Emite o factură fără comandă importată, folosind exclusiv produsele din catalogul local.</p>
        </div>
      </div>

      {!isWriter && <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 flex gap-2"><AlertCircle size={18} />Calculatorul Viewer poate consulta facturile, dar nu poate emite facturi manuale.</div>}

      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="space-y-1.5"><span className="text-xs font-semibold uppercase text-slate-500">Companie client</span><select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50"><option value="">Selectează compania</option>{companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="space-y-1.5"><span className="text-xs font-semibold uppercase text-slate-500">Magazin / punct de livrare</span><select value={storeId} onChange={(event) => setStoreId(event.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50"><option value="">Selectează magazinul</option>{stores.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="space-y-1.5"><span className="text-xs font-semibold uppercase text-slate-500">Data facturii</span><input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50" /></label>
        </div>
        {company && <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-slate-50 border border-slate-100 p-3 flex gap-2"><Building2 className="text-indigo-600 shrink-0" size={18} /><div><div className="font-semibold text-slate-800">{company.name}</div><div className="text-slate-500">{company.address || 'Adresă necompletată'}</div></div></div><div className="rounded-xl bg-slate-50 border border-slate-100 p-3 flex gap-2"><Store className="text-indigo-600 shrink-0" size={18} /><div><div className="font-semibold text-slate-800">Emitent: {issuer?.legal_name || 'Neatribuit'}</div><div className="text-slate-500">Referință estimată: {issuer?.invoice_series ? `${issuer.invoice_series}-${issuer.next_invoice_number}` : 'configurare incompletă'}</div></div></div></div>}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-col md:flex-row md:items-end gap-3 justify-between">
          <div><h2 className="font-bold text-slate-900 flex items-center gap-2"><Package size={19} className="text-indigo-600" />Produsele facturii</h2><p className="text-sm text-slate-500 mt-1">Prețul standard este completat automat și poate fi ajustat pentru această factură.</p></div>
          <div className="flex gap-2 min-w-[420px]"><select value={productId} onChange={(event) => setProductId(event.target.value)} className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50"><option value="">Alege un produs...</option>{availableProducts.map((product) => <option key={product.id} value={product.id}>{String(product.name).toLocaleUpperCase('en-GB')} / {String(product.name_ro || product.name).toLocaleUpperCase('ro-RO')}</option>)}</select><button type="button" onClick={addProduct} disabled={!productId} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold disabled:opacity-40"><Plus size={17} />Adaugă</button></div>
        </div>

        {resolvedLines.length === 0 ? <div className="p-12 text-center text-slate-500"><Package size={42} className="mx-auto text-slate-300 mb-3" /><p>Nu ai adăugat încă produse.</p></div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-5 py-3">Produs</th><th className="text-center px-3 py-3 w-28">Unitate</th><th className="text-center px-3 py-3 w-32">Cantitate</th><th className="text-center px-3 py-3 w-36">Preț unitar</th><th className="text-right px-4 py-3 w-32">Total</th><th className="w-14"></th></tr></thead><tbody className="divide-y divide-slate-100">{resolvedLines.map((line, index) => <tr key={line.productId}><td className="px-5 py-4"><BilingualProductName name={line.product?.name} nameRo={line.product?.name_ro} /></td><td className="px-3 py-4 text-center text-slate-600">{line.product?.unit || 'buc'}</td><td className="px-3 py-4"><NumericInput decimalScale={3} value={line.quantity} onValueChange={(value) => updateLine(index, { quantity: value })} className="w-full text-center border border-slate-200 rounded-lg px-2 py-2" /></td><td className="px-3 py-4"><NumericInput decimalScale={2} value={line.unitPrice} onValueChange={(value) => updateLine(index, { unitPrice: value })} className="w-full text-center border border-slate-200 rounded-lg px-2 py-2" /></td><td className="px-4 py-4 text-right font-bold">£{line.totalPrice.toFixed(2)}</td><td className="px-3 py-4"><button type="button" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg" title="Elimină produsul"><Trash2 size={16} /></button></td></tr>)}</tbody></table></div>}

        <div className="p-5 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row gap-4 items-center justify-between"><div className="text-sm text-slate-500">{lines.length} {lines.length === 1 ? 'produs' : 'produse'} · denumirile EN/RO sunt preluate din catalog</div><div className="flex items-center gap-5"><div className="text-right"><div className="text-xs uppercase font-semibold text-slate-500">Total factură</div><div className="text-2xl font-bold text-indigo-700">£{total.toFixed(2)}</div></div><button type="button" onClick={issueInvoice} disabled={!isWriter || issuing || !storeId || lines.length === 0} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-6 py-3 rounded-xl font-semibold shadow-sm">{issuing ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}{issuing ? 'Se emite...' : 'Emite factura'}</button></div></div>
      </section>
    </div>
  );
}
