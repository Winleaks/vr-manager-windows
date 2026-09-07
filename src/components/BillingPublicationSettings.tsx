import {useEffect,useState} from 'react';
import {api} from '../shared/api';
export function BillingPublicationSettings({isWriter}:{isWriter:boolean}) {
 const [state,setState]=useState<any>(null),[folder,setFolder]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const refresh=async()=>{const next=await api.billing.getPublicationStatus();setState(next);return next;};
 useEffect(()=>{void refresh().then(next=>setFolder(next.folderId)).catch(()=>setNotice('Starea publicării nu este disponibilă.'));},[]);
 const run=async(action:()=>Promise<unknown>)=>{setBusy(true);setNotice('');try{await action();await refresh();}catch(e){setNotice(e instanceof Error?e.message:'Operația a eșuat.');}finally{setBusy(false);}};
 return <section className="rounded-2xl border bg-white p-6 space-y-3">
  <h2 className="text-lg font-bold">Facturi și solduri în platforma clienților</h2>
  <p className="text-sm text-slate-600">Importul inițial include toate facturile existente, indiferent de data emiterii. Numai Writer publică.</p>
  <p className="text-sm">Facturi în registru: {state?.invoiceCount??'—'} · Companii în așteptare: {state?.pending?.length??'—'}</p>
  <p className="text-xs break-all">Identitate Writer: {state?.identity?.source_id||'—'}</p>
  <fieldset disabled={!isWriter||busy} className="space-y-3">
   <label className="block text-sm">ID-ul folderului existent Facturi<input value={folder} onChange={e=>setFolder(e.target.value)} className="block w-full mt-1 border rounded-lg px-3 py-2"/></label>
   <div className="flex flex-wrap gap-3">
    <button className="rounded-lg border px-3 py-2" onClick={()=>void run(async()=>{await api.billing.saveSettings({invoiceDriveFolderId:folder});setNotice('Folderul a fost salvat.');})}>Salvează folderul</button>
    <button className="rounded-lg border px-3 py-2" onClick={()=>void run(async()=>{const r=await api.system.reconcilePdfs();setNotice(`PDF-uri asociate: ${r.linked}. Neasociate: ${r.unresolved.join(', ')||'niciuna'}.`);})}>Asociază PDF-urile existente</button>
    <button className="rounded-lg bg-indigo-600 text-white px-3 py-2" onClick={()=>void run(()=>api.billing.publishNow())}>Reîncearcă sincronizarea</button>
   </div>
  </fieldset>
  {notice&&<p className="text-sm" role="status">{notice}</p>}
  {state?.pending?.filter((row:any)=>row.last_error).map((row:any)=><p key={row.company_id} className="text-sm text-amber-800">{row.name}: {row.last_error}</p>)}
 </section>;
}
