import {useEffect,useState} from 'react';
import {api} from '../shared/api';
export function DriverCashStatus({writer,onChanged}:{writer:boolean;onChanged:()=>Promise<void>}) {
  const [status,setStatus]=useState<any>(null);
  const [editing,setEditing]=useState<any>(null);
  const [amount,setAmount]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [references,setReferences]=useState<Record<string,string>>({});
  useEffect(()=>{
    let active=true;
    const refresh=()=>api.dailyCash.getDriverCashStatus().then(value=>{if(active) setStatus(value);}).catch(()=>{if(active)setError('Declarațiile șoferilor nu au putut fi încărcate.');});
    refresh();const timer=setInterval(()=>{refresh();void onChanged();},15000);
    return()=>{active=false;clearInterval(timer);};
  },[onChanged]);
  async function action(work:()=>Promise<unknown>) {
    if(busy)return;setBusy(true);setError('');
    try {await work();setEditing(null);await onChanged();setStatus(await api.dailyCash.getDriverCashStatus());}
    catch(e:any){setError(e?.message||'Operația necesită verificare.');}
    finally{setBusy(false);}
  }
  if(!status)return error?<p role="alert" className="text-red-700">{error}</p>:null;
  return <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Declarații din aplicația șoferilor</h2>
      {writer&&<button disabled={busy} aria-busy={busy} onClick={()=>void action(api.dailyCash.syncDriverCash)} className="text-sm text-blue-700 disabled:opacity-60">{busy?'Se sincronizează…':'Sincronizează acum'}</button>}
    </div>
    {busy&&<p role="status" className="mt-2 text-sm text-blue-700">Sincronizarea este în curs. Încasările salvate se păstrează; rezultatul se actualizează automat.</p>}
    {(error||status.error)&&<p role="alert" className="mt-2 text-sm text-red-700">{error||status.error}</p>}
    {status.reviews?.map((r:any)=><div key={r.operation_id} className="mt-2 rounded bg-amber-50 p-3 text-sm">
      <p>{JSON.parse(r.result).driver_name} · {JSON.parse(r.result).store_name} · £{(JSON.parse(r.request).amount_pence/100).toFixed(2)} · {r.manualRoot?'Corectare a unei încasări înregistrate manual. Verifică înregistrarea manuală.':'Posibilă încasare introdusă manual. Importul este oprit pentru verificare.'}</p>
      {writer&&r.decision==='pending'&&<div className="mt-2 flex flex-wrap gap-3">
        {!r.manualRoot&&<button disabled={busy} className="underline" onClick={()=>void action(()=>api.dailyCash.resolveDriverCashReview(r.operation_id,'distinct'))}>Plată distinctă — importă</button>}
        <select aria-label="Încasarea manuală existentă" value={references[r.operation_id]||''} onChange={e=>setReferences({...references,[r.operation_id]:e.target.value})} className="rounded border p-1">
          <option value="">Selectează încasarea din Daily Cash</option>{r.candidates.map((c:any)=><option key={c.id} value={c.id}>#{c.id} · {c.date} · £{c.amount.toFixed(2)}</option>)}
        </select>
        <button disabled={busy||!references[r.operation_id]} className="underline disabled:opacity-50" onClick={()=>void action(()=>api.dailyCash.resolveDriverCashReview(r.operation_id,'manual',Number(references[r.operation_id])))}>Deja înregistrată manual</button>
      </div>}
      {writer&&r.decision!=='pending'&&<button disabled={busy} className="underline" onClick={()=>void action(()=>api.dailyCash.retryDriverCashConflict(r.operation_id))}>Reia transmiterea deciziei</button>}
    </div>)}
    {status.retrying?.map((r:any)=><p key={r.operation_id} className="mt-2 text-sm text-amber-800">{JSON.parse(r.result).driver_name} · {JSON.parse(r.result).store_name} · Încasare păstrată; reîncercare automată.</p>)}
    {status.conflicts.map((c:any)=><div key={c.operation_id} className="mt-2 rounded bg-red-50 p-3 text-sm">
      <span>{JSON.parse(c.result).driver_name} · {JSON.parse(c.result).store_name} · {JSON.parse(c.result).error||'Încasarea necesită verificare.'}</span>
      {writer&&<button disabled={busy} onClick={()=>void action(()=>api.dailyCash.retryDriverCashConflict(c.operation_id))} className="ml-3 underline">Reîncearcă după rezolvare</button>}
    </div>)}
    {status.pending?.map((c:any)=><p key={c.operation_id} className="mt-2 text-sm text-amber-800">{JSON.parse(c.result).driver_name} · {JSON.parse(c.result).store_name} · Încasare păstrată, în așteptarea sincronizării.</p>)}
    {status.officeRequests.map((r:any)=><p key={r.root_id} className="mt-2 text-sm text-amber-800">{r.last_error||'Corectare de la birou în așteptarea sincronizării.'}{writer&&r.state==='CONFLICT'&&<button disabled={busy} onClick={()=>void action(()=>api.dailyCash.discardRejectedDriverCashOffice(r.root_id))} className="ml-2 underline">Renunță la corectarea respinsă</button>}</p>)}
    {status.invalidReports?.map((r:any)=><p key={r.date} className="mt-2 text-sm text-amber-800">Raportul Daily Cash pentru {r.date} trebuie regenerat după încasările din aplicație.</p>)}
    <details className="mt-3"><summary className="cursor-pointer text-sm">Ultimele încasări și anulări</summary>
      <div className="mt-2 space-y-2">{status.receipts.map((r:any)=><div key={r.root_id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm">
        <span>{r.driver_name} · {r.store_name} · {r.company_name} · {new Date(r.recorded_at_ms).toLocaleString()} · {r.amount_pence?`£${(r.amount_pence/100).toFixed(2)}`:'Fără încasare'}</span>
        {writer&&<button disabled={busy} onClick={()=>{setEditing(r);setAmount((r.amount_pence/100).toFixed(2));}} className="text-blue-700">Corectează încasarea</button>}
      </div>)}</div>
    </details>
    {editing&&<div role="dialog" aria-label="Corectează încasarea șoferului" className="mt-4 rounded-lg bg-slate-50 p-3">
      <form onSubmit={e=>{e.preventDefault();if(!/^\d+(\.\d{1,2})?$/.test(amount)||!Number.isFinite(Number(amount))){setError('Introdu o sumă cu maximum două zecimale.');return;}
        void action(()=>api.dailyCash.correctDriverReceipt({rootId:editing.root_id,amount:Number(amount),expectedRevision:editing.revision}));}}>
        <label className="block">Suma totală corectă (£)<input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal" required disabled={busy} className="ml-2 rounded border p-2" /></label>
        <p className="mt-2 text-sm">0 anulează încasarea. Casa, facturile și creditul se corectează împreună.</p>
        <div className="mt-2 flex gap-3"><button type="submit" disabled={busy} className="rounded bg-blue-700 px-3 py-2 text-white">Salvează modificările</button><button type="button" disabled={busy} onClick={()=>setEditing(null)}>Renunță</button></div>
      </form>
    </div>}
  </section>;
}
