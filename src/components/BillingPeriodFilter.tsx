import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { addWeeks, format, startOfWeek, endOfWeek } from 'date-fns';
import { ro } from 'date-fns/locale';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { billingDashboardRange, type BillingDashboardPeriod } from '../utils/billingDashboardPeriod';

export function BillingPeriodFilter({ period, week, setPeriod, setWeek }: {
  period: BillingDashboardPeriod; week: Date;
  setPeriod: (period: BillingDashboardPeriod) => void;
  setWeek: (week: Date) => void;
}) {
  const { from, to } = billingDashboardRange(period, week);
  return (<section aria-label="Perioada statisticilor" className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm mb-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Calendar size={18} className="text-slate-400" />Perioada statisticilor</div>
          <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-xl">
            {([['month', 'Luna curentă'], ['week', 'Săptămână'], ['all', 'Tot istoricul']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)} className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${period === value ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'}`}>{label}</button>)}
          </div>
        </div>
        {period === 'week' ? <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="px-4 py-2 text-sm font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl">Săptămâna curentă</button>
          <div className="flex items-center min-w-0 bg-slate-50 border border-slate-200 rounded-xl p-1">
            <button type="button" onClick={() => setWeek(addWeeks(week, -1))} title="Săptămâna anterioară" aria-label="Săptămâna anterioară" className="shrink-0 p-2 text-slate-600 hover:bg-slate-200 rounded-lg"><ChevronLeft size={18} /></button>
            <DatePicker selected={week} onChange={(date: Date | null) => { if (date) setWeek(startOfWeek(date, { weekStartsOn: 1 })); }} showWeekPicker showWeekNumbers locale={ro} calendarStartDay={1}
              customInput={<button type="button" aria-label="Alege săptămâna" className="px-3 py-2 font-semibold text-slate-800 text-sm hover:text-indigo-600">Luni, {format(week, 'dd MMM yyyy', { locale: ro })} – Duminică, {format(endOfWeek(week, { weekStartsOn: 1 }), 'dd MMM yyyy', { locale: ro })}</button>} />
            <button type="button" onClick={() => setWeek(addWeeks(week, 1))} title="Săptămâna următoare" aria-label="Săptămâna următoare" className="shrink-0 p-2 text-slate-600 hover:bg-slate-200 rounded-lg"><ChevronRight size={18} /></button>
          </div>
        </div> : <p className="text-sm text-slate-600">{period === 'month' ? `Luna curentă: ${format(new Date(), 'MMMM yyyy', { locale: ro })} · ${from?.split('-').reverse().join('/')} – ${to?.split('-').reverse().join('/')}` : 'Statistici pentru tot istoricul.'}</p>}
      </section>);
}
