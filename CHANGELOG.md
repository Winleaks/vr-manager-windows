### 📦 v0.1.49 - Buton "Sincronizează cu Serverul" & Noua Pagină "Produse Platformă"

- **Sincronizare Entități Server (`Sincronizează cu Serverul`):** Schimbat numele și funcționalitatea butonului de la *Clienți & Entități*. La apăsare, aplicația extrage din cloud Supabase toți Clienții, Companiile și Magazinele aferente și le actualizează instant în baza locală.
- **Noua Pagină "Produse" la Facturare (`/facturare/produse`):** Adăugat modulul dedicat pentru Vizualizarea și Sincronizarea Nomenclatorului de Produse de pe site/server. Produsele se actualizează automat atât la sincronizarea comenzilor, cât și la apăsarea butonului dedicat *Sincronizează cu Serverul*.

---

### 🗑️ v0.1.48 - Opțiuni de Ștergere Facturi & Ștergere Tranzacții Daily Cash

- **Ștergere Factură (Billing Invoices):** Adăugat butonul de ștergere (cu confirmare de siguranță) pe fiecare card de factură generată. La ștergere, se elimină factura, produsele și plățile asociate din baza de date.
- **Ștergere Tranzacție Daily Cash:** Adăugat butonul de ștergere pe coloana de Acțiuni din registrul Daily Cash. Dacă o tranzacție a scăzut stocul de produse finite (vânzare directă), stocul este automat reîntregit la ștergere.

---

### 🏬 v0.1.47 - Corelare Garantată 100% Magazin ➔ Companie Mamă & Expandare Supabase JOIN

- **Expandare Supabase Direct JOIN:** Am adăugat expandarea directă `client_company:client_company_id(*)` pe cererea de comenzi Supabase. Orice magazin deținut de o companie mamă (ex: *CUCURIGU LTD* și *LA STATIE UPTON PARK*) își aduce automat datele reale din compania mamă *CUCURIGU / STATIE UPTON*.
- **Garanție Legătură 100% în SQLite:** Fiecare magazin salvat sau sincronizat în baza locală este obligatoriu legat de `company_id`-ul real al companiei sale mamă.
