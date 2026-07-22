### 🛠️ v0.1.55 - Fix Definitiv Sintaxă Build Vite Electron (Success CI/CD Release)

- **Fix Sintaxă Build Electron Main:** Corectat blocul duplicat din `electron/ipc/billingHandlers.ts`. Build-ul local Vite + Rolldown și build-ul automat din GitHub Actions funcționează acum 100% fără erori.
- **Relaționare Garantată Lovable:** Sincronizare 1:1 bazată pe UUID (`client_company_id`).

---

### ⚙️ v0.1.54 - Optimizare GitHub Actions Build Workflow (Node 20 LTS & Robust Asset Upload)

- **Fix CI/CD Windows Build:** Actualizat GitHub Actions Runner la Node 20 LTS pentru garantarea compilării modulelor native C++ (better-sqlite3) și eliminarea erorii `exit code 1`.
- **Relaționare 100% Identică cu Lovable:** Sincronizarea entităților se execută direct prin embedded resources Supabase (`client_company?select=...,stores:client_store!client_company_id(*)`).
