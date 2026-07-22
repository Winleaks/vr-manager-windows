### 🎯 v0.1.46 - Corelare 100% UUID Supabase & Eliminare Limitare Paginare REST

- **Paginare Completa Supabase (`limit=10000` & `Range: 0-9999`):** Am eliminated limitarea implicită de 10-20 de rânduri aplicată de PostgREST API pe tabela `client_company`. Toate companiile (inclusiv cele aflate mai jos în tabelă, ex: *CUCURIGU / STATIE UPTON*) sunt aduse 100% integral.
- **Potrivire UUID Impecabilă (`client_company_id`):** Magazinele precum *CUCURIGU LTD* și *LA STATIE UPTON PARK* care au același `client_company_id` (`abc-123-...`) sunt legate instant de compania lor mamă reală *CUCURIGU / STATIE UPTON*.

---

### 💼 v0.1.45 - Corectare Companie Reală Magazin & Persistență Clienți în Sistemul de Facturare

- **Fix Corelare Nume Companie Reală:** Am eliminat eroarea de fallback unde numele companiei devenea identic cu numele magazinului. Aplicația aduce acum compania reală de care aparține magazinul (ex: *Shree sai supermarket* pentru magazinul *NISA LOCAL RM30*).
- **Persistență Clienți & Entități:** La fiecare sincronizare de comenzi din cloud, toți Clienții, Companiile și Magazinele noi se adaugă/actualizează automat în baza de date locală SQLite (`clients`, `companies`, `stores`), fără a fi șterși vreodată.
- **Sistem Facturare Complet:** Toate facturile emise și situațiile de plată/restanțe rămân stocate permanent în aplicație pentru urmărirea istoricului financiar.

---

### 🛡️ v0.1.44 - Fix Suprascriere Google Drive la Conectare PC Nou & Protecție Anti-Suprascriere

- **Eliminare Salvare Automată la Conectare OAuth:** Am eliminat apelul automat de `saveToCloud` din fluxul de conectare la Google Drive. Aplicația nu mai urcă baza de date goală a noului PC peste backup-ul existent din cloud la simpla autentificare.
- **Scut de Protecție Anti-Suprascriere (Safety Guard):** Am adăugat o verificare de siguranță în modulul `saveToCloud`. Dacă baza locală este goală, aplicația refuză să suprascrie backup-ul plin de date din Google Drive.
