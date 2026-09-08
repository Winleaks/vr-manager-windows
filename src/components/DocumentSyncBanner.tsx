import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../shared/api';

type Status = Awaited<ReturnType<typeof api.system.getDocumentSyncStatus>>;

export function DocumentSyncBanner() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await api.system.getDocumentSyncStatus();
        if (!stopped) { setStatus(next); setError(''); }
      } catch {
        if (!stopped) setError('Starea documentelor Drive nu poate fi verificată.');
      } finally {
        if (!stopped) timer = setTimeout(refresh, 5000);
      }
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  const retry = async () => {
    if (busy.current) return;
    busy.current = true; setRetrying(true);
    try { setStatus(await api.system.retryDocumentSync()); setError(''); }
    catch { setError('Reluarea nu a pornit. Verifică rolul Writer și conexiunea Drive.'); }
    finally { busy.current = false; setRetrying(false); }
  };
  if (!error && !status?.pending && !status?.workerError) return null;
  return <aside className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950">
    <div className="flex items-center justify-between gap-3">
      <p role="status">{error || status?.workerError || `Salvat local — PDF-uri neconfirmate în Drive: ${status?.pending}.`}</p>
      {status?.canRetry ? <button type="button" onClick={retry} disabled={retrying || status.running}
        title="Reîncearcă documentele în Drive" aria-label="Reîncearcă documentele în Drive"
        className="rounded p-2 hover:bg-amber-100 disabled:opacity-50 focus-visible:outline-2">
        <RefreshCw size={18} className={retrying || status.running ? 'animate-spin' : ''} />
      </button> : null}
    </div>
    {status?.pending ? <details>
      <summary className="cursor-pointer">Detalii sincronizare documente{status.blocked ? ` (${status.blocked} necesită intervenție)` : ''}</summary>
      <p>{!status.canRetry ? 'Încărcările se fac numai de pe Writer.' : !status.connected ? 'Drive nu este conectat. Reconectează contul din Setări.' : status.running ? 'Se încarcă documentele în Drive…' : 'Documentele în așteptare sunt reîncercate automat. Backupul bazei de date este separat.'}</p>
      <ul className="max-h-36 overflow-auto">
        {status.items.map(item => <li key={`${item.kind}:${item.document_id}`}>
          {item.kind === 'invoice' ? 'Factura' : 'Credit Note'} {item.reference}: {item.last_error || 'În așteptare'}
        </li>)}
      </ul>
      {status.pending > status.items.length ? <p>Se afișează primele {status.items.length} documente.</p> : null}
    </details> : null}
  </aside>;
}
