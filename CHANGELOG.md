### 👑 v0.1.53 - Relaționare 100% Identică cu Lovable (`client_company` ➔ `stores:client_store!client_company_id`)

- **Interogare Embedded Resource Lovable:** Am implementat interogarea Supabase 1:1 identică cu Lovable: `client_company?select=...,stores:client_store!client_company_id(*)`.
- **Mapare Strictă pe UUID (`client_company_id`):** Fiecare companie mamă din Supabase își aduce lista proprie de magazine pe baza UUID-ului `client_company_id`. Magazinele sunt înregistrate în baza locală direct sub compania mamă reală de care aparțin.
- **Gestionare Magazine Neasociate:** Magazinele fără companie (`client_company_id IS NULL`) sunt grupate separat sub o entitate distinctă ("Magazine Neasociate"), eliminând complet contopirea eronată a tuturor magazinelor sub o singură companie.

---

### 🏢 v0.1.52 - Corelare Definitivă Magazin ➔ Companie Mamă & Curățare Companii Orfane

- **Asociere Garantată Companie Mamă:** Corectat lanțul de sincronizare a magazinelor în SQLite (`stores`). Fiecare magazin deținut de o companie mamă (ex: *CUCURIGU LTD* și *LA STATIE UPTON PARK*) este obligatoriu asociat `company_id`-ului real al companiei sale mamă *CUCURIGU / STATIE UPTON*.
- **Eliminare Fallback Duplicare Nume:** Am eliminat definitiv crearea de companii virtuale cu numele magazinului individual și fallback-ul automat la prima companie din tabelă.
- **Curățare Automată Companii Orfane (`cleanupOrphanCompanies`):** Aplicația detectează și curăță automat companiile create din greșeală fără magazine asociate.
