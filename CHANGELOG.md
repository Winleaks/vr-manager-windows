### 🍞 v0.1.50 - Atribute Complete Produse (Name, Nume RO, Variant Label, Price Standard) & Formatare Bilingvă pe Factură

- **Atribute Extinse Produse:** Pagina *Produse Platformă* afișează acum toate coloanele exacte din baza de date: **Name** (numele în engleză), **Romanian Name** (`name_ro`), **Variant Label** (`variant_label`), **Unit** (`unit`), **Standard Price** (`price_standard`) și **Available** (`available`).
- **Formatare Bilingvă pe Facturi PDF:** Pe factură, fiecare produs este rânduit profesional: numele în engleză (`name`) alături de varianta sa (`variant_label`), iar dedesubt este afișat denumirea în română (`name_ro`).
- **Prețuri Preferențiale per Companie:** Prețurile din factură respectă snapshot-ul din comanda extrasă (inclusiv prețurile preferențiale `price_override` per client/companie).

---

### 📦 v0.1.49 - Buton "Sincronizează cu Serverul" & Noua Pagină "Produse Platformă"

- **Sincronizare Entități Server (`Sincronizează cu Serverul`):** Schimbat numele și funcționalitatea butonului de la *Clienți & Entități*. La apăsare, aplicația extrage din cloud Supabase toți Clienții, Companiile și Magazinele aferente și le actualizează instant în baza locală.
- **Noua Pagină "Produse" la Facturare (`/facturare/produse`):** Adăugat modulul dedicat pentru Vizualizarea și Sincronizarea Nomenclatorului de Produse de pe site/server. Produsele se actualizează automat atât la sincronizarea comenzilor, cât și la apăsarea butonului dedicat *Sincronizează cu Serverul*.

---

### 🗑️ v0.1.48 - Opțiuni de Ștergere Facturi & Ștergere Tranzacții Daily Cash

- **Ștergere Factură (Billing Invoices):** Adăugat butonul de ștergere (cu confirmare de siguranță) pe fiecare card de factură generată. La ștergere, se elimină factura, produsele și plățile asociate din baza de date.
- **Ștergere Tranzacție Daily Cash:** Adăugat butonul de ștergere pe coloana de Acțiuni din registrul Daily Cash. Dacă o tranzacție a scăzut stocul de produse finite (vânzare directă), stocul este automat reîntregit la ștergere.
