import { useState } from 'react';
import { FileText, Printer, Send, Loader2 } from 'lucide-react';
import { api } from '../shared/api';

export function StatementActions({ companyId, issuers }: {companyId:number; issuers:Array<{id:number;legal_name:string}>}) {
  const [issuer, setIssuer] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function run(action:'open'|'print'|'share') {
    if(busy || !issuer || !from || !to) return;
    setBusy(true);setError('');
    try {
      const result = await api.billing.statementDocument(companyId,Number(issuer),from,to,action);
      if(!result.success && !result.cancelled) setError(result.error || 'Documentul nu a putut fi deschis.');
    } catch(cause) { setError(cause instanceof Error ? cause.message : 'Generarea a eșuat.'); }
    finally { setBusy(false); }
  }
  return <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" aria-label="Statement">
    <h2 className="font-semibold">Statement de cont</h2>
    <div className="flex flex-wrap gap-3 items-end">
      <label className="text-sm">Emitent<select value={issuer} onChange={e=>setIssuer(e.target.value)} className="block border rounded-lg p-2"><option value="">Selectează emitentul</option>{issuers.map(row=><option key={row.id} value={row.id}>{row.legal_name}</option>)}</select></label>
      <label className="text-sm">De la<input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="block border rounded-lg p-2" /></label>
      <label className="text-sm">Până la<input type="date" min={from} value={to} onChange={e=>setTo(e.target.value)} className="block border rounded-lg p-2" /></label>
      {([['open','Deschide Statement',FileText],['print','Printează Statement',Printer],['share','Trimite Statement pe WhatsApp',Send]] as const).map(([action,label,Icon])=><button key={action} type="button" title={label} aria-label={label} disabled={busy||!issuer||!from||!to||from>to} onClick={()=>void run(action)} className="p-3 rounded-lg text-indigo-700 hover:bg-indigo-50 disabled:opacity-40">{busy?<Loader2 size={19} className="animate-spin"/>:<Icon size={19}/>}</button>)}
    </div>
    <p className="text-xs text-slate-500">Sold inițial, facturi, credit notes și plăți. Disponibil doar din Hub.</p>
    {error&&<p role="alert" className="text-rose-700">{error}</p>}
  </section>;
}
