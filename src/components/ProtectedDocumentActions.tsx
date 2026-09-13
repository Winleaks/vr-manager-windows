import { useRef, useState } from 'react';
import { ExternalLink, Loader2, MessageCircle, Printer } from 'lucide-react';
import { api } from '../shared/api';

export function ProtectedDocumentActions({ id, type = 'invoice', status, notify }: {
  id: string; type?: 'invoice' | 'credit-note'; status?: string; notify: (message: string) => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const busy = useRef(false);
  if (status === 'cancelled') return null;
  const run = async (action: 'open' | 'share' | 'print') => {
    if (busy.current) return;
    busy.current = true; setActive(action);
    try {
      const result = await (action === 'open' ? api.protectedRegistry.openDocument(type, id)
        : action === 'share' ? api.protectedRegistry.shareDocument(type, id) : api.protectedRegistry.printDocument(type, id));
      if (result.canceled) return;
      if (!result.success) throw Error(result.error || result.message || 'Documentul nu a putut fi pregătit.');
      if (action === 'share') notify('PDF pregătit în Windows Share. Alege WhatsApp și contactul; păstrează fereastra deschisă până finalizezi trimiterea.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Documentul nu a putut fi pregătit.'); }
    finally { busy.current = false; setActive(null); }
  };
  return <div className="inline-flex items-center gap-1" role="group" aria-label="Acțiuni document">
    {([['open', 'Deschide factura', ExternalLink], ['share', 'Trimite pe WhatsApp', MessageCircle], ['print', 'Printează factura', Printer]] as const).map(([action, label, Icon]) => {
      const title = type === 'credit-note' ? label.replace('factura', 'Credit Note') : label;
      return <button key={action} type="button" title={title} aria-label={title} disabled={active !== null} onClick={() => void run(action)} className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${action === 'share' ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-600 hover:text-indigo-600 hover:bg-indigo-50'}`}>
        {active === action ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Icon size={16} aria-hidden="true" />}
      </button>;
    })}
  </div>;
}
