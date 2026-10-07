# Încasări din aplicația șoferilor — Hub 0.1.126

Writer importă declarațiile la pornire și la fiecare 30 de secunde, cu autentificarea integrării existente și identitatea `billing_publication_identity`. Numai Writer configurat în `billing_control` este acceptat. Hub închis: serverul păstrează declarațiile, contul clientului se actualizează la pornirea Writer-ului.

## Înregistrare și corectare

Migrarea 26 adaugă un registru de comenzi, grupuri de plăți și o coadă durabilă pentru corectările biroului. Importul SQLite este atomic: Daily Cash, plăți pe cele mai vechi facturi ale companiei și emitentului, surplus ca credit, audit și coada existentă de publicare a soldului. UUID/revizie și confirmarea separată pe server protejează retrimiterile și răspunsurile pierdute.

Identitățile magazinului și companiei sunt UUID-uri explicite. Șoferul platformei are un ID local legat unic de UUID; nu se îmbină cu un șofer manual după nume. Compania lipsă sau asocierea ambiguă blochează numai procesarea financiară, păstrând declarația pentru rezolvare. După corectarea asocierii explicite și sincronizarea clienților, folosiți „Reîncearcă după rezolvare”. În platformă, 43 din 245 magazine active nu aveau companie asociată la verificarea din 7 octombrie (25 dintre magazinele cu comenzi în ultimele 30 de zile). Nu au fost atribuite automat.

Corectarea din Hub inversează grupul anterior și realocă suma; 0 anulează încasarea păstrând istoricul. Nu permite editarea separată a unei alocări sau doar a casei. Creditul consumat, intervențiile concurente sau documentele dependente produc conflict. Diferențele sunt în ziua curentă; ziua curentă închisă se redeschide auditat, iar raportul trebuie regenerat. Zilele istorice nu se rescriu.

Dacă serverul are o comandă procesată, dar backupul restaurat nu o conține, sincronizarea se oprește. Nu procesați din nou banii; restaurați registrul Writer corect. Erorile definitive suspendă reîncercările automate și apar în panoul declarațiilor.

## Verificare

414 teste Node au trecut, inclusiv alocări peste mai multe magazine, separarea emitenților, reducere/zero, surplus, lipsă facturi, credit consumat, răspuns pierdut, restaurare veche, asociere lipsă, zi închisă și rollback SQLite injectat. TypeScript, lint și build Vite au trecut. Formularul real a fost verificat în Chromium cu date sintetice: validare zecimale, revizie inițială, blocare în timpul salvării, păstrarea formularului la conflict, zero și Viewer.

Serverul folosește migrarea `20261007110841_driver_cash_collections` și external-api versiunea 24, peste codul live 23 verificat. RPC-urile Hub sunt rezervate service_role; integrarea impune billing:write și Writer-ul configurat. Cererea HTTP fără autentificare a fost refuzată cu 401. Nu au fost create plăți sau livrări de test în producție.

## Lansare și revenire

Ordine: server compatibil, installer Hub 0.1.126, Android 1.3.83/code 98, apoi activare. Actualizați Writer-ul înaintea folosirii încasărilor. Declarațiile acceptate rămân pe server chiar dacă Hub nu este deschis sau nu a fost actualizat.

Revenirea oprește declarațiile noi prin `driver_cash_control.enabled=false` și fixează `disabled_at_ms` la ora opririi. Declarațiile/corectările offline deja salvate înaintea opririi și comenzile acceptate pot fi procesate în continuare. Scriptul este în repository Android `supabase/rollbacks/20261007110841_driver_cash_collections.sql`. Păstrați Hub 0.1.126, schema 26 și Room 10; nu ștergeți registrul, coada sau auditul și nu reveniți la un executabil care nu știe să proceseze încasările.

Instalarea pe PC-ul operațional și o încasare reală din flotă nu au fost verificate în această sesiune. Verificarea Windows a installerului este realizată de workflow-ul de lansare înainte de publicare.
