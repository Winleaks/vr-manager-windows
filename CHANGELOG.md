### În lucru

- Trimiterea facturilor și Credit Notes din registrul separat folosește aceeași componentă nativă ca facturile obișnuite, cu PDF validat și proces păstrat pentru citirea atașamentului. Metoda veche PowerShell nu mai este folosită pentru aceste documente; blocarea registrului oprește transferurile sale, fără a închide dialogurile altor facturi.
- Câmpurile de cantitate și preț din Credit Notes permit ștergerea completă și rescrierea valorii; registrul separat nu mai reintroduce automat valoarea inițială. Valorile incomplete sunt semnalate la emitere, fără blocarea tastării.
- Alertele și confirmările rendererului sunt afișate în hub, fără ferestrele native Chromium care pot afecta focusul pe Windows. Confirmările financiare și distructive rămân explicite, cu anulare implicită; mesajele registrului separat dispar la blocarea acestuia.
- Butonul „Sincronizează Comenzi” oferă repararea confirmată și cu backup a asocierilor istorice, apoi reîncarcă aceeași săptămână. Nu mai necesită mutarea în pagina „Clienți & Entități” pentru acest pas; emiterea facturilor rămâne separată și protejată împotriva duplicatelor.

### VR - Hub Management v0.1.101

- Repară eroarea „db is not defined” la asocierea PDF-urilor existente și încărcarea facturilor în Drive.
- Sincronizarea completă poate repara asocierile istorice cu o companie verificată și poate prelua unirile de magazine aprobate în platformă. Writer-ul cere confirmare și creează un backup verificat înainte de modificare.
- Facturile, produsele, sumele și comenzile originale sunt păstrate. Legătura importului se mută pe magazinul păstrat, fără facturare dublă; conflictele de perioadă, plăți sau credite opresc repararea.
- Înregistrările virtuale vechi, fără istoric financiar și deja înlocuite printr-o asociere exactă, nu mai aglomerează lista companiilor și coada de publicare. Datele istorice nu sunt șterse.
- Include toate modificările din v0.1.100. După actualizare, rulează sincronizarea din „Clienți & Entități”, verifică lista și confirmă repararea, apoi reîncearcă asocierea PDF-urilor și publicarea facturilor.

### VR - Hub Management v0.1.100

- Editarea facturii actualizează PDF-ul de lucru existent în Drive și îl mută din structura veche în folderul clientului, păstrând ID-ul și linkul. Copiile tehnice ale platformei rămân separate; duplicatele ambigue nu sunt suprascrise automat.
- Sincronizarea completă verifică numărul de companii și magazine înainte de reconciliere. Magazinele inactive și clienții fără acces propriu își păstrează asocierile și facturarea comenzilor introduse de admin, agent sau standing orders.
- Entitățile care nu mai apar în VR Baker sunt marcate separat, fără ștergerea istoricului. Publicarea companiilor dispărute este oprită; numele duplicate sunt semnalate fără unire automată.
- Rezultatul și erorile sincronizării sunt afișate în interfață. Panoul de publicare se actualizează automat, iar ID-urile PostgreSQL istorice valide nu mai sunt respinse de validatorul facturării.
- Migrarea locală 18 păstrează datele și creează o copie verificată înainte de upgrade. Necesită API-ul compatibil cu exportul complet; nu activează accesul clienților și nu înlocuiește verificarea facturilor/PDF-urilor rămase.

### VR - Hub Management v0.1.99

- Include integral corecțiile din v0.1.98 și modificările din ramura de publicare a facturilor clienților, fără revenire la o versiune mai veche.
- Pregătește sincronizarea privată a facturilor și soldurilor din Writer către platformă, cu o coadă persistentă, revizii și reîncercări idempotente. Activarea sincronizării și accesul clienților rămân controlate separat, după verificare și reconciliere.
- PDF-urile încărcate în Drive sunt legate de ID-ul și revizia facturii; copiile existente pot fi asociate prin verificarea conținutului, fără suprascriere sau ștergere automată.
- Migrarea bazei de date la versiunea 17 creează o copie verificată înainte de upgrade, inclusiv pentru bazele aflate deja la versiunea 16.

### VR - Hub Management v0.1.98

- Editorul facturii permite adăugarea produselor din catalog inclusiv pe facturile importate. Cantitatea și prețul unitar pot fi ajustate manual, iar numărul facturii, încasările și comenzile originale sunt păstrate.
- Produsele adăugate preiau tariful clientului din VR Baker, inclusiv reducerile pe produs, categorie sau client; în lipsa reducerilor se aplică prețul standard. Dacă tarifele nu pot fi verificate online, adăugarea este blocată cu explicație, fără a împiedica editarea pozițiilor existente.
- Iconul „Deschide factura” este disponibil din nou alături de WhatsApp și printare. Erorile deschiderii PDF-ului sunt afișate corect.
- Componenta Windows de printare și partajare nu mai este lansată cu fereastra ascunsă. Printarea are limite de așteptare și mesaje explicite pentru blocaje; anularea rămâne distinctă de eroare, iar după o trimitere neconfirmată operatorul este avertizat să verifice coada imprimantei înainte de reîncercare.

### VR - Hub Management v0.1.97

- Corectarea manuală a cantităților și prețurilor funcționează și pentru facturile importate; totalurile și statusul plății se recalculează, păstrând încasările, identitatea emitentului și legăturile cu importul original. Modificările sunt auditate.
- Același editor este disponibil prin iconul de editare din Facturi Emise și din profilul clientului, în filele Facturi Restante și Toate Facturile. Editarea rămâne disponibilă numai pe Writer, fără a permite modificarea facturilor anulate sau cu credite asociate.
- Salvarea locală este confirmată separat de actualizarea PDF-ului și de încărcarea Google Drive; erorile sau întârzierile cloud nu mai sunt prezentate ca eșec al salvării facturii.
- PDF-ul folosit la regenerare, trimitere și printare este construit din factura salvată, inclusiv după corectarea manuală a unei comenzi importate.
- Trimiterea facturilor folosește o componentă Windows nativă cu DataTransferManager și PDF atașat, în locul comenzii Explorer. Printarea folosește dialogul Windows și randarea PDF nativă, fără previzualizarea PDF incompatibilă din Electron.
- Componenta Windows x64 include propriul runtime .NET și este verificată înainte de împachetare. Necesită Windows 10 build 19041 sau mai nou / Windows 11; WhatsApp Desktop trebuie să fie disponibil ca destinație Windows Share.

### VR - Hub Management v0.1.96

- Facturile active pot fi trimise rapid prin Windows Share cu PDF-ul deja atașat; operatorul alege WhatsApp și apoi contactul, fără Explorer, WhatsApp Web sau alerte blocante.
- Lista facturilor, profilul clientului și pagina de generare afișează aceleași iconuri compacte pentru WhatsApp și printare, cu tooltipuri, accesibilitate din tastatură și stare de încărcare.
- Printarea deschide direct dialogul Windows, iar anularea lui nu este raportată ca eroare.
- Writer și Viewer pot trimite sau printa numai PDF-ul rezolvat autoritar după ID-ul unei facturi active; căile arbitrare și facturile anulate sunt refuzate în procesul principal.

### VR - Hub Management v0.1.95

- Previzualizarea comenzilor afișează numere consecutive pentru fiecare factură pregătită, cu secvențe independente pentru `THE GOODNESS BAKER LTD` și `VATRA ROMANEASCA LTD`; contoarele reale continuă să avanseze numai la emitere.
- Facturile și Credit Notes noi sau regenerate sunt organizate local și în Google Drive în foldere distincte pentru fiecare client, păstrând compatibilitatea de citire cu locațiile vechi.
- Regenerarea unei facturi înlocuiește copia verificată din folderul clientului, iar ștergerea definitivă din Modul test elimină și PDF-urile asociate din Google Drive și de pe calculator.
- Data unei facturi importate din VR Baker poate fi corectată manual fără modificarea pozițiilor, cantităților sau prețurilor provenite din comandă.
- Câmpurile PIN ale registrului separat acceptă din nou introducerea normală de la tastatură pe Windows și păstrează mascarea celor șase cifre.

### VR - Hub Management v0.1.94

- Repară reconectarea Google Drive din v0.1.93: buildul Windows include din nou perechea completă de credentiale a clientului OAuth Desktop la schimbul codului de autorizare, păstrând portul local dinamic, PKCE și validarea stării.
- Workflow-ul de release refuză publicarea dacă lipsește oricare dintre valorile OAuth necesare, prevenind generarea unui installer care nu se poate conecta la Google Drive.
- Mesajul pentru o configurație OAuth incompletă nu mai identifică eronat clientul existent drept aplicație Web.

### VR - Hub Management v0.1.93

- Reconectarea Google Drive folosește un port local liber ales automat, eliminând conflictele produse de portul fix la autentificarea OAuth pe Windows.
- Tokenul este salvat numai după ce aplicația verifică efectiv accesul la Google Drive; erorile de autorizare, rețea și configurare sunt afișate explicit operatorului.
- Verificarea opțională a emailului contului nu mai poate marca drept defectă o conexiune Drive funcțională.
- Setările afișează numai folderul principal `My Drive / VR - Management`, fără numele sau calea fișierului bazei de date și a facturilor.
- Registrul separat refuză configurarea înainte ca accesul Google Drive al Writer-ului să fie verificat.

### VR - Hub Management v0.1.92

- Adaugă registrul oficial separat, disponibil numai pe Writer prin gestul ascuns și un PIN de 6 cifre, cu blocare temporară după încercări greșite, expirarea sesiunii și cheie de recuperare.
- Starea autoritară este criptată AES-256-GCM în `My Drive / VR - Management / Duplicat`; facturarea normală verifică manifestul opac din Drive și exclude automat companiile și comenzile atribuite registrului separat.
- Registrul folosește seriile independente `TGBL`, `VRL`, `CN-TGBL` și `CN-VRL` și permite facturi individuale, manuale, pe zonă sau pentru toate magazinele eligibile.
- Include anulare și reemitere auditabilă, Credit Notes integrale sau parțiale, încasări separate pe emitent, credit FIFO, reversări și retur generic în stoc.
- PDF-urile protejate pot fi deschise sau partajate temporar prin Windows Share, iar exportul lunar creează un registru Excel și copii ale documentelor pentru contabilitate în folderul `Duplicat`.
- Modul test marchează documentele `TEST – NOT A TAX INVOICE`, creează backupuri criptate înaintea ștergerilor și blochează trecerea live până la eliminarea documentelor și a datelor financiare de test și revenirea contoarelor la valorile inițiale.
- Viewer-ele nu primesc niciun API al registrului, iar fișierele temporare sunt curățate la blocare, expirare, închidere și următoarea pornire.
- În Modul test normal, facturile deja anulate pot fi șterse definitiv împreună cu dependențele lor financiare pentru pregătirea bazei live.

### VR - Hub Management v0.1.91

- Societatea emitentă se configurează acum direct în profilul fiecărui client din `Clienți & Entități`, cu alegeri distincte pentru emitentul implicit, `VATRA ROMANEASCA LTD` și `THE GOODNESS BAKER LTD`.
- Alegerea se aplică tuturor magazinelor clientului și numai facturilor viitoare; istoricul, plățile și creditele existente rămân legate de emitentul original.
- Migrarea SQLite v16 păstrează atribuirile Vatra existente ca explicite și tratează clienții Goodness existenți drept utilizatori ai emitentului implicit.
- Replica Writer este publicată exclusiv în folderul existent `My Drive / VR - Management / Baza de date`, iar facturile în `My Drive / VR - Management / Facturi`.
- Fiecare upload al bazei și al PDF-urilor este confirmat prin folder părinte, nume, dimensiune și checksum MD5; o conexiune OAuth existentă nu mai este raportată fals drept sincronizare funcțională.
- Reconectarea Writer-ului publică imediat un snapshot verificat, sincronizarea automată raportează eșecurile în interfață, iar o bază locală goală nu poate suprascrie nici copia nouă, nici backupul istoric.
- Ecranele de facturare nu mai pretind că PDF-ul se află în Google Drive atunci când încărcarea sau verificarea lui a eșuat.

### VR - Hub Management v0.1.90

- Facturile săptămânale pot fi filtrate și generate atomic pentru o singură zonă de livrare, inclusiv grupa controlată `FĂRĂ ZONĂ ALOCATĂ`.
- Zonele active, culoarea, șoferul și ordinea magazinelor sunt preluate read-only prin același export VR Baker, fără o sincronizare desktop separată.
- Emiterea pe zonă revalidează sursa în backend, omite facturile deja generate și păstrează emitentul, seria și contorul propriu fiecărei societăți.
- În Modul test, ștergerea unei facturi elimină tranzacțional și încasările, Credit Notes, aplicările de credit și legăturile de reemitere asociate, după crearea obligatorie a unui backup verificat.
- Efectele Credit Notes asupra stocului și soldurilor sunt inversate înaintea ștergerii, iar contoarele sunt retrase numai când numărul șters este ultimul număr sigur.
- Simulatorul recompilă automat `better-sqlite3` pentru ABI-ul Electron înainte de pornire și îl readuce la ABI-ul Node înaintea testelor, evitând eroarea `NODE_MODULE_VERSION`.

### VR - Hub Management v0.1.89

- Bazele existente pot trece corect de la schema v14 la v15: indicii pentru ordinea produselor sunt creați numai după adăugarea coloanelor necesare, eliminând pornirea fără fereastră din v0.1.88.
- Erorile fatale de inițializare sunt acum raportate operatorului printr-un dialog explicit, în loc ca aplicația să rămână fără fereastră și fără explicație.
- Pornirea Writer-ului nu mai afișează eroarea de reconciliere Daily Cash atunci când reconcilierea unică a fost deja aplicată sau ziua curentă a fost închisă manual.
- Verificarea markerului de reconciliere are loc înaintea citirii zilei și a backupului, evitând operații inutile la fiecare repornire sau actualizare.

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
