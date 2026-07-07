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
  Info,
  Cloud,
  CloudUpload,
  CloudDownload,
  Folder,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  Trash2,
  FolderSync
} from 'lucide-react';

export function Settings() {
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<{
    isConnected: boolean;
    folderPath: string | null;
    lastCloudBackup: string | null;
    availableBackups: Array<{
      filePath: string;
      fileName: string;
      mtime: number;
      formattedTime: string;
      totalItems: number;
    }>;
  }>({ isConnected: false, folderPath: null, lastCloudBackup: null, availableBackups: [] });
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [showBackupList, setShowBackupList] = useState(false);

  useEffect(() => {
    fetchLastBackup();
    fetchCloudStatus();

    const unsubscribe = api.system.onBackupCompleted(() => {
      fetchLastBackup();
      fetchCloudStatus();
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

  const fetchCloudStatus = async () => {
    try {
      const status = await api.system.getCloudStatus();
      if (status) setCloudStatus(status);
    } catch (e) {}
  };

  const handleSelectCloudFolder = async () => {
    try {
      const res = await api.system.selectCloudFolder();
      if (res && res.success) {
        alert('Folderul Cloud a fost conectat cu succes!\nSincronizarea automată a fost activată.');
        fetchCloudStatus();
      } else if (res && !res.canceled) {
        alert('A apărut o eroare la selectarea folderului.');
      }
    } catch (e: any) {
      alert('Eroare: ' + e.message);
    }
  };

  const handleSaveToCloud = async () => {
    setIsSyncingCloud(true);
    try {
      const res = await api.system.saveToCloud();
      if (res && res.success) {
        alert(`Baza de date a fost salvată în Cloud cu succes!\n\nFișier: ${res.path}\nOră: ${res.time}`);
        fetchCloudStatus();
      } else {
        alert('Eroare la salvarea în cloud:\n' + (res?.error || 'Eroare necunoscută'));
      }
    } catch (e: any) {
      alert('Eroare: ' + e.message);
    } finally {
      setIsSyncingCloud(false);
    }
  };

  const handleRestoreFromCloud = async (specificPath?: string) => {
    if (window.confirm('Ești sigur că vrei să restaurezi baza de date din Cloud? Această acțiune va înlocui baza de date curentă cu cea de pe server/folderul cloud, iar programul se va restarta automat.')) {
      try {
        const res = await api.system.restoreFromCloud(specificPath);
        if (res && res.success) {
          alert(`Restaurare finalizată cu succes din cloud (Scor articole: ${res.totalItems})! Aplicația se va reîncărca.`);
          window.location.reload();
        } else {
          alert('Eroare la restaurarea din cloud:\n' + (res?.error || 'Nu s-a putut restaura fișierul.'));
        }
      } catch (e: any) {
        alert('Eroare: ' + e.message);
      }
    }
  };

  const handleDisconnectCloud = async () => {
    if (window.confirm('Ești sigur că vrei să deconectezi folderul de sincronizare Cloud? Backu-urile existente în folder nu vor fi șterse.')) {
      await api.system.disconnectCloud();
      fetchCloudStatus();
    }
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
          {/* Card Sincronizare Cloud & Server (NEW) */}
          <div className="bg-gradient-to-br from-indigo-900 via-slate-900 to-blue-950 rounded-2xl shadow-xl border border-indigo-500/30 overflow-hidden text-white relative">
            <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>

            <div className="p-6 border-b border-indigo-500/20 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/5 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                  <Cloud className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    Sincronizare Cloud & Server
                    {cloudStatus.isConnected ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                        Activă
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        <AlertCircle size={12} />
                        Neconectat
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-indigo-200/80">Google Drive, OneDrive sau Dropbox pentru transfer rapid pe alt calculator</p>
                </div>
              </div>

              {cloudStatus.lastCloudBackup && (
                <div className="flex items-center gap-2 bg-indigo-950/80 text-indigo-200 px-3.5 py-1.5 rounded-full text-xs font-medium border border-indigo-500/30 shadow-sm backdrop-blur-sm">
                  <Clock size={14} className="text-indigo-400" />
                  Ultimul Sync: {cloudStatus.lastCloudBackup}
                </div>
              )}
            </div>

            <div className="p-6 relative z-10">
              {!cloudStatus.isConnected ? (
                <div className="space-y-6">
                  <div className="bg-white/10 border border-white/10 rounded-xl p-5 backdrop-blur-sm">
                    <h3 className="font-bold text-base text-white mb-2 flex items-center gap-2">
                      <FolderSync className="w-5 h-5 text-blue-400" />
                      Cum funcționează sincronizarea între calculatoare?
                    </h3>
                    <p className="text-indigo-100/80 text-sm leading-relaxed mb-4">
                      Dacă dorești să poți deschide programul pe un alt calculator (acasă, la alt birou, după reinstalarea Windows-ului) și să ai instant acces la toate stocurile și rețetele:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-indigo-200">
                      <div className="bg-white/5 p-3.5 rounded-lg border border-white/5">
                        <strong className="text-white block mb-1">1. Folder Cloud</strong>
                        Asigură-te că ai instalat Google Drive, Microsoft OneDrive sau Dropbox pe calculator.
                      </div>
                      <div className="bg-white/5 p-3.5 rounded-lg border border-white/5">
                        <strong className="text-white block mb-1">2. Conectează</strong>
                        Apasă butonul de mai jos și selectează un folder din Drive / OneDrive dedicat aplicației.
                      </div>
                      <div className="bg-white/5 p-3.5 rounded-lg border border-white/5">
                        <strong className="text-white block mb-1">3. Transfer Automat</strong>
                        La fiecare 10 minute și la cerere, baza de date va fi copiată pe serverul tău cloud!
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={handleSelectCloudFolder}
                    className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-blue-500/25 transition-all transform hover:-translate-y-0.5 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Folder className="w-5 h-5" />
                    Conectează Folder Cloud / OneDrive / Drive
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Folder Conectat Info */}
                  <div className="bg-black/20 border border-white/10 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <HardDrive className="w-6 h-6 text-indigo-400 flex-shrink-0" />
                      <div className="overflow-hidden">
                        <span className="text-xs text-indigo-300 block font-medium">Folder Cloud Conectat:</span>
                        <span className="text-sm font-mono text-white truncate block" title={cloudStatus.folderPath || ''}>
                          {cloudStatus.folderPath}
                        </span>
                      </div>
                    </div>
                    <button 
                      onClick={handleDisconnectCloud}
                      className="text-xs text-rose-300 hover:text-rose-200 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 flex-shrink-0 cursor-pointer"
                    >
                      <Trash2 size={14} />
                      Deconectează
                    </button>
                  </div>

                  {/* Acțiuni de Salvare și Restaurare Cloud */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Salvează in Cloud */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-5 flex flex-col justify-between">
                      <div>
                        <h3 className="font-bold text-white mb-1 flex items-center gap-2">
                          <CloudUpload className="w-5 h-5 text-blue-400" />
                          Salvare Manuală în Cloud
                        </h3>
                        <p className="text-indigo-200/80 text-sm mb-6 leading-relaxed">
                          Trimite pe loc starea curentă a bazei de date pe serverul tău cloud. Aplicația face asta automat și în fundal (la fiecare 10 minute).
                        </p>
                      </div>
                      <button 
                        onClick={handleSaveToCloud}
                        disabled={isSyncingCloud}
                        className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2.5 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 shadow-md shadow-blue-600/30 cursor-pointer"
                      >
                        <RefreshCw size={18} className={isSyncingCloud ? 'animate-spin' : ''} />
                        {isSyncingCloud ? 'Se sincronizează...' : 'Sincronizează Acum în Cloud'}
                      </button>
                    </div>

                    {/* Restaurează din Cloud */}
                    <div className="bg-emerald-950/30 border border-emerald-500/20 rounded-xl p-5 flex flex-col justify-between">
                      <div>
                        <h3 className="font-bold text-emerald-300 mb-1 flex items-center gap-2">
                          <CloudDownload className="w-5 h-5 text-emerald-400" />
                          Adu Baza de Date de pe Server
                        </h3>
                        <p className="text-emerald-200/80 text-sm mb-6 leading-relaxed">
                          Ai instalat pe un alt calculator? Apasă aici pentru a descărca și înlocui baza locală cu ultima versiune aflată în folderul Cloud.
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handleRestoreFromCloud()}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-lg font-bold transition-colors flex items-center justify-center gap-2 shadow-md shadow-emerald-600/30 cursor-pointer"
                        >
                          <CloudDownload size={18} />
                          Restaurează Ultima Versiune
                        </button>
                        {cloudStatus.availableBackups.length > 0 && (
                          <button 
                            onClick={() => setShowBackupList(!showBackupList)}
                            className="px-3 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-medium transition-colors border border-white/10 cursor-pointer"
                            title="Vezi istoric salvări cloud"
                          >
                            Istoric ({cloudStatus.availableBackups.length})
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Lista Backups Disponibile in Cloud */}
                  {showBackupList && cloudStatus.availableBackups.length > 0 && (
                    <div className="bg-black/30 border border-white/10 rounded-xl p-4 mt-4">
                      <h4 className="text-sm font-bold text-white mb-3 flex items-center justify-between">
                        <span>Fișiere de siguranță identificate pe Server / Cloud</span>
                        <span className="text-xs font-normal text-indigo-300">Alege o versiune specifică pentru restaurare</span>
                      </h4>
                      <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                        {cloudStatus.availableBackups.map((b, idx) => (
                          <div key={idx} className="bg-white/5 hover:bg-white/10 p-3 rounded-lg flex items-center justify-between border border-white/5 transition-colors text-xs">
                            <div>
                              <div className="font-semibold text-white">{b.fileName}</div>
                              <div className="text-indigo-300 mt-0.5">Data: {b.formattedTime} | Scor volum: {b.totalItems} articole</div>
                            </div>
                            <button 
                              onClick={() => handleRestoreFromCloud(b.filePath)}
                              className="px-3 py-1.5 bg-emerald-600/80 hover:bg-emerald-600 text-white font-medium rounded transition-colors shadow-sm cursor-pointer"
                            >
                              Restaurează
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

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
