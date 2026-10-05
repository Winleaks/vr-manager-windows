import { useEffect,useState } from 'react';
import { api } from '../shared/api';
export function FinancialSyncBanner() {
  const [pending,setPending]=useState<number|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false),[writer,setWriter]=useState(false);
  useEffect(()=>{let stopped=false;let timer:ReturnType<typeof setTimeout>;async function refresh(){try{const status=await api.billing.getPublicationStatus();if(!stopped){setWriter(status.writer);setPending(status.pending.length+(status.protectedPending?1:0));setError(false);}}catch{if(!stopped)setError(true);}finally{if(!stopped)timer=setTimeout(refresh,5000);}}void refresh();return()=>{stopped=true;clearTimeout(timer);};},[]);
  return <aside role="status" className={`px-4 py-2 text-sm ${error||pending?'bg-amber-50 text-amber-900':'bg-emerald-50 text-emerald-900'}`}>
    {error?'Financial synchronization status unavailable':pending===null?'Checking financial synchronization…':!writer?'Financial publication is managed by the Writer PC.':pending?'Financial changes pending publication — the client platform still uses the last confirmed balance.':'Financial changes synchronized with the client platform.'}
    {writer&&(error||!!pending)&&<button className="ml-3 underline disabled:opacity-50" disabled={busy} onClick={async()=>{setBusy(true);try{await api.billing.publishNow();}catch{setError(true);}finally{setBusy(false);}}}>{busy?'Retrying…':'Retry publication'}</button>}
  </aside>;
}
