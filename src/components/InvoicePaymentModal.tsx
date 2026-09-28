import { useState, type FormEvent } from 'react';
import { Banknote, CheckCircle2, CreditCard, Loader2, X } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '../shared/api';
import { NumericInput } from './NumericInput';
import { notify } from '../utils/feedback';

type PaymentMethod = 'cash' | 'transfer';
type PaymentBank = 'Barclays' | 'Virgin' | 'HSBC';

export interface InvoicePaymentTarget {
  id: number;
  company_id: number;
  company_name?: string;
  store_name?: string;
  invoice_number: string;
  issuer_id?: number;
  issuer_name?: string;
  total_amount: number;
  paid_amount: number;
  outstanding?: number;
}

export function InvoicePaymentModal({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: InvoicePaymentTarget;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const outstanding = Math.max(0, Number(invoice.outstanding ?? (invoice.total_amount - invoice.paid_amount)));
  const [amount, setAmount] = useState(outstanding.toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [bankName, setBankName] = useState<PaymentBank>('Barclays');
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState(`Încasare factura #${invoice.invoice_number}`);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      notify('Introdu o sumă validă mai mare decât 0.');
      return;
    }
    if (!Number.isSafeInteger(invoice.company_id) || invoice.company_id <= 0 ||
        !Number.isSafeInteger(invoice.issuer_id) || Number(invoice.issuer_id) <= 0) {
      notify('Compania sau societatea emitentă a facturii nu este validă.');
      return;
    }

    setSaving(true);
    try {
      await api.billing.recordCompanyPayment({
        companyId: invoice.company_id,
        issuerId: invoice.issuer_id,
        invoiceId: invoice.id,
        amount: numericAmount,
        paymentDate,
        method,
        bankName: method === 'transfer' ? bankName : undefined,
        notes: notes.trim(),
      });
      notify(`Încasarea pentru factura #${invoice.invoice_number} a fost înregistrată.`);
      await onSaved();
    } catch (error) {
      notify('Încasarea nu a putut fi înregistrată: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
    <div role="dialog" aria-modal="true" aria-labelledby="invoice-payment-heading" className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-slate-50 p-5">
        <div>
          <h2 id="invoice-payment-heading" className="text-lg font-bold text-slate-900">Înregistrează plata</h2>
          <p className="mt-1 text-sm text-slate-500">Factura #{invoice.invoice_number} · {invoice.company_name}{invoice.store_name ? ` · ${invoice.store_name}` : ''}</p>
        </div>
        <button type="button" disabled={saving} onClick={onClose} title="Închide" aria-label="Închide formularul de încasare" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40"><X size={19} aria-hidden="true" /></button>
      </div>
      <form onSubmit={submit}>
        <fieldset disabled={saving} className="space-y-4 p-6 disabled:opacity-70">
          <div className="grid gap-3 rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 text-sm sm:grid-cols-2">
            <div><span className="block text-xs font-semibold uppercase text-indigo-700">Societate emitentă</span><b className="mt-1 block text-slate-900">{invoice.issuer_name || 'Emitentul facturii'}</b></div>
            <div><span className="block text-xs font-semibold uppercase text-indigo-700">Rest factură</span><b className="mt-1 block text-slate-900">£{outstanding.toFixed(2)}</b></div>
          </div>

          <label className="block text-xs font-semibold uppercase text-slate-600">Suma încasată (£)
            <NumericInput decimalScale={2} required min={0.01} value={amount} onValueChange={setAmount} className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 font-mono text-lg font-bold text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20" />
          </label>

          <div><div className="mb-1.5 text-xs font-semibold uppercase text-slate-600">Metodă plată</div><div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setMethod('cash')} className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-bold ${method === 'cash' ? 'border-amber-500 bg-amber-500 text-white' : 'border-slate-200 bg-slate-50 text-slate-700'}`}><Banknote size={17} aria-hidden="true" />Cash</button>
            <button type="button" onClick={() => setMethod('transfer')} className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-bold ${method === 'transfer' ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-slate-50 text-slate-700'}`}><CreditCard size={17} aria-hidden="true" />Transfer bancar</button>
          </div></div>

          {method === 'transfer' && <label className="block text-xs font-semibold uppercase text-slate-600">Banca
            <select value={bankName} onChange={event => setBankName(event.target.value as PaymentBank)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800"><option value="Barclays">Barclays</option><option value="Virgin">Virgin</option><option value="HSBC">HSBC</option></select>
          </label>}

          <label className="block text-xs font-semibold uppercase text-slate-600">Data încasării
            <input type="date" required value={paymentDate} onChange={event => setPaymentDate(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800" />
          </label>
          <label className="block text-xs font-semibold uppercase text-slate-600">Note / observații
            <input type="text" maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800" />
          </label>
          <p className="text-xs text-slate-500">Factura selectată este achitată prima. Orice surplus se distribuie către celelalte facturi restante ale aceleiași companii și aceluiași emitent, apoi rămâne credit disponibil.</p>
        </fieldset>
        <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <button type="button" disabled={saving} onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40">Anulează</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-emerald-400">{saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}{saving ? 'Se înregistrează…' : 'Confirmă încasarea'}</button>
        </div>
      </form>
    </div>
  </div>;
}
