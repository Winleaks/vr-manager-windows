### ⚙️ v0.1.54 - Optimizare GitHub Actions Build Workflow (Node 20 LTS & Robust Asset Upload)

- **Fix CI/CD Windows Build:** Actualizat GitHub Actions Runner la Node 20 LTS pentru garantarea compilării modulelor native C++ (better-sqlite3) și eliminarea erorii `exit code 1`.
- **Relaționare 100% Identică cu Lovable:** Sincronizarea entităților se execută direct prin embedded resources Supabase (`client_company?select=...,stores:client_store!client_company_id(*)`).

---

### 👑 v0.1.53 - Relaționare 100% Identică cu Lovable (`client_company` ➔ `stores:client_store!client_company_id`)

- **Interogare Embedded Resource Lovable:** Am implementat interogarea Supabase 1:1 identică cu Lovable: `client_company?select=...,stores:client_store!client_company_id(*)`.
- **Mapare Strictă pe UUID (`client_company_id`):** Fiecare companie mamă din Supabase își aduce lista proprie de magazine pe baza UUID-ului `client_company_id`. Magazinele sunt înregistrate în baza locală direct sub compania mamă reală de care aparțin.
- **Gestionare Magazine Neasociate:** Magazinele fără companie (`client_company_id IS NULL`) sunt grupate separat sub o entitate distinctă ("Magazine Neasociate"), eliminând complet contopirea eronată a tuturor magazinelor sub o singură companie.
