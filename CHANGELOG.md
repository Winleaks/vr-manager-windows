### 🔒 v0.1.60 - Strict UUID Matching în Repository Local (`upsertStoreFromSupabase` & `upsertCompanyFromSupabase`)

- **Eliminare Căutări Neautorizate după Nume (`LOWER(name)`):** Am eliminat complet potrivirile după nume în SQLite. Companiile și magazinele sunt identificate și legate exclusiv pe baza UUID-ului unic (`supabase_company_id` / `supabase_store_id`).
- **Eliminare Fallback la Prima Companie (`firstCompany`):** Magazinul nu mai poate fi asociat accidental cu prima companie din tabelă. Legătura `client_store.client_company_id -> client_company.id` este strict garantată 1:1 identică cu aplicația externă/Lovable.

---

### 💥 v0.1.59 - Corectare Definitivă `syncSupabaseOrders` (Eliminat Nume Magazin ca Nume de Companie)

- **Eliminare Definitivă Fallback Virtual Company:** Am eliminat din funcția `syncSupabaseOrders` (butonul "Sincronizează comenzi din cloud") codul vechi de fallback care creea companii virtuale purtând numele magazinului.
- **Relaționare Garantată pe Compania Mamă Reală:** La preluarea comenzilor din cloud, magazinul (**CUCURIGU LTD**, **LA STATIE UPTON PARK**, etc.) caută compania mamă reală (**CUCURIGU / STATIE UPTON**) exclusiv pe baza UUID-ului `client_store.client_company_id = client_company.id`. Sub fiecare companie mamă apar exclusiv magazinele care îi aparțin!
