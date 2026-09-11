import { useEffect, useState } from 'react';
import { api } from '../shared/api';
import { format } from 'date-fns';

export function BillingPayments(){
  const [from,setFrom]=useState(format(new Date(),'yyyy-MM-dd'));
  const [to,setTo]=useState(format(new Date(),'yyyy-MM-dd'));
  const [search,setSearch]=useState('');
  const [rows,setRows]=useState<any[]>([]);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  useEffect(()=>{let active=true;setLoading(true);setError('');
    api.billing.getPaymentReport(from,to).then(data=>{if(active)setRows(data);}).catch(cause=>{if(active){setRows([]);setError(cause.message);}}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[from,to]);
  const filtered=rows.filter(row=>`${row.company_name} ${row.store_name||''} ${row.company_stores||''} ${row.invoice_number||''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const total=filtered.reduce((sum,row)=>sum+Math.round(Number(row.amount)*100),0)/100;
  return <div className="p-8 space-y-6"><h1 className="text-3xl font-bold">Plăți</h1>
    <div className="flex flex-wrap gap-4 items-end"><label>De la<input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="block border rounded-lg p-2"/></label><label>Până la<input type="date" value={to} onChange={e=>setTo(e.target.value)} className="block border rounded-lg p-2"/></label><label>Caută client, magazin sau factură<input type="search" value={search} onChange={e=>setSearch(e.target.value)} className="block border rounded-lg p-2"/></label></div>
    {error&&<p role="alert" className="text-rose-700">{error}</p>}
    {loading?<p role="status">Se încarcă...</p>:<><p className="text-xl font-bold">Încasări în perioada selectată: £{total.toFixed(2)}</p><div className="bg-white rounded-xl border overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr>{['Data','Client / Magazin','Emitent','Factură','Metodă / Bancă','Sumă'].map(label=><th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{filtered.map(row=><tr key={row.id} className="border-t"><td className="p-3">{row.payment_date}</td><td className="p-3">{row.company_name}<div className="text-slate-500">{row.store_name}</div></td><td className="p-3">{row.issuer_name}</td><td className="p-3">{row.invoice_number||'Avans / credit'}</td><td className="p-3">{row.method==='transfer'?row.bank_name||'Transfer':'Cash'}</td><td className="p-3 font-semibold">£{Number(row.amount).toFixed(2)}</td></tr>)}{!filtered.length&&<tr><td colSpan={6} className="p-8 text-center">Nu există plăți pentru filtrele selectate.</td></tr>}</tbody></table></div></>}
  </div>;
}
