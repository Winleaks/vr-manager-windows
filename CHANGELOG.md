### 💥 v0.1.59 - Corectare Definitivă `syncSupabaseOrders` (Eliminat Nume Magazin ca Nume de Companie)

- **Eliminare Definitivă Fallback Virtual Company:** Am eliminat din funcția `syncSupabaseOrders` (butonul "Sincronizează comenzi din cloud") codul vechi de fallback care creea companii virtuale purtând numele magazinului.
- **Relaționare Garantată pe Compania Mamă Reală:** La preluarea comenzilor din cloud, magazinul (**CUCURIGU LTD**, **LA STATIE UPTON PARK**, etc.) caută compania mamă reală (**CUCURIGU / STATIE UPTON**) exclusiv pe baza UUID-ului `client_store.client_company_id = client_company.id`. Sub fiecare companie mamă apar exclusiv magazinele care îi aparțin!

---

### 🔧 v0.1.58 - Reconstruire Nativă Dependințe Electron CI/CD (`install-app-deps`)

- **Fix Native Module Rebuild în GitHub Actions:** Adăugat pasul `npx electron-builder install-app-deps` în workflow-ul de CI/CD pentru a garanta re-compilarea nativă fără eșec a librăriei `better-sqlite3` pe mașinile Windows ale GitHub Actions.
- **Relaționare 100% Garantată pe UUID:** Sincronizarea entităților se execută direct pe baza legăturii `client_store.client_company_id = client_company.id`.
