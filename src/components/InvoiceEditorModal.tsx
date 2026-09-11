import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { api } from '../shared/api';
import { NumericInput } from './NumericInput';
import { prepareInvoiceDocument } from '../utils/prepareInvoiceDocument';
import { saveInvoiceEdits } from '../utils/saveInvoiceEdits';

export function InvoiceEditorModal({ invoiceId, onClose, onSaved }: {
  invoiceId: number;
  onClose: () => void;
  onSaved: (invoice: any, message: string) => void;
}) {
  const [invoice, setInvoice] = useState<any>(null);
  const [date, setDate] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [removedItems,setRemovedItems] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [productId, setProductId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [catalogError, setCatalogError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [error, setError] = useState('');
  const [stage, setStage] = useState<'idle' | 'saving' | 'documents'>('idle');
  const busy = useRef(false);
  const [isWriter, setIsWriter] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    Promise.all([api.billing.getInvoice(invoiceId), api.system.getDeviceRole()])
      .then(async ([row, device]) => {
        if (!active) return;
        setInvoice(row);
        setIsWriter(device.role === 'writer');
        setDate(row.invoice_date);
        setItems(row.items.map((item: any) => ({ ...item, quantity: String(item.quantity), unitPrice: String(item.unitPrice) })));
        if (device.role !== 'writer' || row.status === 'cancelled') { setCatalogLoading(false); return; }
        try {
          const rows = await api.billing.getInvoiceProducts(invoiceId);
          if (active) setProducts(rows || []);
        } catch {
          if (active) setCatalogError('Tarifele clientului nu pot fi verificate în VR Baker. Verifică conexiunea și actualizarea API-ului, apoi redeschide editorul. Pozițiile existente pot fi editate în continuare.');
        } finally {
          if (active) setCatalogLoading(false);
        }
      })
      .catch((failure) => { if (active) setError(failure.message || 'Factura nu a putut fi încărcată.'); });
    return () => { active = false; previousFocus?.focus(); };
  }, [invoiceId]);

  const blocked = !isWriter || invoice?.status === 'cancelled' || Number(invoice?.creditedAmount || 0) > 0.005 || Number(invoice?.appliedCredit || 0) > 0.005;
  const total = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0);
  const changeItem = (index: number, field: string, value: string) => setItems((previous) => previous.map((item, i) => i === index ? { ...item, [field]: value } : item));
  const addProduct = () => {
    if (blocked || busy.current || catalogLoading || catalogError) return;
    const product = products.find((row) => String(row.id) === productId);
    if (!product) return;
    setItems((previous) => [...previous, {
      productId: product.id, productName: product.name, name_ro: product.name_ro,
      variant_label: product.variant_label, unit: product.unit,
      externalProductId: product.supabase_product_id, productOrder: product.display_order,
      quantity: '1', unitPrice: String(product.unitPrice),
    }]);
    setProductId('');
  };

  const save = async () => {
    if (busy.current || blocked || !invoice) return;
    setError('');
    if (!date || !items.length || items.some((item) => !item.productName.trim() || !String(item.quantity).trim() || !String(item.unitPrice).trim() || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0 || !Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0)) {
      setError('Completează data, cantități mai mari decât zero și prețuri valide pentru toate produsele.');
      return;
    }
    busy.current = true;
    setStage('saving');
    try {
      const result = await saveInvoiceEdits({
        id: invoiceId, invoiceDate: date,
        items: [...items.map((item) => ({ ...item, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice) })), ...removedItems],
      }, {
        update: api.billing.updateInvoice,
        prepare: prepareInvoiceDocument,
        upload: api.system.uploadPdfToCloud,
        onCommitted: (saved) => { setInvoice(saved); setStage('documents'); },
      });
      onSaved(result.invoice, result.message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Factura nu a putut fi salvată.');
    } finally {
      busy.current = false;
      setStage('idle');
    }
  };

  return <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="invoice-editor-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy.current) onClose();
        if (event.key !== 'Tab') return;
        const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
      <div className="p-6 border-b border-slate-100 flex items-center justify-between">
        <h3 id="invoice-editor-title" className="text-xl font-bold text-slate-900">Modificare factură {invoice ? '#' + invoice.invoice_number : ''}</h3>
        <button type="button" onClick={onClose} disabled={stage !== 'idle'} aria-label="Închide editarea" className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-40"><X size={20} /></button>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="p-6 space-y-4">
          {error && <p role="alert" className="rounded-xl bg-rose-50 text-rose-700 p-3">{error}</p>}
          {!invoice && !error && <p role="status" className="flex gap-2"><Loader2 className="animate-spin" />Se încarcă factura...</p>}
          {invoice && <>
            {blocked && <p role="status" className="text-amber-800 bg-amber-50 rounded-xl p-3">{!isWriter ? 'Modificarea este disponibilă numai pe calculatorul Writer.' : 'Factura anulată sau cu Credit Notes ori credit aplicat nu poate fi editată.'}</p>}
            <fieldset disabled={blocked || stage !== 'idle'} className="space-y-4">
              <p className="text-sm text-slate-600">{invoice.company_name} · {invoice.store_name}</p>
              <label className="block text-sm font-semibold">Data emiterii
                <input type="date" required value={date} onChange={(event) => setDate(event.target.value)} className="block mt-1 px-3 py-2 border rounded-lg" />
              </label>
              <p className="text-sm text-emerald-800">Încasări păstrate: £{Number(invoice.paid_amount || 0).toFixed(2)}. Totalul și statusul plății se recalculează la salvare.</p>
              {Boolean(invoice.is_imported) && <p className="text-sm bg-indigo-50 text-indigo-800 p-3 rounded-xl">Poți adăuga produse din catalog și corecta manual cantitățile și prețurile. Pozițiile salvate și comenzile originale din VR Baker sunt păstrate.</p>}
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="text-left text-slate-600"><th className="p-2">Produs</th><th className="p-2 w-28">Cantitate</th><th className="p-2 w-28">Preț unitar</th><th className="p-2">Total</th><th /></tr></thead>
                <tbody>{items.map((item, index) => <tr key={item.id ?? 'new-' + index} className="border-t">
                  <td className="p-2"><input aria-label={'Produs ' + (index + 1)} readOnly={Boolean(invoice.is_imported) || item.productId !== undefined} value={item.productName} onChange={(event) => changeItem(index, 'productName', event.target.value)} className="w-full border rounded p-2" /></td>
                  <td className="p-2"><NumericInput aria-label={'Cantitate ' + (index + 1)} value={item.quantity} onValueChange={(value) => changeItem(index, 'quantity', value)} className="w-full border rounded p-2" /></td>
                  <td className="p-2"><NumericInput aria-label={'Preț unitar ' + (index + 1)} value={item.unitPrice} onValueChange={(value) => changeItem(index, 'unitPrice', value)} className="w-full border rounded p-2" /></td>
                  <td className="p-2 font-semibold">£{(Number(item.quantity) * Number(item.unitPrice)).toFixed(2)}</td>
                  <td>{(!invoice.is_imported || item.id === undefined || (String(item.quantity).trim() !== '' && Number(item.quantity) === 0)) && <button type="button" title="Șterge poziția" aria-label={'Șterge poziția ' + (index + 1)} onClick={() => { if (invoice.is_imported && item.id !== undefined) setRemovedItems(previous => [...previous, {...item, quantity:0, unitPrice:Number(item.unitPrice),remove:true}]); setItems((previous) => previous.filter((_, i) => i !== index)); }} className="p-2 text-rose-600"><Trash2 size={16} /></button>}</td>
                </tr>)}</tbody>
              </table></div>
              {catalogError && <p role="alert" className="text-amber-800">{catalogError}</p>}
              <label className="block text-sm font-semibold">Caută produs<input type="search" value={productSearch} onChange={event => setProductSearch(event.target.value)} className="block w-full mt-1 border rounded-lg p-2" /></label>
              <div className="flex items-end gap-2">
                <label className="flex-1 text-sm font-semibold">Adaugă produs din catalog
                  <select value={productId} onChange={(event) => setProductId(event.target.value)} disabled={catalogLoading || Boolean(catalogError)} className="block mt-1 w-full border rounded-lg p-2">
                    <option value="">{catalogLoading ? 'Se încarcă produsele...' : products.length ? 'Alege produsul...' : 'Nu există produse disponibile'}</option>
                    {products.filter(product => `${product.name} ${product.name_ro || ''}`.toLowerCase().includes(productSearch.trim().toLowerCase())).map((product) => <option key={product.id} value={product.id}>{product.name}{product.name_ro ? ' / ' + product.name_ro : ''} — £{Number(product.unitPrice).toFixed(2)}</option>)}
                  </select>
                </label>
                <button type="button" title="Adaugă produs" aria-label="Adaugă produs" disabled={!productId || catalogLoading || Boolean(catalogError)} onClick={addProduct} className="p-2 rounded-lg text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"><Plus size={20} /></button>
              </div>
              <p className="text-xs text-slate-500">La adăugare se aplică tariful clientului din VR Baker, inclusiv reducerile configurate; în lipsa lor, prețul standard. Prețul unitar poate fi modificat doar pentru această factură, fără să schimbi tarifele din platformă.</p>
              <p className="text-right font-bold text-xl">Total: £{total.toFixed(2)}</p>
            </fieldset>
            {stage !== 'idle' && <p role="status" className="text-indigo-700">{stage === 'saving' ? 'Se salvează factura...' : 'Factura este salvată. Se actualizează PDF-ul și copia Google Drive...'}</p>}
          </>}
        </div>
        <div className="p-4 border-t flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={stage !== 'idle'} className="px-4 py-2 border rounded-xl disabled:opacity-40">Anulează</button>
          <button type="submit" disabled={!invoice || blocked || stage !== 'idle'} className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-xl disabled:opacity-40">{stage !== 'idle' ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}Salvează modificările</button>
        </div>
      </form>
    </div>
  </div>;
}
