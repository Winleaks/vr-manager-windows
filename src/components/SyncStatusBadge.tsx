import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { api } from '../shared/api';

export function SyncStatusBadge() {
  const [status, setStatus] = useState<{
    active: boolean;
    lastSync: string | null;
    mode: string;
    message: string;
  }>({
    active: false,
    lastSync: null,
    mode: 'offline',
    message: 'Se conectează...'
  });

  useEffect(() => {
    // Pornește engine-ul de sincronizare
    api.system.initRealtimeSync().catch(() => {});

    // Preluare stare inițială
    api.system.getSyncStatus().then((s: any) => {
      if (s) setStatus(s);
    }).catch(() => {});

    // Ascultă modificările de stare
    const unsubscribeStatus = api.system.onSyncStatusChanged((s: any) => {
      if (s) setStatus(s);
    });

    return () => {
      if (typeof unsubscribeStatus === 'function') unsubscribeStatus();
    };
  }, []);

  return (
    <div className="flex items-center gap-2 bg-slate-800/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-700/60 shadow-sm text-xs font-medium text-slate-300">
      {status.active ? (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
      ) : (
        <span className="inline-flex rounded-full h-2 w-2 bg-slate-500"></span>
      )}

      <span className="text-slate-200 font-semibold">
        {status.active ? 'Sincronizat Live' : 'Mod Local'}
      </span>

      {status.lastSync && (
        <span className="text-slate-400 border-l border-slate-700 pl-2 text-[11px]">
          {status.lastSync}
        </span>
      )}
    </div>
  );
}
