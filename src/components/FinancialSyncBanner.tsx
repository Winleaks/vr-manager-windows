import { useEffect,useState } from 'react';
import { api } from '../shared/api';
type Status=Awaited<ReturnType<typeof api.billing.getPublicationStatus>>;
export function FinancialSyncBanner() {
  const [state,setState]=useState<Status|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false);
  const refresh=async()=>{const status=await api.billing.getPublicationStatus();setState(status);setError(false);};
  useEffect(()=>{let stopped=false;let timer:ReturnType<typeof setTimeout>;async function poll(){try{const status=await api.billing.getPublicationStatus();if(!stopped){setState(status);setError(false);}}catch{if(!stopped)setError(true);}finally{if(!stopped)timer=setTimeout(poll,5000);}}void poll();return()=>{stopped=true;clearTimeout(timer);};},[]);
  const pending=state?state.pending.length+(state.protectedPending?1:0):null;
  const blocked=state?.pending.filter((row:any)=>row.state==='association_required')||[];
  const temporary=state?.pending.some((row:any)=>row.state==='temporary_error');
  const message=error?'Starea sincronizării financiare nu este disponibilă':!state?'Se verifică sincronizarea financiară…':!state.writer?'Sincronizarea financiară este gestionată de calculatorul principal (Writer).':blocked.length?`Sincronizarea necesită corectarea asocierii sau configurației: ${blocked.map((row:any)=>row.name).join(', ')}. Deschide Setări Facturare.`:state.publishing||state.protectedStatus?.publishing?'Sincronizarea financiară este în curs…':temporary?'Conexiunea nu a confirmat modificările financiare. Reîncercare automată.':pending?'Modificările financiare așteaptă sincronizarea — platforma clienților folosește încă ultimul sold confirmat.':'Modificările financiare sunt sincronizate cu platforma clienților.';
  return <aside role="status" className={`px-4 py-2 text-sm ${error||pending?'bg-amber-50 text-amber-900':'bg-emerald-50 text-emerald-900'}`}>
    {message}
    {state?.writer&&(error||!!pending)&&<button className="ml-3 underline disabled:opacity-50" disabled={busy} onClick={async()=>{setBusy(true);try{await api.billing.publishNow();await refresh();}catch{setError(true);}finally{setBusy(false);}}}>{busy?'Se reîncearcă…':'Reîncearcă sincronizarea'}</button>}
  </aside>;
}
