### 📦 v0.1.70 - Modificări & Imbunătățiri Sistem Facturare PDF & Filtre

- **Personalizare & Optimizare Facturi PDF:**
  - Font **Arial (Unicode)** nativ pentru afișarea 100% corectă a diacriticelor românești (`ș`, `ț`, `ă`, `î`, `â`), rezolvând literele lipsă în LibreOffice și spațiile mari în Adobe Reader.
  - Compactare tabel produse pentru încăperea a **peste 25-30 de produse pe o singură pagină A4**.
  - Adăugare coloană **VAT (0% Zero-Rated)** și defalcare Subtotal / VAT / Total Due în sumar.
  - Logo optimizat și aliniat pe linia titlului INVOICE pentru salvare de spațiu vertical.
  - Afișare numere de telefon la beneficiar (BILL TO) atât pentru compania clientă, cât și pentru magazinul de livrare.

- **Setări Extinse de Facturare:**
  - Câmp dedicat pentru **Adresa Emitentului** (afișată sub ISSUER / FROM).
  - Configurare **două conturi bancare** cu denumirea băncii (ex: Barclays, Revolut, Lloyds), Account Number și Sort Code.
  - Setări de **culoare și opacitate/transparență (0-30%)** pentru rândurile alternate din tabelul de produse cu previzualizare în timp real.

- **Filtru Săptămânal Comenzi:**
  - Selectare ordine comenzi de Luni până Duminică cu marcare vizuală cu verde pentru zilele de Luni și săptămâna activă.

- **Organizare Cloud Sync Google Drive:**
  - Structurare automată a fișierelor în folderul rădăcină `VR - Management`, cu subfolderele `Facturi` și `Baza de date`.
