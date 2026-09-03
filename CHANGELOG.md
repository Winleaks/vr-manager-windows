### În lucru

### VR - Hub Management v0.1.88

- Ordinea produselor din `Product Order` (`display_order`) este sincronizată read-only din VR Baker Platform și folosită consecvent în cataloagele Hub Manager, selectoarele operaționale, vânzarea directă, facturi și Credit Notes.
- Liniile facturilor păstrează ordinea produsului în SQLite; resincronizarea catalogului poate reordona prezentarea documentelor existente fără a modifica denumiri, cantități, prețuri sau totaluri.
- Produsele fără o ordine configurată sunt afișate după produsele ordonate, cu fallback stabil alfabetic; materiile prime locale nu sunt afectate.
- Confirmarea ștergerii în Modul test acceptă numărul istoric afișat pentru facturile migrate înaintea introducerii seriilor, păstrând referința canonică în audit.
- Writer-ul poate emite facturi manuale dintr-o pagină dedicată, alegând compania, magazinul, data și produse existente din catalogul local.
- Emitentul, seria, numărul și denumirile bilingve ale produselor sunt rezolvate autoritar în backend; facturile manuale nu creează legături false cu comenzile VR Baker.
- Prețul standard este completat automat, cantitatea și prețul pot fi ajustate pentru document, iar PDF-ul este generat din factura recitită din SQLite.
- Viewer-ele pot vedea facturile replicate, dar nu pot emite facturi manuale.

### VR - Hub Management v0.1.87

- Facturile folosesc coloane compacte și centrate, cu mai mult spațiu pentru denumirile bilingve ale produselor și fără ruperea aceluiași produs între pagini.
- Data documentelor este afișată `DD-MM-YYYY`, referința facturii este evidențiată cu bold, iar numerotarea paginilor este calculată corect ca `Page X of Y`.
- Footerul facturilor și Credit Notes include creditul sistemului de facturare și site-ul `www.razvancristofor.ro`; totalurile sunt păstrate împreună cu ultimele poziții.
- Postcode-ul magazinului este importat read-only din VR Baker Platform, păstrat prin migrarea SQLite v14 și afișat separat de adresa companiei-client, fără dublare.
- Credit Notes folosesc aceleași reguli de dată, paginare, footer, culori și rânduri indivizibile, fără chenare negre.
- Modul de testare permite ștergerea definitivă numai a facturilor fără dependențe financiare, iar încasările pot fi corectate auditabil fără a afecta alte societăți emitente.
- Produsele sincronizate și documentele de facturare afișează numai numele în engleză și română, fără `variant label`.

### VR - Hub Management v0.1.86

- Writer-ul poate emite Credit Notes integrale sau parțiale pentru una sau mai multe facturi ale aceleiași companii și aceluiași emitent, inclusiv pentru facturi plătite.
- `THE GOODNESS BAKER LTD` și `VATRA ROMANEASCA LTD` au serii și contoare Credit Note independente, confirmate explicit înaintea primei emiteri și protejate împotriva reducerii sau reutilizării numerelor.
- Soldurile facturilor separă valoarea brută, suma creditată, valoarea netă, numerarul încasat, creditul aplicat și restul real; surplusurile devin credit disponibil izolat per companie și emitent.
- Creditul poate fi aplicat manual în ordine FIFO și reversat auditabil numai în cadrul aceluiași client și emitent.
- Returul în stoc este opțional și permis numai pentru produse mapate neechivoc; anularea internă inversează aplicările și mișcările de stoc fără a șterge documentul sau numărul.
- PDF-urile Credit Note folosesc snapshoturile juridice persistate, afișează tratamentul VAT corect pentru fiecare emitent și sunt salvate local și în Google Drive.
- Viewer-ele pot consulta documentele replicate, dar nu pot emite, anula, aplica credit sau modifica numerotarea.
- Migrarea SQLite v13 este atomică, idempotentă și creează un snapshot local verificat înainte de modificarea soldurilor financiare.

### VR - Hub Management v0.1.85

- Facturarea acceptă două societăți emitente: `THE GOODNESS BAKER LTD` ca emitent implicit VAT și `VATRA ROMANEASCA LTD` ca emitent alternativ non-VAT.
- Fiecare emitent are date juridice și bancare, culoare, serie și contor propriu; atribuirea se face o singură dată la nivelul companiei-client și se aplică automat tuturor magazinelor sale.
- Generarea individuală și loturile săptămânale mixte rezolvă emitentul exclusiv în backend, păstrează snapshotul juridic pe factură și anulează întregul lot dacă o configurare sau numerotare este invalidă.
- PDF-urile sunt separate pe emitent, iar facturile Vatra nu afișează și nu colectează VAT. Previzualizarea, lista facturilor, clienții și dashboardul permit filtrarea după emitent.
- Plățile, avansurile și creditele sunt izolate per companie și emitent, fără mutarea istoricului când atribuirea clientului se schimbă.
- Ștergerea definitivă a facturilor și PDF-urilor a fost eliminată. Facturile fără plăți pot fi anulate cu motiv și, pentru importurile săptămânale, reemise auditabil cu un număr nou.
- Migrarea SQLite este atomică și idempotentă: păstrează facturile și creditele existente la Goodness, detectează sigur numerele istorice și nu modifică VR Baker Platform, care rămâne read-only.

### VR - Hub Management v0.1.84

- Sincronizarea comenzilor acceptă toate identificatoarele UUID canonice stocate valid de PostgreSQL, inclusiv identificatoarele istorice fără marcajele RFC restrictive.
- Importul săptămânal continuă să respingă identificatori malformați și păstrează filtrarea comenzilor `open` și `locked`, fără acces de scriere în VR Baker Platform.
- Validatorul Edge Function folosește aceeași regulă ca aplicația Windows, prevenind erori similare la filtrare și paginare.

### VR - Hub Management v0.1.83

- La prima pornire după update, exclusiv pe calculatorul Writer, Daily Cash este reconciliat o singură dată la soldul fizic de `£241.74`.
- Diferența este înregistrată tranzacțional ca ajustare protejată, fără rescrierea sau ștergerea încasărilor și plăților existente.
- Un marker persistent împiedică repetarea ajustării la repornire; Viewer-ele primesc rezultatul numai prin replica verificată din Google Drive.

### VR - Hub Management v0.1.82

- Materiile prime rămân gestionate manual în aplicația Windows și primesc denumiri bilingve: engleză sus, română dedesubt, cu suport complet pentru diacritice.
- O singură actualizare a catalogului VR Baker sincronizează tranzacțional produsele finite folosite în producție și facturare, fără interogări duplicate.
- Sincronizarea automată la simpla deschidere a paginii a fost eliminată; catalogul este interogat numai când operatorul Writer apasă butonul de actualizare.
- Facturarea săptămânală folosește direct snapshotul produselor din comenzi și păstrează pe factură denumirea în engleză, denumirea în română, varianta și unitatea.
- PDF-urile facturilor afișează denumirea în engleză cu majuscule și denumirea în română pe rândul următor, fără a modifica facturile istorice.
- Produsele manuale vechi și toate stocurile, rețetele și istoricul local sunt păstrate; baza VR Baker Platform rămâne exclusiv read-only.

### VR - Hub Management v0.1.81

- Produsele finite se sincronizează automat din catalogul VR Baker Platform la deschiderea paginii și pot fi reîmprospătate manual prin butonul `Actualizează produse`.
- Produsele manuale sunt asociate după nume când există în catalog, iar cele rămase sunt arhivate fără ștergerea istoricului, rețetelor sau stocului existent.
- Prețul standard din catalog este completat automat în Vânzare Directă și poate fi ajustat înainte de încasare.
- Vânzările directe pot duce stocul produselor finite sub zero; producția ulterioară corectează automat soldul.
- Viewer-ele folosesc exclusiv catalogul replicat prin SQLite și nu contactează VR Baker Platform.

### VR - Hub Management v0.1.80

- Butonul `Încasează (Cash)` din Vânzare Directă înregistrează bonul cu protecție la apăsări repetate și actualizează imediat datele afișate.
- Erorile reale de validare, zi închisă, produs inactiv sau stoc insuficient sunt afișate operatorului fără pierderea produselor introduse pe bon.
- Cantitatea, prețul unitar și totalul sunt validate înainte de înregistrarea tranzacției.

### VR - Hub Management v0.1.79

- Daily Cash generează un raport PDF autoritar, structurat și paginat, cu solduri, totaluri pe categorii și tranzacții detaliate în GBP.
- Butonul `Trimite pe WhatsApp` folosește Windows Share cu PDF-ul deja inclus; operatorul alege WhatsApp și apoi destinatarul, fără introducerea sau salvarea unui număr.
- Writer-ul poate închide manual ziua și poate redeschide numai ziua calendaristică actuală; zilele închise blochează modificările și păstrează jurnalul operațiunilor.
- Închiderea automată de la 00:00 preia corect soldul final inclusiv după o închidere manuală, iar Viewer-ele rămân fără drepturi de modificare sau partajare.

### VR - Hub Management v0.1.78

- Toate câmpurile numerice folosesc un singur control stabil pentru tastatură în Electron/Windows; câmpurile native `type=number` sunt interzise prin test automat.
- Încasările, plățile, vânzările directe, facturarea, producția, rețetele și stocurile acceptă introducerea directă, lipirea și separatorul zecimal cu punct sau virgulă.
- Evenimentele intermediare de tastatură nu mai blochează câmpul: valorile sunt normalizate sigur în loc să fie respinse integral.
- Câmpurile text primesc global focus, cursor vizibil și selecție normală în aplicația Windows.

### VR - Hub Management v0.1.77

- Toate câmpurile de sumă, cantitate, preț și stoc acceptă introducerea directă de la tastatură, inclusiv separatorul zecimal cu punct sau virgulă.
- Soldul Daily Cash poate fi inițializat o singură dată la `£578.25`, apoi este administrat automat din încasări și plăți, fără editare manuală.
- Inițializarea soldului este protejată împotriva modificării sau ștergerii ulterioare și rămâne disponibilă numai pe calculatorul Writer.
- Ștergerea tranzacțiilor din Daily Cash reîncarcă imediat soldul și istoricul, iar erorile pentru zile închise sau intrări inexistente sunt afișate operatorului.

### VR - Hub Management v0.1.76

- Încasările și celelalte operațiuni Daily Cash sunt filtrate după data locală reală la care au fost înregistrate, nu după data unei sesiuni vechi.
- Writer-ul închide automat casa la ora locală 00:00 și transferă soldul final ca sold de deschidere al zilei noi; la prima pornire repară tranzacțiile de astăzi atașate sesiunii vechi.
- Câmpurile numerice pot fi completate normal de la tastatură în întreaga aplicație.
- Vânzarea Directă acceptă cantități întregi precum 1, 2, 3 sau 10, iar prețul unitar păstrează două zecimale.
- Introducerea cantității în Producție poate fi ștearsă și rescrisă fără blocarea valorii.

### VR - Hub Management v0.1.75

- Câmpurile din Setări → Personal afișează explicit textul și cursorul pe Windows.
- Formularele pentru angajați și șoferi păstrează stabil valorile tastate înainte de salvare.

### VR - Hub Management v0.1.74

- Daily Cash poate fi reconciliat cu numerarul fizic existent la trecerea din alt program; diferența este înregistrată auditabil, fără rescrierea istoricului.
- Calculul soldului curent este normalizat la două zecimale și noua ajustare este disponibilă numai pe calculatorul Writer.
- Notificarea de actualizare este păstrată în procesul principal și reaplicată după încărcarea interfeței, inclusiv pentru verificarea manuală din Setări.
- Detaliile updaterului sunt limitate la câmpurile necesare, iar notele versiunii sunt afișate ca text, fără interpretare HTML.

### VR - Hub Management v0.1.73

- Daily Cash permite setarea unui sold de deschidere cu două zecimale înainte de prima tranzacție, inclusiv `£1,893.24`.
- Încasările de la șoferi pot fi modificate sau șterse cât timp ziua de casă este deschisă.
- Zilele închise rămân imuabile, iar calculatoarele Viewer nu pot executa noile operații de casă.

### VR - Hub Management v0.1.72

- Autentificarea Google Drive folosește PKCE și nu mai include un client secret în pachetul desktop.
- Redenumire completă a aplicației, installerului și identității Windows în `VR - Hub Management`.
- Migrare atomică și idempotentă a bazei SQLite, backupurilor, credentialelor și rolului Writer/Viewer din instalările vechi.
- Sincronizare Google Drive actualizată, cu migrare compatibilă și verificarea replicilor înainte de aplicare.
- Roluri Writer/Viewer întărite și operațiuni de backup/restore cu validare și recuperare locală.
- Integrare read-only securizată cu VR Baker Platform, fără expunerea credentialelor în interfața aplicației.
- Facturare săptămânală tranzacțională pentru comenzile `open` și `locked`, cu protecție împotriva duplicatelor și detectarea modificărilor sursei.
- Eliminarea vechiului flux desktop de autentificare email/parolă pentru importurile externe.
- Întărirea validării IPC, operațiunilor de stoc, producție, casă, facturare, fișierelor PDF și sincronizării cloud.

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
