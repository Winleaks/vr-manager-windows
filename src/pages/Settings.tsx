import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../shared/api';
import { 
  ArrowLeft, 
  Database, 
  Download, 
  Upload, 
  Clock, 
  RefreshCw, 
  Settings as SettingsIcon, 
  ShieldAlert, 
  Sliders,
  Info
} from 'lucide-react';

export function Settings() {
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  useEffect(() => {
    fetchLastBackup();

    const unsubscribe = api.system.onBackupCompleted(() => {
      fetchLastBackup();
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  const fetchLastBackup = async () => {
    const time = await api.system.getLastBackupTime();
    if (time) setLastBackup(time);
  };

  const handleManualBackup = async () => {
    const res = await api.system.manualBackup();
    if (res.success) {
      alert(`Backup creat cu succes la:\n${res.path}`);
      fetchLastBackup();
    } else if (!res.canceled) {
      alert(`Eroare la creare backup: ${res.error}`);
    }
  };

  const handleRestoreBackup = async () => {
    if (window.confirm('Ești sigur că vrei să încarci un backup? Această acțiune va suprascrie baza de date curentă pentru TOATE modulele din Hub și programul se va restarta automat.')) {
      const res = await api.system.restoreBackup();
      if (res.success) {
        window.location.reload();
      } else if (!res.canceled) {
        alert('A apărut o eroare la restaurarea bazei de date.');
      }
    }
  };

  const handleCheckUpdates = async () => {
    setIsCheckingUpdate(true);
    try {
      const res = await api.system.checkForUpdates();
      if (!res.success) {
        alert('Eroare la căutarea update-ului:\n' + res.error);
      } else {
        if (res.result === null) {
          alert('Căutarea a fost finalizată. Nu s-a găsit nicio versiune nouă disponibilă.');
        }
      }
    } catch (e: any) {
      alert('Eroare: ' + e.message);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8 md:p-12">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-slate-800 text-white flex items-center justify-center shadow-sm flex-shrink-0">
              <SettingsIcon size={26} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Setări Sistem & Backup</h1>
              <p className="text-slate-500 text-sm">Configurări globale, salvări de siguranță și actualizări pentru întregul Hub VR</p>
            </div>
          </div>

          <Link 
            to="/" 
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 transition-colors shadow-sm"
          >
            <ArrowLeft size={18} />
            Înapoi la Hub
          </Link>
        </div>

        {/* Info Bază de Date Centrală */}
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 flex items-start gap-4 text-blue-900 shadow-sm">
          <Info className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <strong className="font-bold block text-base mb-1">Bază de date unificată pentru întregul Hub</strong>
            Toate modulele din aplicație (Stocuri/Producție, Vânzări, Daily Cash, etc.) împart o singură bază de date locală. Când efectuezi un backup sau o restaurare aici, salvezi sau restaurezi datele pentru <strong>toată aplicația</strong>.
          </div>
        </div>

        <div className="space-y-6">
          {/* Card Backup & Restore */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div className="flex items-center gap-3">
                <Database className="w-6 h-6 text-blue-600" />
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Bază de Date (Backup & Restore)</h2>
                  <p className="text-xs text-slate-500">Gestiunea copiilor de siguranță pentru prevenirea pierderii datelor</p>
                </div>
              </div>

              {lastBackup && (
                <div className="flex items-center gap-2 bg-blue-100/70 text-blue-800 px-3.5 py-1.5 rounded-full text-xs font-semibold border border-blue-200">
                  <Clock size={14} />
                  Ultimul backup automat: {lastBackup}
                </div>
              )}
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Salvare Manuala */}
              <div className="border border-slate-200 rounded-xl p-5 flex flex-col justify-between hover:border-slate-300 transition-colors">
                <div>
                  <h3 className="font-bold text-slate-800 mb-1 flex items-center gap-2">
                    <Download size={18} className="text-slate-600" />
                    Creare Backup Manual
                  </h3>
                  <p className="text-slate-500 text-sm mb-6 leading-relaxed">
                    Generează pe loc un fișier de siguranță conținând toată starea curentă a bazei de date. Poți alege unde să îl salvezi (stick USB, Google Drive, folder extern).
                  </p>
                </div>
                <button 
                  onClick={handleManualBackup}
                  className="w-full bg-slate-800 hover:bg-slate-900 text-white py-2.5 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  <Download size={18} />
                  Salvează Copie de Siguranță
                </button>
              </div>

              {/* Restaurare */}
              <div className="border border-rose-100 bg-rose-50/30 rounded-xl p-5 flex flex-col justify-between">
                <div>
                  <h3 className="font-bold text-rose-900 mb-1 flex items-center gap-2">
                    <Upload size={18} className="text-rose-600" />
                    Restaurare Bază de Date
                  </h3>
                  <p className="text-rose-700/80 text-sm mb-6 leading-relaxed">
                    Încarcă un fișier de backup creat anterior pentru a reveni la o stare salvată. <strong>Atenție:</strong> datele curente vor fi înlocuite cu cele din backup.
                  </p>
                </div>
                <button 
                  onClick={handleRestoreBackup}
                  className="w-full bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 py-2.5 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  <Upload size={18} />
                  Încarcă Bază de Date
                </button>
              </div>
            </div>
          </div>

          {/* Card Actualizări Sistem */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
              <RefreshCw className="w-6 h-6 text-emerald-600" />
              <div>
                <h2 className="text-lg font-bold text-slate-800">Actualizări Aplicație (Updates)</h2>
                <p className="text-xs text-slate-500">Verifică disponibilitatea de noi versiuni publicate pe GitHub</p>
              </div>
            </div>
            
            <div className="p-6 flex flex-col md:flex-row justify-between items-center gap-4">
              <div>
                <p className="text-slate-800 font-medium">Sistem de actualizare automată în fundal</p>
                <p className="text-slate-500 text-sm mt-0.5">Aplicația verifică periodic și instalează noile versiuni în mod automat. Poți forța o căutare manuală oricând.</p>
              </div>

              <button 
                onClick={handleCheckUpdates}
                disabled={isCheckingUpdate}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg font-medium transition-colors flex items-center gap-2 shadow-sm flex-shrink-0"
              >
                <RefreshCw size={18} className={isCheckingUpdate ? 'animate-spin' : ''} />
                {isCheckingUpdate ? 'Se caută...' : 'Caută Update-uri'}
              </button>
            </div>
          </div>

          {/* Card Configurare și Setări Viitoare */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden opacity-90">
            <div className="p-6 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
              <Sliders className="w-6 h-6 text-indigo-600" />
              <div>
                <h2 className="text-lg font-bold text-slate-800">Alte Setări & Preferințe</h2>
                <p className="text-xs text-slate-500">Secțiune pregătită pentru viitoare configurări ale sistemului</p>
              </div>
            </div>
            
            <div className="p-8 text-center bg-slate-50/30 border-2 border-dashed border-slate-200 m-6 rounded-xl">
              <Sliders className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <h3 className="font-bold text-slate-700 mb-1">Mai multe opțiuni vor fi adăugate în curând</h3>
              <p className="text-slate-500 text-sm max-w-md mx-auto">
                Aici vei putea adăuga preferințe legate de companie, cote TVA, unități de măsură implicite, imprimante de rapoarte sau teme de interfață în versiunile viitoare.
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
