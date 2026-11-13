import { useEffect, useState } from 'react';
import { api } from '../shared/api';
import type { DriverCollectionsReport as Report } from '../shared/driverCollections';
const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;
export function DriverCollectionsReport({ startDate, endDate, refreshKey }: { startDate: string; endDate: string; refreshKey: unknown }) {
  const [drivers, setDrivers] = useState<Array<{ id: number; name: string }>>([]);
  const [driverId, setDriverId] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    api.drivers.getAll().then(rows => { if (active) setDrivers(rows); }).catch(() => { if (active) setError('Lista șoferilor nu a putut fi încărcată.'); });
    return () => { active = false; };
  }, [retry, refreshKey]);
  useEffect(() => {
    let active = true;
    setReport(null); setError('');
    if (!driverId) { setLoading(false); return; }
    setLoading(true);
    api.dailyCash.getDriverCollectionsReport(startDate, endDate, Number(driverId)).then(value => {
      if (active) setReport(value);
    }).catch(() => { if (active) setError('Încasările nu au putut fi încărcate. Reîncearcă.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [driverId, startDate, endDate, refreshKey, retry]);
  return <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4" aria-labelledby="driver-collections-title">
    <h2 id="driver-collections-title" className="text-lg font-bold text-slate-800">Încasări pe șofer</h2>
    <p className="text-sm text-slate-500">Încasările din aplicație folosesc data efectivă, ora Londrei. Încasările manuale folosesc ziua din Daily Cash; sunt incluse o singură dată.</p>
    <label className="block text-sm font-semibold">Șofer<select aria-label="Șofer" className="block mt-2 w-full sm:max-w-sm border rounded-lg p-2" value={driverId} onChange={event => setDriverId(event.target.value)}>
      <option value="">Selectează șoferul</option>{drivers.map(driver => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
    </select></label>
    {error && <p role="alert" className="text-rose-700">{error} <button onClick={() => setRetry(value => value + 1)} className="underline">Reîncearcă</button></p>}
    {loading && <p role="status">Se încarcă încasările…</p>}
    {report && report.driverId === Number(driverId) && report.startDate === startDate && report.endDate === endDate && <><p className="text-sm text-slate-600">{startDate === endDate ? startDate : `${startDate} – ${endDate}`}</p>
      <table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-3">Magazin</th><th className="py-3 text-right">Încasat</th></tr></thead>
        <tbody>{report.stores.map((store, index) => <tr key={store.storeId ?? `unknown-${index}`} className="border-b"><td className="py-3">{store.storeName}</td><td className="py-3 text-right">{money(store.amountPence)}</td></tr>)}</tbody>
        <tfoot><tr className="font-bold"><td className="pt-4">{startDate === endDate ? 'Total pe zi' : 'Total în interval'}</td><td className="pt-4 text-right">{money(report.totalPence)}</td></tr></tfoot>
      </table>{!report.stores.length && <p role="status" className="text-slate-500">Nu există încasări confirmate pentru șoferul și perioada selectate.</p>}</>}
  </section>;
}
