import { useEffect, useRef, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from '../shared/api';
import { PinInput } from './PinInput';

/** Mounted only in the unlocked Writer workspace. Secrets never enter the
 * navigation cache, notifications, clipboard, downloads or browser storage. */
export function RecoveryKeySettings({ run, onLocked }: {
  run: <T>(action: () => Promise<T>) => Promise<T>;
  onLocked: () => void;
}) {
  const [pin, setPin] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!key) return;
    let active = true;
    const hide = setTimeout(() => setKey(''), 120_000);
    const check = setInterval(() => {
      void api.protectedRegistry.status().then(status => {
        if (active && (!status.unlocked || status.readOnly)) { setKey(''); onLocked(); }
      }).catch(() => { if (active) { setKey(''); onLocked(); } });
    }, 15_000);
    return () => { active = false; clearTimeout(hide); clearInterval(check); };
  }, [key, onLocked]);
  const generate = async () => {
    if (pending.current || key || !confirmed || !/^\d{6}$/.test(pin)) return;
    pending.current = true; setBusy(true); setError('');
    const currentPin = pin;
    setPin('');
    try {
      const result = await run(() => api.protectedRegistry.rotateRecoveryKey(currentPin, true));
      if (mounted.current) { setKey(result.recoveryKey); setConfirmed(false); }
    } catch (failure) {
      if (mounted.current) {
        setError(failure instanceof Error ? failure.message : 'Cheia nu a putut fi generată.');
        try {
          const status = await api.protectedRegistry.status();
          if (mounted.current && !status.unlocked) onLocked();
        } catch { if (mounted.current) onLocked(); }
      }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4" aria-labelledby="recovery-key-heading">
    <h2 id="recovery-key-heading" className="font-bold flex items-center gap-2"><KeyRound size={20} className="text-indigo-600" />Cheie de recuperare / activare Viewer</h2>
    <p className="text-sm text-slate-600">Dacă ai pierdut cheia, poți genera una nouă. Facturile, datele registrului și PIN-ul Writer-ului se păstrează. Calculatoarele Viewer deja activate își păstrează accesul.</p>
    {key ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
      <p className="font-semibold text-amber-900">Cheia nouă a fost confirmată în Google Drive. Aceasta este singura afișare.</p>
      <label className="block text-sm font-semibold">Cheie nouă de recuperare<input readOnly value={key} autoComplete="off" spellCheck={false} className="block w-full mt-2 font-mono select-all" /></label>
      <p className="text-sm text-amber-900">Păstreaz-o într-un loc sigur, separat de Drive. Pe Viewer, introdu această cheie la activare și alege un PIN nou. Nu trimite cheia în chat. Cheia dispare după două minute, la părăsirea paginii sau la blocarea registrului.</p>
      <button type="button" onClick={() => setKey('')} className="rounded-xl bg-slate-900 text-white px-4 py-2 font-semibold">Am salvat cheia — ascunde</button>
    </div> : <>
      <label className="block text-sm font-semibold max-w-sm">PIN actual Writer<PinInput value={pin} onValueChange={setPin} autoComplete="off" disabled={busy} className="block w-full mt-2" /></label>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />Confirm înlocuirea cheii pentru activări noi și înțeleg că trebuie să păstrez cheia nouă.</label>
      <button type="button" disabled={busy || !confirmed || !/^\d{6}$/.test(pin)} onClick={() => void generate()} className="rounded-xl bg-indigo-600 text-white px-4 py-2.5 font-semibold disabled:opacity-50">{busy ? 'Se generează și se verifică…' : 'Generează o cheie nouă de recuperare'}</button>
    </>}
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
  </section>;
}
