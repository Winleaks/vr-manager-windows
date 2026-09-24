import { confirmAction, notify } from '../utils/feedback';
import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Building2, CheckCircle2, FilePlus2, Loader2, Package, Plus, Search, Store, Trash2 } from 'lucide-react';
import { api } from '../shared/api';
import { NumericInput } from '../components/NumericInput';
import { BilingualProductName } from '../components/BilingualProductName';
import { generateInvoicePDF } from '../utils/pdfGenerator';

interface ManualLine {
  productId?: number;
  productName?: string;
  nameRo?: string;
  unit?: string;
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
  const [invoiceMode, setInvoiceMode] = useState<'company' | 'oneOff'>('company');
  const [oneOffCustomer, setOneOffCustomer] = useState({ name: '', address: '', cui: '', regCom: '', phone: '' });
  const [oneOffIssuerId, setOneOffIssuerId] = useState('');
  const [customProduct, setCustomProduct] = useState({ name: '', unit: 'buc', quantity: '1', unitPrice: '' });
  const [clientSearch,setClientSearch] = useState('');
  const [showClientResults, setShowClientResults] = useState(false);
  const [storeId, setStoreId] = useState('');
  const [productId, setProductId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayLocal());
  const [lines, setLines] = useState<ManualLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [isWriter, setIsWriter] = useState(false);

  useEffect(() => {
    Promise.all([
      api.billing.getManualInvoiceCompanies(),
      api.billing.getProducts(),
      api.billing.getIssuers(),
      api.system.getDeviceRole(),
    ]).then(([nextCompanies, nextProducts, nextIssuers, device]) => {
      const activeCompanies = (nextCompanies || []).filter((company: any) => company.is_active !== 0);
      setCompanies(activeCompanies);
      setProducts((nextProducts || []).filter((product: any) => product.available !== 0 && product.available !== false));
      setIssuers(nextIssuers || []);
      setIsWriter(device.role === 'writer');
    }).catch((error) => {
      console.error(error);
      notify(error instanceof Error ? error.message : 'Datele pentru factura manuală nu au putut fi încărcate.');
    }).finally(() => setLoading(false));
  }, []);

  const company = companies.find((item) => String(item.id) === companyId);
  const matchingCompanies = clientSearch.trim() ? companies.filter((item) =>
    `${item.name} ${(item.stores || []).map((store: any) => store.name).join(' ')}`
      .toLocaleLowerCase('ro-RO').includes(clientSearch.trim().toLocaleLowerCase('ro-RO')),
  ) : [];
  const stores = (company?.stores || []).filter((store: any) => store.is_active !== 0);
  const issuer = issuers.find((item) => Number(item.id) === Number(company?.issuer_id));

  useEffect(() => {
    const nextCompany = companies.find((item) => String(item.id) === companyId);
    const nextStore = (nextCompany?.stores || []).find((store: any) => store.is_active !== 0);
    setStoreId(nextStore ? String(nextStore.id) : '');
  }, [companyId, companies]);

  const selectedStore = stores.find((item: any) => String(item.id) === storeId);
  const availableProducts = products.filter((product) => !lines.some((line) => line.productId !== undefined && line.productId === Number(product.id)));
  const resolvedLines = useMemo(() => lines.map((line) => {
    const product = products.find((item) => Number(item.id) === line.productId);
    const quantity = Number(line.quantity || 0);
    const unitPrice = Number(line.unitPrice || 0);
    return { ...line, product, displayName: line.productName || product?.name || '', numericQuantity: quantity, numericUnitPrice: unitPrice, totalPrice: quantity * unitPrice };
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

  const addCustomProduct = () => {
    const name = customProduct.name.trim();
    const unitPrice = Number(customProduct.unitPrice);
    const quantity = Number(customProduct.quantity);
    if (!name || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
      notify('Completează denumirea, cantitatea și prețul produsului ocazional.');
      return;
    }
    setLines(current => [...current, { productName: name, unit: customProduct.unit.trim() || 'buc', quantity: customProduct.quantity, unitPrice: customProduct.unitPrice }]);
    setCustomProduct({ name: '', unit: 'buc', quantity: '1', unitPrice: '' });
  };

  const updateLine = (index: number, patch: Partial<ManualLine>) => {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  };

  const issueInvoice = async () => {
    if (!isWriter) return notify('Factura manuală poate fi emisă numai de pe calculatorul Writer.');
    if (invoiceMode === 'company' && (!company || !selectedStore)) return notify('Selectează compania și magazinul facturat.');
    if (invoiceMode === 'company' && !issuer) return notify('Compania selectată nu are o societate emitentă atribuită.');
    if (invoiceMode === 'oneOff' && !oneOffCustomer.name.trim()) return notify('Completează numele clientului ocazional.');
    if (!invoiceDate) return notify('Selectează data facturii.');
    if (resolvedLines.length === 0) return notify('Adaugă cel puțin un produs pe factură.');
    if (resolvedLines.some((line) => (!line.product && !line.productName?.trim()) || !line.quantity.trim() || !line.unitPrice.trim() || line.numericQuantity <= 0 || line.numericUnitPrice < 0 || !Number.isFinite(line.totalPrice))) {
      return notify('Verifică produsele, cantitățile și prețurile introduse.');
    }
    const selectedIssuer = invoiceMode === 'company' ? issuer : issuers.find((item) => item.is_active !== 0 && Number(item.id) === Number(oneOffIssuerId));
    if (invoiceMode === 'oneOff' && !selectedIssuer) return notify('Selectează societatea emitentă.');
    const estimatedReference = selectedIssuer?.invoice_series ? `${selectedIssuer.invoice_series}-${selectedIssuer.next_invoice_number}` : 'numărul următor';
    const customerLabel = invoiceMode === 'company' ? company!.name : oneOffCustomer.name.trim();
    if (!(await confirmAction(`Emiți factura ${estimatedReference} pentru ${customerLabel}, în valoare de £${total.toFixed(2)}?`))) return;

    setIssuing(true);
    let created: any;
    try {
      created = await api.billing.createManualInvoice({
        ...(invoiceMode === 'company' ? { storeId: Number(selectedStore!.id) } : { issuerId: Number(selectedIssuer!.id), oneOffCustomer }),
        invoiceDate,
        items: resolvedLines.map((line) => ({
          ...(invoiceMode === 'company' ? { productId: line.productId } : { productName: line.productName || line.product?.name, nameRo: line.nameRo || line.product?.name_ro, unit: line.unit || line.product?.unit }),
          quantity: line.numericQuantity,
          unitPrice: line.numericUnitPrice,
        })),
      });
    } catch (error) {
      setIssuing(false);
      return notify(`Factura nu a fost emisă: ${error instanceof Error ? error.message : 'eroare necunoscută'}`);
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
          accountOutstanding: invoice.accountOutstanding,
        },
      );
      const localSave = await api.system.savePdfAuto({ buffer, invoiceId: created.invoiceId });
      if (!localSave.success) throw new Error(localSave.error || 'PDF-ul nu a putut fi salvat local.');
      const cloudSave = await api.system.uploadPdfToCloud(created.invoiceId);
      notify(cloudSave.success
        ? `Factura #${created.invoiceNumber} a fost emisă, salvată local și verificată în Google Drive.`
        : `Factura #${created.invoiceNumber} a fost emisă și salvată local, dar nu a fost confirmată în Google Drive: ${cloudSave.error || 'Eroare necunoscută'}`);
    } catch (error) {
      notify(`Factura #${created.invoiceNumber} a fost emisă, dar PDF-ul nu a putut fi pregătit acum. Îl poți regenera din pagina Facturi. ${error instanceof Error ? error.message : ''}`);
    } finally {
      setIssuing(false);
      window.location.hash = '/facturare/facturi';
    }
  };

  if (loading) return <div className="p-12 flex items-center justify-center gap-3 text-slate-500"><Loader2 className="animate-spin" />Se încarcă datele...</div>;

  return (
    <div className="p-4 sm:p-8 w-full min-w-0 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3"><div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center"><FilePlus2 size={22} /></div><h1 className="text-3xl font-bold text-slate-900">Factură manuală</h1></div>
          <p className="text-slate-500 mt-2">Emite o factură pentru un client permanent sau pentru o vânzare ocazională din fabrică.</p>
        </div>
      </div>

      {!isWriter && <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 flex gap-2"><AlertCircle size={18} />Calculatorul Viewer poate consulta facturile, dar nu poate emite facturi manuale.</div>}

      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
        <div className="flex flex-wrap gap-2 rounded-xl bg-slate-50 p-1.5 border border-slate-200" role="tablist" aria-label="Tip client facturat">
          <button type="button" role="tab" aria-selected={invoiceMode === 'company'} onClick={() => { setInvoiceMode('company'); setLines([]); }} className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold ${invoiceMode === 'company' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>Client permanent</button>
          <button type="button" role="tab" aria-selected={invoiceMode === 'oneOff'} onClick={() => { setInvoiceMode('oneOff'); setCompanyId(''); setStoreId(''); setLines([]); }} className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold ${invoiceMode === 'oneOff' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500'}`}>Client ocazional</button>
        </div>
        {invoiceMode === 'oneOff' ? <div className="space-y-4 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-indigo-900"><Building2 size={18} />Date client ocazional</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="space-y-1.5 md:col-span-2"><span className="text-xs font-semibold uppercase text-slate-500">Nume client / societate *</span><input value={oneOffCustomer.name} onChange={e => setOneOffCustomer(current => ({ ...current, name: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-white" placeholder="Ex.: John Smith sau ABC Trading Ltd" /></label>
            <label className="space-y-1.5 md:col-span-2"><span className="text-xs font-semibold uppercase text-slate-500">Adresă</span><input value={oneOffCustomer.address} onChange={e => setOneOffCustomer(current => ({ ...current, address: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-white" /></label>
            <label className="space-y-1.5"><span className="text-xs font-semibold uppercase text-slate-500">CUI / VAT</span><input value={oneOffCustomer.cui} onChange={e => setOneOffCustomer(current => ({ ...current, cui: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-white" /></label>
            <label className="space-y-1.5"><span className="text-xs font-semibold uppercase text-slate-500">Nr. înregistrare</span><input value={oneOffCustomer.regCom} onChange={e => setOneOffCustomer(current => ({ ...current, regCom: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-white" /></label>
            <label className="space-y-1.5"><span className="text-xs font-semibold uppercase text-slate-500">Telefon</span><input value={oneOffCustomer.phone} onChange={e => setOneOffCustomer(current => ({ ...current, phone: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-white" /></label>
            <label className="space-y-1.5"><span className="text-xs font-semibold uppercase text-slate-500">Societate emitentă *</span><select id="manual-one-off-issuer" value={oneOffIssuerId} onChange={e => setOneOffIssuerId(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-white"><option value="">Selectează emitentul</option>{issuers.filter(item => item.is_active !== 0).map(item => <option key={item.id} value={item.id}>{item.legal_name}</option>)}</select></label>
          </div>
          <p className="text-xs text-slate-500">Clientul este păstrat doar ca destinatar al acestei facturi și nu intră în lista clienților permanenți sau în sincronizarea VR Baker.</p>
        </div> : <>
        <div className="space-y-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase text-slate-500">Caută companie sau magazin</span>
            <div className="relative">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input type="search" value={clientSearch} placeholder="Scrie numele și alege compania din rezultate..." autoComplete="off"
                onFocus={() => setShowClientResults(true)}
                onKeyDown={(event) => { if (event.key === 'Escape') setShowClientResults(false); }}
                onChange={(event) => { setClientSearch(event.target.value); setCompanyId(''); setStoreId(''); setShowClientResults(true); }}
                aria-controls="manual-client-results"
                className="w-full min-w-0 border border-slate-200 rounded-xl pl-10 pr-3 py-2.5 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
            </div>
          </label>
          {showClientResults && clientSearch.trim() && <div id="manual-client-results" className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100" aria-label="Rezultate companii">
            {matchingCompanies.length ? matchingCompanies.map((item) => <button key={item.id} type="button"
              onClick={() => { setCompanyId(String(item.id)); setClientSearch(item.name); setShowClientResults(false); }}
              className="w-full min-w-0 flex items-start gap-3 px-4 py-3 text-left hover:bg-indigo-50 focus-visible:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">
              <Building2 size={18} className="text-indigo-600 shrink-0 mt-0.5" />
              <span className="min-w-0 break-words"><span className="block text-sm font-semibold text-slate-800">{item.name}</span><span className="block text-xs text-slate-500">{(item.stores || []).map((store: any) => store.name).join(' · ') || item.address}</span></span>
            </button>) : <p role="status" className="px-4 py-3 text-sm text-slate-500">Nu există companii sau magazine pentru această căutare.</p>}
          </div>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="space-y-1.5"><span className="text-xs font-semibold uppercase text-slate-500">Magazin / punct de livrare</span><select value={storeId} onChange={(event) => setStoreId(event.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50"><option value="">Selectează magazinul</option>{stores.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="space-y-1.5"><span className="text-xs font-semibold uppercase text-slate-500">Data facturii</span><input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50" /></label>
        </div>
        {company && <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-slate-50 border border-slate-100 p-3 flex gap-2"><Building2 className="text-indigo-600 shrink-0" size={18} /><div><div className="font-semibold text-slate-800">{company.name}</div><div className="text-slate-500">{company.address || 'Adresă necompletată'}</div></div></div><div className="rounded-xl bg-slate-50 border border-slate-100 p-3 flex gap-2"><Store className="text-indigo-600 shrink-0" size={18} /><div><div className="font-semibold text-slate-800">Emitent: {issuer?.legal_name || 'Neatribuit'}</div><div className="text-slate-500">Referință estimată: {issuer?.invoice_series ? `${issuer.invoice_series}-${issuer.next_invoice_number}` : 'configurare incompletă'}</div></div></div></div>}
        </>}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-col gap-4">
          <div><h2 className="font-bold text-slate-900 flex items-center gap-2"><Package size={19} className="text-indigo-600" />Produsele facturii</h2><p className="text-sm text-slate-500 mt-1">Prețul standard este completat automat și poate fi ajustat pentru această factură.</p></div>
          <div className="flex items-center gap-2 w-full min-w-0">
            <select aria-label="Produs din catalog" value={productId} onChange={(event) => setProductId(event.target.value)} className="w-full min-w-0 flex-1 border border-slate-200 rounded-xl px-3 py-2.5 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"><option value="">Alege un produs...</option>{availableProducts.map((product) => <option key={product.id} value={product.id}>{String(product.name).toLocaleUpperCase('en-GB')} / {String(product.name_ro || product.name).toLocaleUpperCase('ro-RO')}</option>)}</select>
            <button type="button" onClick={addProduct} disabled={!productId} title="Adaugă produsul pe factură" aria-label="Adaugă produsul pe factură" className="shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"><Plus size={19} /></button>
          </div>
          {invoiceMode === 'oneOff' && <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_120px_140px_44px] gap-2 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 p-3">
            <input value={customProduct.name} onChange={e => setCustomProduct(current => ({ ...current, name: e.target.value }))} placeholder="Denumire produs / bun vândut" aria-label="Denumire produs ocazional" className="border border-slate-200 rounded-lg px-3 py-2 bg-white" />
            <input value={customProduct.unit} onChange={e => setCustomProduct(current => ({ ...current, unit: e.target.value }))} placeholder="Unitate" aria-label="Unitate produs ocazional" className="border border-slate-200 rounded-lg px-3 py-2 bg-white" />
            <div className="flex gap-2"><NumericInput value={customProduct.quantity} onValueChange={value => setCustomProduct(current => ({ ...current, quantity: value }))} aria-label="Cantitate produs ocazional" className="w-full border border-slate-200 rounded-lg px-2 py-2 bg-white" /><NumericInput value={customProduct.unitPrice} onValueChange={value => setCustomProduct(current => ({ ...current, unitPrice: value }))} aria-label="Preț produs ocazional" className="w-full border border-slate-200 rounded-lg px-2 py-2 bg-white" /></div>
            <button type="button" onClick={addCustomProduct} title="Adaugă produsul ocazional" aria-label="Adaugă produsul ocazional" className="inline-flex items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"><Plus size={18} /></button>
          </div>}
        </div>

        {resolvedLines.length === 0 ? <div className="p-12 text-center text-slate-500"><Package size={42} className="mx-auto text-slate-300 mb-3" /><p>Nu ai adăugat încă produse.</p></div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-slate-500 text-xs uppercase"><tr><th className="text-left px-5 py-3">Produs</th><th className="text-center px-3 py-3 w-28">Unitate</th><th className="text-center px-3 py-3 w-32">Cantitate</th><th className="text-center px-3 py-3 w-36">Preț unitar</th><th className="text-right px-4 py-3 w-32">Total</th><th className="w-14"></th></tr></thead><tbody className="divide-y divide-slate-100">{resolvedLines.map((line, index) => <tr key={line.productId || `custom-${index}`}><td className="px-5 py-4">{line.product ? <BilingualProductName name={line.product.name} nameRo={line.product.name_ro} /> : <span className="font-semibold text-slate-800">{line.displayName}</span>}</td><td className="px-3 py-4 text-center text-slate-600">{line.unit || line.product?.unit || 'buc'}</td><td className="px-3 py-4"><NumericInput decimalScale={3} value={line.quantity} onValueChange={(value) => updateLine(index, { quantity: value })} className="w-full text-center border border-slate-200 rounded-lg px-2 py-2" /></td><td className="px-3 py-4"><NumericInput decimalScale={2} value={line.unitPrice} onValueChange={(value) => updateLine(index, { unitPrice: value })} className="w-full text-center border border-slate-200 rounded-lg px-2 py-2" /></td><td className="px-4 py-4 text-right font-bold">£{line.totalPrice.toFixed(2)}</td><td className="px-3 py-4"><button type="button" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg" title="Elimină produsul"><Trash2 size={16} /></button></td></tr>)}</tbody></table></div>}

        <div className="p-5 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row gap-4 items-center justify-between"><div className="text-sm text-slate-500">{lines.length} {lines.length === 1 ? 'produs' : 'produse'}{invoiceMode === 'oneOff' ? ' · produse introduse manual' : ' · denumirile EN/RO sunt preluate din catalog'}</div><div className="flex items-center gap-5"><div className="text-right"><div className="text-xs uppercase font-semibold text-slate-500">Total factură</div><div className="text-2xl font-bold text-indigo-700">£{total.toFixed(2)}</div></div><button type="button" onClick={issueInvoice} disabled={!isWriter || issuing || (invoiceMode === 'company' ? !storeId : !oneOffCustomer.name.trim() || !oneOffIssuerId) || lines.length === 0} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-6 py-3 rounded-xl font-semibold shadow-sm">{issuing ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}{issuing ? 'Se emite...' : 'Emite factura'}</button></div></div>
      </section>
    </div>
  );
}
