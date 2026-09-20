import { useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { api } from '../shared/api';
import type { ProtectedSyncStatus } from '../../electron/protectedRegistry/outbox';

export function ProtectedSyncBanner({ onLocked }: { onLocked: () => void }) {
  const [status, setStatus] = useState<ProtectedSyncStatus | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await api.protectedRegistry.syncStatus(); if (!stopped) setStatus(next); }
      catch { if (!stopped) onLocked(); }
      finally { if (!stopped) timer = setTimeout(poll, 2000); }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [onLocked]);
  if (!status) return null;
  const retry = async () => {
    try { setStatus(await api.protectedRegistry.retrySync()); } catch { onLocked(); }
  };
  return <div role="status" aria-live="polite" className={`mb-4 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${status.state === 'error' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-indigo-100 bg-indigo-50 text-indigo-800'}`}>
    {status.state === 'synced' ? <CheckCircle2 size={18} aria-hidden="true" /> : <RefreshCw size={18} aria-hidden="true" className={status.state === 'syncing' ? 'animate-spin motion-reduce:animate-none' : ''} />}
    <span className="flex-1">{status.state === 'synced' ? 'Sincronizat în Drive. Nu există salvări locale în așteptare.' : status.error || `${status.pending} salvări criptate în așteptare. Sincronizarea continuă în fundal; poți continua lucrul. Trimiterea și printarea sunt disponibile după confirmare.`}</span>
    {status.state === 'error' && <button type="button" onClick={() => { void retry(); }} className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold">Reîncearcă</button>}
  </div>;
}
