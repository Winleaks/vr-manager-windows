### 🏢 v0.1.52 - Corelare Definitivă Magazin ➔ Companie Mamă & Curățare Companii Orfane

- **Asociere Garantată Companie Mamă:** Corectat lanțul de sincronizare a magazinelor în SQLite (`stores`). Fiecare magazin deținut de o companie mamă (ex: *CUCURIGU LTD* și *LA STATIE UPTON PARK*) este obligatoriu asociat `company_id`-ului real al companiei sale mamă *CUCURIGU / STATIE UPTON*.
- **Eliminare Fallback Duplicare Nume:** Am eliminat definitiv crearea de companii virtuale cu numele magazinului individual și fallback-ul automat la prima companie din tabelă.
- **Curățare Automată Companii Orfane (`cleanupOrphanCompanies`):** Aplicația detectează și curăță automat companiile create din greșeală fără magazine asociate.

---

### 🚀 v0.1.51 - Sincronizare Versiune Auto-Updater & Build Automat Executabil GitHub

- **Fix Auto-Updater Release Version:** Sincronizat `package.json` cu versiunea release `0.1.51` pentru declanșarea automată a actualizării pe calculatoare prin GitHub Releases.
- **Atribute Extinse Produse & Formatare Bilingvă Facturi:** Include modulul nou de produse de pe platformă (`name`, `name_ro`, `variant_label`, `unit`, `price_standard`, `available`), opțiunile de ștergere facturi/tranzacții cash și sincronizarea entităților.
