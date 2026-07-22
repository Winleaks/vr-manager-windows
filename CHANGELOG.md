### 🚀 v0.1.51 - Sincronizare Versiune Auto-Updater & Build Automat Executabil GitHub

- **Fix Auto-Updater Release Version:** Sincronizat `package.json` cu versiunea release `0.1.51` pentru declanșarea automată a actualizării pe calculatoare prin GitHub Releases.
- **Atribute Extinse Produse & Formatare Bilingvă Facturi:** Include modulul nou de produse de pe platformă (`name`, `name_ro`, `variant_label`, `unit`, `price_standard`, `available`), opțiunile de ștergere facturi/tranzacții cash și sincronizarea entităților.

---

### 🍞 v0.1.50 - Atribute Complete Produse (Name, Nume RO, Variant Label, Price Standard) & Formatare Bilingvă pe Factură

- **Atribute Extinse Produse:** Pagina *Produse Platformă* afișează acum toate coloanele exacte din baza de date: **Name** (numele în engleză), **Romanian Name** (`name_ro`), **Variant Label** (`variant_label`), **Unit** (`unit`), **Standard Price** (`price_standard`) și **Available** (`available`).
- **Formatare Bilingvă pe Facturi PDF:** Pe factură, fiecare produs este rânduit profesional: numele în engleză (`name`) alături de varianta sa (`variant_label`), iar dedesubt este afișat denumirea în română (`name_ro`).
- **Prețuri Preferențiale per Companie:** Prețurile din factură respectă snapshot-ul din comanda extrasă (inclusiv prețurile preferențiale `price_override` per client/companie).
