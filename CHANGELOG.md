### 🎯 v0.1.57 - Corelare Absolută pe UUID (`client_store.client_company_id = client_company.id`)

- **Eliminat Eșec PostgREST Complex JOIN:** Înlocuit interogarea JOIN complexă Supabase (care eșua cu HTTP 400 Bad Request) cu două cereri separate 100% sigure: extragere companii (`client_company`) și extragere magazine (`client_store`).
- **Mapare Impecabilă pe Harta de Companii:** Aplicația construiește o hartă `uuidToLocalCompanyMap` după UUID-urile companiilor mamă. Fiecare magazin (ex: *CUCURIGU LTD*, *LA STATIE UPTON PARK*) este asociat direct și exclusiv `company_id`-ului companiei sale mamă (*CUCURIGU / STATIE UPTON*, *LA POPA*, etc.) pe baza potrivirii exacte a UUID-ului `client_company_id`.

---

### 🚀 v0.1.56 - Nativ Electron-Builder Publishing (Fix Conflict `already_exists`)

- **Fix GitHub Release Conflict:** Trecut procesul de publicare GitHub Release exclusiv pe modulul nativ `electron-builder --win --x64 -p always`. Aceasta elimină conflictul de dublă încărcare a activelor și eroarea `already_exists`.
