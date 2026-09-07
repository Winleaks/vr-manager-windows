import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, MessageCircle, Printer } from 'lucide-react';
import { api } from '../shared/api';

type DocumentAction = 'open' | 'share' | 'print';

export function InvoiceDocumentActions({
  invoiceId,
  preparePdf,
  status,
  disabled = false,
  size = 'regular',
}: {
  invoiceId: number;
  preparePdf: () => Promise<unknown>;
  status?: string;
  disabled?: boolean;
  size?: 'compact' | 'regular';
}) {
  const [activeAction, setActiveAction] = useState<DocumentAction | null>(null);
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; message: string } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  if (status === 'cancelled') return null;

  const showNotice = (kind: 'info' | 'error', message: string) => {
    setNotice({ kind, message });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), kind === 'error' ? 7000 : 4500);
  };

  const runAction = async (action: DocumentAction) => {
    if (activeAction || disabled) return;
    setActiveAction(action);
    setNotice(null);
    try {
      await preparePdf();
      const result = action === 'open'
        ? await api.system.openPdfFile(invoiceId)
        : action === 'share'
          ? await api.system.shareInvoicePdf(invoiceId)
          : await api.system.printInvoicePdf(invoiceId);
      if (result.canceled) return;
      if (!result.success) throw new Error(result.error || 'Acțiunea nu a putut fi pornită.');
      if (action === 'share') showNotice('info', 'PDF-ul este atașat. Alege WhatsApp, apoi contactul și trimite factura.');
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : 'Acțiunea nu a putut fi finalizată.');
    } finally {
      setActiveAction(null);
    }
  };

  const spacing = size === 'compact' ? 'p-1.5 rounded' : 'p-2 rounded-lg';
  return <>
    <div className="inline-flex items-center gap-2" role="group" aria-label="Acțiuni factură">
      <button type="button" onClick={() => void runAction('open')} disabled={disabled || activeAction !== null} className={`${spacing} text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`} title="Deschide factura" aria-label="Deschide factura">
        {activeAction === 'open' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ExternalLink size={16} aria-hidden="true" />}
      </button>
      <button type="button" onClick={() => void runAction('share')} disabled={disabled || activeAction !== null} className={`${spacing} text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`} title="Trimite pe WhatsApp" aria-label="Trimite pe WhatsApp">
        {activeAction === 'share' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <MessageCircle size={16} aria-hidden="true" />}
      </button>
      <button type="button" onClick={() => void runAction('print')} disabled={disabled || activeAction !== null} className={`${spacing} text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`} title="Printează factura" aria-label="Printează factura">
        {activeAction === 'print' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Printer size={16} aria-hidden="true" />}
      </button>
    </div>
    {notice && <div className={`fixed bottom-5 right-5 z-[100] max-w-sm rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${notice.kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-indigo-200 bg-white text-slate-700'}`} role={notice.kind === 'error' ? 'alert' : 'status'} aria-live={notice.kind === 'error' ? 'assertive' : 'polite'}>{notice.message}</div>}
  </>;
}
