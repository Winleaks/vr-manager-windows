import {useEffect,useRef,useState} from 'react';
import {api} from '../shared/api';
export function BillingPublicationSettings({isWriter}:{isWriter:boolean}) {
 const [state,setState]=useState<any>(null),[folder,setFolder]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const folderEdited=useRef(false);
 const refresh=async()=>{const next=await api.billing.getPublicationStatus();setState(next);return next;};
 useEffect(()=>{
  let active=true,inFlight=false;
  const poll=async()=>{
   if(inFlight) return;
   inFlight=true;
   try{const next=await api.billing.getPublicationStatus();if(active){setState(next);if(!folderEdited.current)setFolder(next.folderId);}}
   catch{if(active)setNotice('Starea publicării nu este disponibilă.');}
   finally{inFlight=false;}
  };
  void poll();const timer=setInterval(()=>void poll(),5000);
  return()=>{active=false;clearInterval(timer);};
 },[]);
 const run=async(action:()=>Promise<unknown>)=>{setBusy(true);setNotice('');try{await action();await refresh();}catch(e){setNotice(e instanceof Error?e.message:'Operația a eșuat.');}finally{setBusy(false);}};
 return <section className="rounded-2xl border bg-white p-6 space-y-3">
  <h2 className="text-lg font-bold">Facturi și solduri în platforma clienților</h2>
  <p className="text-sm text-slate-600">Importul inițial include toate facturile existente, indiferent de data emiterii. Numai Writer publică.</p>
  <p className="text-sm">Facturi în registru: {state?.invoiceCount??'—'} · Companii în așteptare: {state?.pending?.length??'—'}</p>
  {state?.publishing&&<p role="status" className="text-sm text-indigo-700">Sincronizare în curs. Starea se actualizează automat.</p>}
  {state?.excluded?.length>0&&<p className="text-sm text-slate-600">{state.excluded.length} companii nu mai apar în VR Baker. Publicarea lor este oprită; istoricul local este păstrat: {state.excluded.map((row:any)=>row.name).join(', ')}.</p>}
  <p className="text-xs break-all">Identitate Writer: {state?.identity?.source_id||'—'}</p>
  <fieldset disabled={!isWriter||busy} className="space-y-3">
   <label className="block text-sm">ID-ul folderului existent Facturi<input value={folder} onChange={e=>{folderEdited.current=true;setFolder(e.target.value);}} className="block w-full mt-1 border rounded-lg px-3 py-2"/></label>
   <div className="flex flex-wrap gap-3">
    <button className="rounded-lg border px-3 py-2" onClick={()=>void run(async()=>{await api.billing.saveSettings({invoiceDriveFolderId:folder});folderEdited.current=false;setNotice('Folderul a fost salvat.');})}>Salvează folderul</button>
    <button className="rounded-lg border px-3 py-2" onClick={()=>void run(async()=>{const r=await api.system.reconcilePdfs();setNotice(`PDF-uri asociate: ${r.linked}. Neasociate: ${r.unresolved.join(', ')||'niciuna'}.`);})}>Asociază PDF-urile existente</button>
    <button disabled={Boolean(state?.publishing)} className="rounded-lg bg-indigo-600 text-white px-3 py-2 disabled:opacity-50" onClick={()=>void run(async()=>{await api.billing.publishNow();setNotice('Încercarea a fost procesată. Verifică mai jos eventualele companii rămase în așteptare.');})}>Reîncearcă sincronizarea</button>
   </div>
  </fieldset>
  {notice&&<p className="text-sm" role="status">{notice}</p>}
  {state?.pending?.filter((row:any)=>row.last_error).map((row:any)=><p key={row.company_id} className="text-sm text-amber-800">{row.name}: {row.last_error}</p>)}
 </section>;
}
