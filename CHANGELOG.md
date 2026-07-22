### 🛠️ v0.1.39 - Optimizare UI UK: Nume Companie Magazin, VAT No & CRN

- **Fix Afișare Companie Magazin:** Am corectat proprietatea citită pe frontend (`data.store.client_company?.name`) astfel încât numele companiei să apară corect pentru fiecare magazin în lista de comenzi, în loc de *„Companie neasociată”*.
- **Terminologie Specifică UK (VAT No & CRN):** Am înlocuit termenii românești CUI și Reg. Com. cu termenii uzuali din Marea Britanie: **VAT No** (VAT Registration Number) și **CRN** (Company Registration Number).
- **Fix Cod Poștal pe VAT:** Am eliminat orice fallback ce aloca eronat codul poștal al magazinului în câmpul de VAT Number.

---

### 🛠️ v0.1.38 - Corelare Inteligentă Magazin & Companie Supabase

- **Fix Corelare Supabase:** Am optimizat procesul de extragere al magazinelor (`client_store`) și companiilor (`client_company`) din cloud-ul Supabase. Aplicația extrage acum toate datele magazinului și corelează precis cheia `client_store.client_company_id` cu `client_company.id`.
- **Prevenire Blocaj Facturare:** În caz de inconsistențe în cloud, aplicația aplică o rezoluție automată cu fallback pentru a preveni erorile de facturare și a asigura preluarea tuturor comenzilor fără oprire.
- **Atașare Date Fiscale pe Factură:** Datele complete ale firmei (Nume, CUI, Reg. Com., Adresă) se atașează automat pe obiectul magazinului și pe facturile PDF emise.

---

### 🚀 Sistem Nou: Extragere Comenzi & Facturare (Partea 1)

- **Bază de date pregătită:** Am restructurat sistemul central (SQLite) pentru a suporta noile concepte de Clienți, Companii, Magazine, Facturi și Plăți.
- **Setări Facturare:** A fost adăugat noul ecran „Setări Facturare” de unde poți salva sigur datele tale de conectare direct către cloud-ul Lovable (Supabase URL, Key, Email, Parolă), cât și detaliile firmei tale emitente.
- **Sincronizare cu Lovable Cloud:** Am integrat oficial SDK-ul Supabase! Noul panou de "Facturi" permite selectarea săptămânii de lucru. Printr-un singur click pe "Sincronizează", aplicația extrage în siguranță absolut toate comenzile (nelivrate, facturabile) și produsele asociate direct de la tine de pe platformă.
- **Logică inteligentă:** Comenzile extrase din Lovable sunt prelucrate și grupate automat per *Magazin (Store)* pentru a le avea pregătite de emitere pe o singură factură consolidată, utilizând prețul înghețat (unit_price_snapshot) al platformei.
