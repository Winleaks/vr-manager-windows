### 🚀 v0.1.56 - Nativ Electron-Builder Publishing (Fix Conflict `already_exists`)

- **Fix GitHub Release Conflict:** Trecut procesul de publicare GitHub Release exclusiv pe modulul nativ `electron-builder --win --x64 -p always`. Aceasta elimină conflictul de dublă încărcare a activelor și eroarea `already_exists`.

---

### 🛠️ v0.1.55 - Fix Definitiv Sintaxă Build Vite Electron (Success CI/CD Release)

- **Fix Sintaxă Build Electron Main:** Corectat blocul duplicat din `electron/ipc/billingHandlers.ts`. Build-ul local Vite + Rolldown și build-ul automat din GitHub Actions funcționează acum 100% fără erori.
- **Relaționare Garantată Lovable:** Sincronizare 1:1 bazată pe UUID (`client_company_id`).
