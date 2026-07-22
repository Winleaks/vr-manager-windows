### 💼 v0.1.45 - Corectare Companie Reală Magazin & Persistență Clienți în Sistemul de Facturare

- **Fix Corelare Nume Companie Reală:** Am eliminat eroarea de fallback unde numele companiei devenea identic cu numele magazinului. Aplicația aduce acum compania reală de care aparține magazinul (ex: *Shree sai supermarket* pentru magazinul *NISA LOCAL RM30*).
- **Persistență Clienți & Entități:** La fiecare sincronizare de comenzi din cloud, toți Clienții, Companiile și Magazinele noi se adaugă/actualizează automat în baza de date locală SQLite (`clients`, `companies`, `stores`), fără a fi șterși vreodată.
- **Sistem Facturare Complet:** Toate facturile emise și situațiile de plată/restanțe rămân stocate permanent în aplicație pentru urmărirea istoricului financiar.

---

### 🛡️ v0.1.44 - Fix Suprascriere Google Drive la Conectare PC Nou & Protecție Anti-Suprascriere

- **Eliminare Salvare Automată la Conectare OAuth:** Am eliminat apelul automat de `saveToCloud` din fluxul de conectare la Google Drive. Aplicația nu mai urcă baza de date goală a noului PC peste backup-ul existent din cloud la simpla autentificare.
- **Scut de Protecție Anti-Suprascriere (Safety Guard):** Am adăugat o verificare de siguranță în modulul `saveToCloud`. Dacă baza locală este goală, aplicația refuză să suprascrie backup-ul plin de date din Google Drive.

---

### 🚀 v0.1.43 - Sistem de Sincronizare Automată în Timp Real (Hybrid Real-Time Auto-Sync)

- **Engine de Sincronizare Live:** Am implementat modulul nativ `realtimeSync.ts` care ascultă modificările de pe alt PC în timp real (< 1 secundă).
- **Badge Stare Sincronizare Live:** Adăugat indicatorul stilizat `🟢 Sincronizat Live` în antetul Hub-ului principal, informând utilizatorii despre conectivitate și starea datelor.
- **Auto-Update Interfață (Zero Refresh):** La primirea de date noi de pe un alt calculator, aplicația își re-randează datele automat pe ecran.
- **Arhitectură Offline-First:** Aplicația continuă să opereze fără întrerupere dacă internetul pică temporar, trimitând automat datele când se reia conexiunea.
