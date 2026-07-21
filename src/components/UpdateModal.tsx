import React, { useEffect, useState } from 'react';
import { api } from '../shared/api';
import { DownloadCloud, CheckCircle, AlertCircle, X, ChevronRight, Package } from 'lucide-react';

type UpdateState = 'idle' | 'available' | 'downloading' | 'downloaded' | 'error';

export function UpdateModal() {
  const [status, setStatus] = useState<UpdateState>('idle');
  const [versionInfo, setVersionInfo] = useState<any>(null);
  const [progress, setProgress] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(
      api.system.onUpdateAvailable((e: any, info: any) => {
        const payload = info || e;
        setVersionInfo(payload);
        setStatus('available');
      })
    );

    unsubs.push(
      api.system.onUpdateProgress((e: any, progressObj: any) => {
        const payload = progressObj || e;
        if (payload && payload.percent !== undefined) {
          setProgress(Math.round(payload.percent));
        }
        setStatus('downloading');
      })
    );

    unsubs.push(
      api.system.onUpdateDownloaded(() => {
        setStatus('downloaded');
      })
    );

    unsubs.push(
      api.system.onUpdateError((e: any, err: any) => {
        const payload = err || e;
        setErrorMsg(typeof payload === 'string' ? payload : 'Eroare la descărcarea update-ului.');
        setStatus('error');
      })
    );

    return () => {
      unsubs.forEach(unsub => unsub());
    };
  }, []);

  const handleDownload = async () => {
    setStatus('downloading');
    setProgress(0);
    await api.system.startUpdateDownload();
  };

  const handleInstall = async () => {
    await api.system.installUpdate();
  };

  const handleLater = () => {
    setStatus('idle');
  };

  if (status === 'idle') return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white relative">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-xl">
              <Package size={28} />
            </div>
            <div>
              <h2 className="text-xl font-bold">Actualizare Disponibilă</h2>
              <p className="text-blue-100 text-sm">Versiunea {versionInfo?.version || 'nouă'}</p>
            </div>
          </div>
          {status === 'available' && (
            <button 
              onClick={handleLater}
              className="absolute top-4 right-4 p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6">
          {status === 'available' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Noutăți / Corecții (Changelog)</h3>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 max-h-48 overflow-y-auto custom-scrollbar">
                  {versionInfo?.releaseNotes ? (
                    <div 
                      className="prose prose-sm prose-slate"
                      dangerouslySetInnerHTML={{ __html: typeof versionInfo.releaseNotes === 'string' ? versionInfo.releaseNotes : (versionInfo.releaseNotes[0]?.note || 'Actualizări de performanță și securitate.') }}
                    />
                  ) : (
                    <p className="text-slate-600 text-sm italic">Nu există detalii suplimentare pentru această versiune.</p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button 
                  onClick={handleLater}
                  className="px-5 py-2.5 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Mai târziu
                </button>
                <button 
                  onClick={handleDownload}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm flex items-center gap-2 transition-colors"
                >
                  <DownloadCloud size={20} />
                  Descarcă și Instalează
                </button>
              </div>
            </div>
          )}

          {status === 'downloading' && (
            <div className="py-8 flex flex-col items-center text-center space-y-6">
              <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
              <div className="space-y-2 w-full max-w-xs mx-auto">
                <h3 className="text-lg font-bold text-slate-800">Se descarcă...</h3>
                <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                  <div 
                    className="bg-blue-600 h-full rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-sm text-slate-500 font-medium">{progress}% finalizat</p>
              </div>
              <p className="text-xs text-slate-400">Te rugăm să aștepți. Nu închide aplicația.</p>
            </div>
          )}

          {status === 'downloaded' && (
            <div className="py-6 flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-2">
                <CheckCircle size={32} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-800">Actualizare finalizată!</h3>
                <p className="text-slate-500 mt-2 max-w-sm">Aplicația se va restarta acum pentru a aplica modificările și a trece la noua versiune.</p>
              </div>
              <div className="pt-4">
                <button 
                  onClick={handleInstall}
                  className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-sm flex items-center gap-2 transition-colors"
                >
                  OK (Restartare)
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="py-6 flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-2">
                <AlertCircle size={32} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-800">Eroare la descărcare</h3>
                <p className="text-red-500 mt-2 text-sm">{errorMsg}</p>
              </div>
              <div className="pt-4">
                <button 
                  onClick={handleLater}
                  className="px-6 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-medium rounded-lg shadow-sm transition-colors"
                >
                  Închide
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
