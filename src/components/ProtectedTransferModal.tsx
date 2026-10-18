import { useEffect, useRef, useState } from 'react';
import { api } from '../shared/api';
import { NumericInput } from './NumericInput';
import type { ProtectedTransferInput, ProtectedTransferResult } from '../shared/protectedTransfer';

type Preview = Awaited<ReturnType<typeof api.protectedRegistry.getTransferPreview>>;
const money = (n: number) => `£${n.toFixed(2)}`;
export function ProtectedTransferModal({ invoiceId, onClose, onChanged }: { invoiceId: string; onClose: () => void; onChanged: () => void }) {
  const [preview, setPreview] = useState<Preview>();
  const [amountDraft, setAmountDraft] = useState('');
  const amount = Number(amountDraft);
  const [date, setDate] = useState('');
  const [reference, setReference] = useState('');
  const [bankName, setBankName] = useState<NonNullable<ProtectedTransferInput['bankName']> | ''>('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProtectedTransferResult>();
  const request = useRef<ProtectedTransferInput | null>(null);
  const pending = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let active = true;
    dialog.current?.showModal();
    api.protectedRegistry.getTransferPreview(invoiceId).then(value => {
      if (!active) return;
      setPreview(value);
      request.current = value.invoice.transfer?.request || null;
      setAmountDraft(String(request.current?.amount || Math.round((value.invoice.totalAmount - value.invoice.paidAmount) * 100) / 100));
      setDate(request.current?.paymentDate || value.invoiceDate);
      setReference(request.current?.cardReference || '');
      setBankName(request.current?.bankName || '');
    }).catch(cause => { if (active) setError(String(cause.message || cause)); });
    return () => { active = false; };
  }, [invoiceId]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!preview || pending.current || (!request.current && !bankName)) return;
    request.current ||= { invoiceId, expectedVersion: preview.expectedVersion, amount, paymentDate: date, cardReference: reference.trim(), bankName: bankName || undefined, operationId: crypto.randomUUID() };
    pending.current = true; setBusy(true); setError('');
    try {
      const value = await api.protectedRegistry.transferInvoice(request.current);
      setResult(value); onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Transferul nu a putut fi confirmat.');
      // Reload persisted state: a failed cloud response may already have committed.
      try {
        const current = await api.protectedRegistry.getTransferPreview(invoiceId);
        setPreview(current);
        if (current.invoice.transfer) request.current = current.invoice.transfer.request;
        else request.current = null;
      } catch { /* Retain the exact request until its outcome can be read. */ }
      onChanged();
    } finally { pending.current = false; setBusy(false); }
  }
  const remaining = preview ? Math.round((preview.invoice.totalAmount-preview.invoice.paidAmount-amount)*100)/100 : 0;
  return <dialog ref={dialog} aria-labelledby="transfer-title" onCancel={event => { event.preventDefault(); if (!pending.current) onClose(); }} className="rounded-2xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto backdrop:bg-slate-900/50">
    <h2 id="transfer-title" className="text-xl font-bold">Încasează cu cardul și transferă</h2>
    {error && <p role="alert" className="my-3 text-rose-700">{error}</p>}
    {result ? <div className="space-y-4 mt-4"><p role="status">Factura {result.invoiceNumber} este în registrul normal. Transferul este definitiv.</p><p>PDF-ul se pregătește prin sincronizarea obișnuită. Îl poți deschide din factura nouă; nu reface transferul dacă PDF-ul întârzie.</p><button onClick={async () => { try { const opened = await api.system.openPdfFile(result.invoiceId); if (opened?.success === false) setError(opened.error || 'PDF-ul nu este încă disponibil. Reîncearcă deschiderea.'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'PDF indisponibil.'); } }} className="border rounded-lg px-4 py-2">Deschide PDF</button><button onClick={onClose} className="bg-indigo-600 text-white rounded-lg px-4 py-2">Închide</button></div> : preview ? <form onSubmit={submit} className="space-y-4 mt-4">
      <p><b>{preview.invoice.reference}</b> · {preview.invoice.companyName} · {preview.invoice.storeName}</p>
      <p>{preview.invoice.issuerCode === 'goodness' ? 'THE GOODNESS BAKER LTD' : 'VATRA ROMANEASCA LTD'} · Data noii facturi: {preview.invoice.transfer?.invoiceDate || preview.invoiceDate}</p>
      <p>Total {money(preview.invoice.totalAmount)} · Încasări existente {money(preview.invoice.paidAmount)}</p>
      {!!preview.payments.length && <ul className="text-sm text-slate-600">{preview.payments.map(row => <li key={row.id}>{row.paymentDate} · {row.method} · {money(row.amount)}</li>)}</ul>}
      {preview.blockedReason && !preview.invoice.transfer && <p className="text-amber-800">{preview.blockedReason}</p>}
      <fieldset disabled={busy || !!request.current} className="grid gap-3">
        <label>Suma plătită cu cardul<NumericInput aria-label="Suma plătită cu cardul" value={amountDraft} onValueChange={setAmountDraft} min={0.01} className="block w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        <label>Data încasării<input aria-label="Data încasării" type="date" value={date} max={preview.invoiceDate} min={preview.invoice.invoiceDate} onChange={event => setDate(event.target.value)} required className="block w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        <label>Banca<select aria-label="Banca" value={bankName} onChange={event => setBankName(event.target.value as typeof bankName)} required className="block w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Selectează banca</option><option value="Barclays">Barclays</option><option value="Virgin">Virgin</option><option value="HSBC">HSBC</option></select></label>
        <label>Referința tranzacției<input aria-label="Referința tranzacției" value={reference} maxLength={200} onChange={event => setReference(event.target.value)} required className="block w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
      </fieldset>
      <p>Rest după încasare: <b>{money(remaining)}</b></p>
      <p className="text-sm text-slate-600">Se transferă întreaga factură, cu următorul număr disponibil. Încasările existente se păstrează fără a dubla numerarul. Factura nu poate fi transferată înapoi.</p>
      <div className="flex gap-3"><button type="button" disabled={busy} onClick={onClose}>Închide</button><button disabled={busy || (!preview.invoice.transfer && (!!preview.blockedReason || amount <= 0 || remaining < 0 || !reference.trim() || !date || !bankName))} className="bg-indigo-600 disabled:opacity-50 text-white rounded-lg px-4 py-2">{busy ? 'Se finalizează transferul…' : preview.invoice.transfer ? 'Reia / verifică transferul' : 'Confirmă încasarea și transferul'}</button></div>
    </form> : !error && <p role="status">Se încarcă rezumatul…</p>}
    {!preview && <button onClick={onClose}>Închide</button>}
  </dialog>;
}
