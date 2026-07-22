### 🗑️ v0.1.48 - Opțiuni de Ștergere Facturi & Ștergere Tranzacții Daily Cash

- **Ștergere Factură (Billing Invoices):** Adăugat butonul de ștergere (cu confirmare de siguranță) pe fiecare card de factură generată. La ștergere, se elimină factura, produsele și plățile asociate din baza de date.
- **Ștergere Tranzacție Daily Cash:** Adăugat butonul de ștergere pe coloana de Acțiuni din registrul Daily Cash. Dacă o tranzacție a scăzut stocul de produse finite (vânzare directă), stocul este automat reîntregit la ștergere.

---

### 🏬 v0.1.47 - Corelare Garantată 100% Magazin ➔ Companie Mamă & Expandare Supabase JOIN

- **Expandare Supabase Direct JOIN:** Am adăugat expandarea directă `client_company:client_company_id(*)` pe cererea de comenzi Supabase. Orice magazin deținut de o companie mamă (ex: *CUCURIGU LTD* și *LA STATIE UPTON PARK*) își aduce automat datele reale din compania mamă *CUCURIGU / STATIE UPTON*.
- **Garanție Legătură 100% în SQLite:** Fiecare magazin salvat sau sincronizat în baza locală este obligatoriu legat de `company_id`-ul real al companiei sale mamă.

---

### 🎯 v0.1.46 - Corelare 100% UUID Supabase & Eliminare Limitare Paginare REST

- **Paginare Completa Supabase (`limit=10000` & `Range: 0-9999`):** Am eliminated limitarea implicită de 10-20 de rânduri aplicată de PostgREST API pe tabela `client_company`. Toate companiile (inclusiv cele aflate mai jos în tabelă, ex: *CUCURIGU / STATIE UPTON*) sunt aduse 100% integral.
- **Potrivire UUID Impecabilă (`client_company_id`):** Magazinele precum *CUCURIGU LTD* și *LA STATIE UPTON PARK* care au același `client_company_id` (`abc-123-...`) sunt legate instant de compania lor mamă reală *CUCURIGU / STATIE UPTON*.
