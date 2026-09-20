import { useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, Loader2, X } from 'lucide-react';
import { api } from '../shared/api';
import type { InvoiceIssuerChangeOptions } from '../shared/invoiceIssuerChange';
import { prepareInvoiceDocument } from '../utils/prepareInvoiceDocument';

type Props = ({ registry: 'normal'; invoiceId: number } | { registry: 'protected'; invoiceId: string }) & {
  onClose: () => void;
  onComplete: (message: string) => void;
};

export function InvoiceIssuerChangeModal(props: Props) {
  const [options, setOptions] = useState<InvoiceIssuerChangeOptions | null>(null);
  const [issuerId, setIssuerId] = useState('');
  const [date, setDate] = useState(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; });
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  const operation = useRef({ key: '', id: '' });
  const dialog = useRef<HTMLDivElement>(null);
  const { registry, invoiceId } = props;
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus({ preventScroll: true });
    const request = registry === 'normal'
      ? api.billing.getInvoiceIssuerChangeOptions(invoiceId as number)
      : api.protectedRegistry.getInvoiceIssuerChangeOptions(invoiceId as string);
    request.then((data) => { if (active) { setOptions(data); setIssuerId(String(data.issuers[0]?.id || '')); } })
      .catch((failure) => { if (active) setError(failure.message || 'Datele facturii nu pot fi verificate.'); });
    return () => { active = false; mounted.current = false; previous?.focus({ preventScroll: true }); };
  }, [registry, invoiceId]);
  const issuer = options?.issuers.find((row) => String(row.id) === issuerId);
  const submit = async () => {
    if (pending.current || !options || options.blockedReason || !issuer || !reason.trim() || !date) return;
    pending.current = true; setBusy(true); setError('');
    const fields = { expectedReference: options.reference, targetIssuerId: issuer.id, invoiceDate: date, reason: reason.trim() };
    const key = JSON.stringify(fields);
    if (operation.current.key !== key) operation.current = { key, id: crypto.randomUUID() };
    let message: string;
    try {
      if (props.registry === 'normal') {
        const result = await api.billing.changeInvoiceIssuer({ ...fields, invoiceId: props.invoiceId, operationId: operation.current.id });
        message = `Factura ${options.reference} a fost anulată și înlocuită cu ${result.invoiceNumber}.`;
        // Issuance has committed. A rendering/upload failure must never restart it.
        try { await prepareInvoiceDocument(result.invoiceId, true); }
        catch { message += ' PDF-ul rămâne în așteptare pentru sincronizare; poți reîncerca documentul din registru.'; }
      } else {
        const result = await api.protectedRegistry.changeInvoiceIssuer({ ...fields, invoiceId: props.invoiceId, operationId: operation.current.id });
        message = `Factura ${options.reference} a fost anulată și înlocuită cu ${result.invoice.reference}.`;
        if (result.pdf.pending) message += ' Salvare temporară criptată; sincronizarea în Drive continuă în fundal.';
        if (!result.pdf.success) message += ' PDF-ul trebuie regenerat folosind Deschide PDF, fără reemiterea facturii.';
      }
    } catch (failure) {
      if (mounted.current) { setError(failure instanceof Error ? failure.message : 'Operațiunea nu a putut fi confirmată. Reîncearcă aceleași date.'); setBusy(false); }
      pending.current = false;
      return;
    }
    pending.current = false;
    if (mounted.current) { setBusy(false); props.onComplete(message); }
  };
  return <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="issuer-change-title" className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && !pending.current) props.onClose();
        if (event.key !== 'Tab') return;
        const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)');
        const available = Array.from(controls || []).filter((node) => !node.matches(':disabled'));
        const first = available[0], last = available.at(-1);
        if (!first || !last) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <header className="p-6 border-b border-slate-100 flex items-center justify-between gap-3"><h2 id="issuer-change-title" className="text-xl font-bold text-slate-900 flex items-center gap-2"><ArrowRightLeft size={22} className="text-indigo-600" />Schimbă emitentul</h2><button type="button" disabled={busy} onClick={props.onClose} title="Închide" aria-label="Închide schimbarea emitentului" className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-40"><X size={20} /></button></header>
      <form className="flex flex-col min-h-0" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="p-6 space-y-4 overflow-y-auto min-h-0">
          {error && <p role="alert" className="rounded-xl bg-rose-50 text-rose-700 p-3">{error}</p>}
          {!options && !error && <p role="status">Se verifică factura…</p>}
          {options && <><p className="text-sm text-slate-600">Factura {options.reference} · {options.issuerName}</p>
            {options.blockedReason && <p role="status" className="bg-amber-50 text-amber-800 rounded-xl p-3">{options.blockedReason}</p>}
            {!options.issuers.length && <p role="status" className="text-amber-800">Nu există un alt emitent activ și configurat complet.</p>}
            <fieldset disabled={busy || Boolean(options.blockedReason)} className="space-y-4">
              <label className="block text-sm font-semibold">Societate emitentă nouă<select required value={issuerId} onChange={(e) => setIssuerId(e.target.value)} className="block mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5">{options.issuers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
              {issuer && <p className="text-sm text-indigo-700 bg-indigo-50 rounded-xl p-3">Referință estimată: <strong>{issuer.series}-{issuer.nextNumber}</strong>. Numărul final se alocă la confirmare.</p>}
              <label className="block text-sm font-semibold">Data facturii înlocuitoare<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="block mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5" /></label>
              <label className="block text-sm font-semibold">Motivul schimbării<textarea required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="block mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5" /></label>
            </fieldset>
            <p className="text-sm text-amber-900 bg-amber-50 rounded-xl p-3">Confirmarea anulează factura {options.reference} și creează o factură nouă la societatea selectată. Originalul rămâne în istoric. Emitentul implicit al clientului nu se schimbă.</p>
          </>}
        </div>
        <footer className="p-4 border-t border-slate-100 flex flex-wrap justify-end gap-3 shrink-0 bg-white"><button type="button" disabled={busy} onClick={props.onClose} className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-50">Renunță</button><button disabled={busy || !issuer || !reason.trim() || !date || Boolean(options?.blockedReason)} className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold flex items-center gap-2 disabled:opacity-50">{busy && <Loader2 size={17} className="animate-spin" />}{busy ? 'Se procesează…' : 'Anulează și emite înlocuitoarea'}</button></footer>
      </form>
    </div>
  </div>;
}
