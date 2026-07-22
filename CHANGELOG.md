### 🔧 v0.1.58 - Reconstruire Nativă Dependințe Electron CI/CD (`install-app-deps`)

- **Fix Native Module Rebuild în GitHub Actions:** Adăugat pasul `npx electron-builder install-app-deps` în workflow-ul de CI/CD pentru a garanta re-compilarea nativă fără eșec a librăriei `better-sqlite3` pe mașinile Windows ale GitHub Actions.
- **Relaționare 100% Garantată pe UUID:** Sincronizarea entităților se execută direct pe baza legăturii `client_store.client_company_id = client_company.id`.

---

### 🎯 v0.1.57 - Corelare Absolută pe UUID (`client_store.client_company_id = client_company.id`)

- **Eliminat Eșec PostgREST Complex JOIN:** Înlocuit interogarea JOIN complexă Supabase (care eșua cu HTTP 400 Bad Request) cu două cereri separate 100% sigure: extragere companii (`client_company`) și extragere magazine (`client_store`).
- **Mapare Impecabilă pe Harta de Companii:** Aplicația construiește o hartă `uuidToLocalCompanyMap` după UUID-urile companiilor mamă. Fiecare magazin (ex: *CUCURIGU LTD*, *LA STATIE UPTON PARK*) este asociat direct și exclusiv `company_id`-ului companiei sale mamă (*CUCURIGU / STATIE UPTON*, *LA POPA*, etc.) pe baza potrivirii exacte a UUID-ului `client_company_id`.
