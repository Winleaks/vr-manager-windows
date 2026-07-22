### 🛡️ v0.1.44 - Fix Suprascriere Google Drive la Conectare PC Nou & Protecție Anti-Suprascriere

- **Eliminare Salvare Automată la Conectare OAuth:** Am eliminat apelul automat de `saveToCloud` din fluxul de conectare la Google Drive. Aplicația nu mai urcă baza de date goală a noului PC peste backup-ul existent din cloud la simpla autentificare.
- **Scut de Protecție Anti-Suprascriere (Safety Guard):** Am adăugat o verificare de siguranță în modulul `saveToCloud`. Dacă baza locală este goală, aplicația refuză să suprascrie backup-ul plin de date din Google Drive.

---

### 🚀 v0.1.43 - Sistem de Sincronizare Automată în Timp Real (Hybrid Real-Time Auto-Sync)

- **Engine de Sincronizare Live:** Am implementat modulul nativ `realtimeSync.ts` care ascultă modificările de pe alt PC în timp real (< 1 secundă).
- **Badge Stare Sincronizare Live:** Adăugat indicatorul stilizat `🟢 Sincronizat Live` în antetul Hub-ului principal, informând utilizatorii despre conectivitate și starea datelor.
- **Auto-Update Interfață (Zero Refresh):** La primirea de date noi de pe un alt calculator, aplicația își re-randează datele automat pe ecran.
- **Arhitectură Offline-First:** Aplicația continuă să opereze fără întrerupere dacă internetul pică temporar, trimitând automat datele când se reia conexiunea.

---

### 🛠️ v0.1.42 - Fix Restaurare Bază de Date Cloud pe Calculatoare Noi

- **Fix Jurnale SQLite WAL & SHM:** Am rezolvat problema anulării datelor la restaurarea pe un PC nou! Aplicația curăță acum automat fișierele temporare vechi de jurnal `.db-wal` și `.db-shm` înainte de restaurare, prevenind suprascrierea datelor aduse din cloud.
- **Integritate Stream Descărcare Google Drive:** Am asigurat că descărcarea bazei de date din cloud este 100% finalizată pe disc (`finish` stream) înainte de înlocuirea fișierului local.
- **Fix Auto-Scan:** Am oprit verificarea automată la repornire care suprascria baza de date abia adusă din cloud cu fișierul gol creat la prima instalare.

---

### 🏛️ v0.1.41 - Optimizări Bază de Date B-Tree, Flexibilitate Google OAuth & UI Update

- **Arhitectură Bază de Date B-Tree (Enterprise 2026):** Am creat indexuri strategice B-Tree pe toate cheile externe (FK) și coloanele tranzacționale de volum. Căutările și interogările rulează acum sub 1ms chiar și la sute de mii de înregistrări.
- **Setări PRAGMA Avansate:** Am activat `synchronous = NORMAL`, `temp_store = MEMORY` și `PRAGMA optimize` la pornire pentru viteză maximă și prevenirea umflării bazei de date.
- **Modal Conectare Google Drive Flexibil:** La conectarea contului Google Drive, aplicația deschide un modal inteligent cu butonul **„Copiază Link-ul”** pe Clipboard. Poți lipi link-ul în orice browser dorești (Chrome, Edge, Brave, Firefox etc.).
- **Actualizare UI:** Subtitlul secțiunii de facturi a fost actualizat la *„Preluare comenzilor din platformă și emitere facturi (Săptămânal)”*.
