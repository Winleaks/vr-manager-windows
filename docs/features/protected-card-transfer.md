# Încasare cu cardul și transfer definitiv

Implementare locală, fără publicare. Schema SQLite 29; versiunea aplicației nu este modificată de această lucrare.

## Operator

În Registru separat → Facturi sau profilul clientului, folosește acțiunea „Încasează cu cardul și transferă”. Introdu suma pozitivă, data, banca (Barclays, Virgin sau HSBC) și referința tranzacției. Banca este obligatorie pentru transferurile noi și se păstrează pe încasarea cu cardul în registrul normal. Transferurile începute înaintea introducerii selectorului se reiau cu cererea originală, fără atribuirea unei bănci fictive. Rezumatul arată încasările existente și restul după plata nouă. O singură confirmare transferă întreaga factură, inclusiv când plata este parțială.

Factura normală primește următorul număr al emitentului original și data confirmării transferului. Se păstrează pozițiile și valorile originale. Încasările vechi își păstrează datele și metodele; nu se creează numerar nou în Daily Cash. În registrul normal, PDF și Statement nu apare proveniența documentului. Clientul rămâne atribuit registrului separat pentru facturile viitoare.

După finalizare, „Deschide PDF” deschide documentul normal când acesta este disponibil. Dacă pregătirea PDF-ului sau Drive întârzie, reîncearcă documentul/sincronizarea; nu crea o altă factură. Nu se trimite automat un mesaj clientului.

Sursa este afișată „Transferată” în istoricul protejat, fără sold activ; fișierul PDF original este păstrat. Nu există transfer înapoi. Încasările vechi, deja reconciliate, sunt protejate împotriva editării/ștergerii din registrul normal; eventualele corecții necesită verificarea evidenței originale.

Facturile TEST, anulate, fără rest disponibil, cu Credit Notes active sau cu credite aplicate sunt refuzate cu motiv. Operațiunea cere Writer, registru deblocat și lipsa salvărilor protejate în așteptare. Viewer nu are comanda IPC și nu afișează acțiunea.

## Întreruperi și recuperare

1. Se salvează în seiful criptat cererea exactă și blocarea sursei, cu un identificator permanent.
2. O tranzacție SQLite rezervă numărul și factura normală inactivă, invizibilă în proiecția normală. Jurnalul local conține identificatorul opac, ID-ul normal și un digest; legătura cu sursa rămâne criptată.
3. Se confirmă în Drive închiderea sursei și a alocărilor vechi. Apoi o tranzacție SQLite activează destinația și adaugă o singură dată încasările.
4. Coada existentă generează PDF-ul normal. Publicarea portalului combină facturile protejate rămase cu cele normale și elimină vechea identitate din portal. Nu publică o stare intermediară incompletă. Backup-ul obișnuit este programat după finalizare.

„Reia / verifică transferul” păstrează aceeași cerere; deblocarea Writer încearcă și reluarea operațiunilor neterminate. O eroare de rețea poate ascunde un commit reușit, de aceea nu se inventează alt identificator la reluare.

Dacă se restaurează o bază Writer anterioară jurnalului unui transfer deja confirmat în seif, operațiunea este refuzată explicit. Se restaurează copia Writer corespunzătoare, nu se reemite automat factura. Nu șterge jurnalul, nu reduce contoarele și nu modifica manual starea sursei. Migrarea 29 folosește snapshot-ul verificat existent înainte de migrare.

Încasările mutate pot preceda data noii facturi. Un Statement pentru o perioadă care începe după acele încasări va avea sold inițial creditor; factura nouă și plata cu cardul duc la soldul final corect.

## Verificări

Testele dedicate sunt în `electron/database/protectedTransfer.test.mts`. Acoperă plăți mixte/integrale, date vechi, două magazine/emitenți, confirmări simultane, reluare cu același identificator, rollback SQLite, redeschiderea unui fișier SQLite, întreruperi în salvarea criptată și în fiecare etapă locală, refuz Viewer, vizibilitate, numerar, Statement, portal și text PDF. Testul de extracție PDF folosește `pdftotext` când este disponibil.

Formular: `node scripts/testRendererInputs.mjs --transfer-only`, cu adaptoare sintetice și trafic extern blocat. Regresiile generale folosesc același script fără argument.

Limite: testele Drive/portal injectează defecțiuni în adaptoare sintetice; nu contactează producția. Instalarea și restaurarea pe Windows, imprimarea și verificarea portalului/Drive real se fac înainte de publicare. Nu s-au schimbat date reale și nu s-a publicat o versiune nouă.
