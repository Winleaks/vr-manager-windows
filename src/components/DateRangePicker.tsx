import React, { useState, useEffect } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onChange: (start: string, end: string) => void;
}

export function DateRangePicker({ startDate, endDate, onChange }: DateRangePickerProps) {
  const [activePreset, setActivePreset] = useState<string>('');
  const [customMode, setCustomMode] = useState<'single' | 'range'>('single');

  const todayStr = new Date().toISOString().split('T')[0];

  useEffect(() => {
    const today = new Date();
    const tStr = today.toISOString().split('T')[0];
    
    if (startDate === tStr && endDate === tStr) {
      setActivePreset('today');
    } else if (startDate && endDate) {
      // Check if it's a 7 day period ending on sunday and starting on monday
      const startD = new Date(startDate);
      const endD = new Date(endDate);
      const msInDay = 24 * 60 * 60 * 1000;
      
      const diffDays = Math.round((endD.getTime() - startD.getTime()) / msInDay);
      
      if (startD.getDay() === 1 && diffDays === 6) { // Monday and 7 days
         setActivePreset(`week-${startDate}|${endDate}`);
      } else if (startD.getDate() === 1 && endD.getDate() === new Date(startD.getFullYear(), startD.getMonth() + 1, 0).getDate()) {
        setActivePreset(`month-${startD.getFullYear()}-${startD.getMonth()}`);
      } else {
        setActivePreset('custom');
        if (startDate !== endDate) {
          setCustomMode('range');
        }
      }
    } else {
       setActivePreset('');
    }
  }, [startDate, endDate]);

  const setToday = () => {
    onChange(todayStr, todayStr);
  };

  const handleWeekChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (!val) return;
    const [startStr, endStr] = val.split('|');
    onChange(startStr, endStr);
  };

  const generateWeekOptions = () => {
    const options = [];
    const now = new Date();
    // Go to Monday of current week
    const currentMonday = new Date(now);
    currentMonday.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
    currentMonday.setHours(0,0,0,0);

    for (let i = 0; i < 8; i++) {
      const start = new Date(currentMonday);
      start.setDate(currentMonday.getDate() - (i * 7));
      const end = new Date(start);
      end.setDate(start.getDate() + 6);

      const startStr = start.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' });
      const endStr = end.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' });
      
      const sVal = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
      const eVal = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
      const val = `${sVal}|${eVal}`;
      
      const label = i === 0 ? `Curentă (${startStr} - ${endStr})` : `${startStr} - ${endStr}`;
      
      options.push(<option key={val} value={val}>{label}</option>);
    }
    return options;
  };

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (!val) return;
    const [year, month] = val.split('-').map(Number);
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0); // last day of month
    
    // To avoid timezone issues when converting to ISO string
    const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    
    onChange(startStr, endStr);
  };

  const generateMonthOptions = () => {
    const options = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth();
      const label = d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
      const val = `${year}-${month}`;
      options.push(<option key={val} value={val}>{label.charAt(0).toUpperCase() + label.slice(1)}</option>);
    }
    return options;
  };

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
      <div className="flex items-center gap-2 bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm text-sm">
        <Calendar size={16} className="text-slate-400 ml-2" />
        
        <div className="flex items-center gap-1 border-r border-slate-200 pr-2 mr-1">
          <button 
            onClick={setToday}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${activePreset === 'today' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            Azi
          </button>
          
          <div className={`relative flex items-center rounded-lg transition-colors ${activePreset.startsWith('week-') ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
            <select 
              className={`appearance-none bg-transparent pl-3 pr-8 py-1.5 font-medium outline-none cursor-pointer ${activePreset.startsWith('week-') ? 'text-white' : 'text-slate-600'}`}
              value={activePreset.startsWith('week-') ? activePreset.replace('week-', '') : ''}
              onChange={handleWeekChange}
            >
              <option value="" disabled className="text-slate-800">Alege Săptămâna...</option>
              {generateWeekOptions().map(opt => React.cloneElement(opt as React.ReactElement, { className: "text-slate-800" }))}
            </select>
            <ChevronDown size={14} className="absolute right-2 pointer-events-none opacity-70" />
          </div>
          
          <div className={`relative flex items-center rounded-lg transition-colors ${activePreset.startsWith('month-') ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
            <select 
              className={`appearance-none bg-transparent pl-3 pr-8 py-1.5 font-medium outline-none cursor-pointer ${activePreset.startsWith('month-') ? 'text-white' : 'text-slate-600'}`}
              value={activePreset.startsWith('month-') ? activePreset.replace('month-', '') : ''}
              onChange={handleMonthChange}
            >
              <option value="" disabled className="text-slate-800">Alege Luna...</option>
              {generateMonthOptions().map(opt => React.cloneElement(opt as React.ReactElement, { className: "text-slate-800" }))}
            </select>
            <ChevronDown size={14} className="absolute right-2 pointer-events-none opacity-70" />
          </div>
        </div>

        <div className="flex items-center px-2">
          {activePreset === 'custom' ? (
            <div className="flex items-center gap-2">
              <input 
                type="date"
                value={startDate}
                onChange={(e) => onChange(e.target.value, customMode === 'single' ? e.target.value : endDate)}
                className="bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-slate-700 outline-none focus:border-blue-500 font-medium"
              />
              {customMode === 'range' && (
                <>
                  <span className="text-slate-400 font-medium">-</span>
                  <input 
                    type="date"
                    value={endDate}
                    onChange={(e) => onChange(startDate, e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-slate-700 outline-none focus:border-blue-500 font-medium"
                  />
                </>
              )}
              <button 
                onClick={() => {
                  const newMode = customMode === 'single' ? 'range' : 'single';
                  setCustomMode(newMode);
                  if (newMode === 'single') {
                    onChange(startDate, startDate);
                  }
                }}
                className="ml-2 text-xs font-bold text-slate-400 hover:text-slate-600 bg-slate-100 px-2 py-1 rounded"
              >
                {customMode === 'single' ? 'RANGE' : 'ZI'}
              </button>
            </div>
          ) : (
            <button 
              onClick={() => {
                setActivePreset('custom');
                onChange(startDate, endDate); // Keep current but switch UI
              }}
              className="px-3 py-1.5 rounded-lg font-medium text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Custom
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
