### 📦 v0.1.61 - Fix Definitiv Auto-Updater Manifest (`latest.yml` GitHub Public Release)

- **Garantare Publicare Fișiere Update:** Am actualizat workflow-ul GitHub Actions pentru a publica în mod explicit fișierul `latest.yml`, executabilul `.exe` și `.blockmap` ca Release Public direct accesibil pentru sistemul de Auto-Update.

---

### 🔒 v0.1.60 - Strict UUID Matching în Repository Local (`upsertStoreFromSupabase` & `upsertCompanyFromSupabase`)

- **Eliminare Căutări Neautorizate după Nume (`LOWER(name)`):** Am eliminat complet potrivirile după nume în SQLite. Companiile și magazinele sunt identificate și legate exclusiv pe baza UUID-ului unic (`supabase_company_id` / `supabase_store_id`).
- **Eliminare Fallback la Prima Companie (`firstCompany`):** Magazinul nu mai poate fi asociat accidental cu prima companie din tabelă. Legătura `client_store.client_company_id -> client_company.id` este strict garantată 1:1 identică cu aplicația externă/Lovable.
