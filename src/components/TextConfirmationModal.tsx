import { useState, type FormEvent } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface TextConfirmationModalProps {
  title: string;
  description: string;
  fieldLabel: string;
  confirmLabel: string;
  expectedText?: string;
  dangerous?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => Promise<void> | void;
}

export function TextConfirmationModal({
  title,
  description,
  fieldLabel,
  confirmLabel,
  expectedText,
  dangerous = false,
  onCancel,
  onConfirm,
}: TextConfirmationModalProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = value.trim().length > 0 && (!expectedText || value.trim().toLocaleUpperCase('ro-RO') === expectedText.toLocaleUpperCase('ro-RO'));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm(value.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Operațiunea nu a putut fi finalizată.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="text-confirmation-title">
      <form onSubmit={submit} className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-slate-50 p-5">
          <div className="flex items-start gap-3"><AlertTriangle className={dangerous ? 'text-rose-600' : 'text-amber-600'} size={22} /><div><h2 id="text-confirmation-title" className="font-bold text-slate-900">{title}</h2><p className="mt-1 text-sm text-slate-600">{description}</p></div></div>
          <button type="button" onClick={onCancel} className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label="Închide"><X size={19} /></button>
        </div>
        <div className="space-y-4 p-5">
          {expectedText && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Scrie exact: <strong>{expectedText}</strong></div>}
          <label className="block text-sm font-semibold text-slate-700">{fieldLabel}<input autoFocus maxLength={500} value={value} onChange={(event) => setValue(event.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15" /></label>
          {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">{error}</div>}
          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">Renunță</button><button type="submit" disabled={!valid || busy} className={`rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40 ${dangerous ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>{busy ? 'Se procesează...' : confirmLabel}</button></div>
        </div>
      </form>
    </div>
  );
}
