# Schimbarea emitentului unei facturi

Implementare locală peste v0.1.106 (`a641a272`), fără publicare și fără modificări în datele reale.

## Contract

- Writer: editorul normal și acțiunea cu icon din registrul separat.
- Emitent diferit, activ și complet configurat; data locală de azi propusă, dată editabilă și motiv obligatoriu.
- Original anulat, înlocuitoare cu ID și număr noi, legături în ambele sensuri. Compania, magazinul, produsele, prețurile și emitentul implicit al companiei sunt păstrate.
- Plățile, Credit Notes emise și creditul aplicat blochează schimbarea; nu există transfer de bani.
- În editor, modificările nesalvate trebuie salvate sau abandonate explicit.

## Persistență și sincronizare

`billing:changeInvoiceIssuer` validează și execută tranzacția SQLite IMMEDIATE. Auditul existent păstrează cererea normalizată, rezultatul și identificatorul operației. Reîncercările identice întorc același rezultat; reutilizarea identificatorului cu altă cerere este respinsă. Nu este necesară migrare de schemă.

`protectedRegistry:changeInvoiceIssuer` folosește o singură mutație serializată a seifului. Cererea este păstrată în înlocuitoare pentru idempotență durabilă, inclusiv după eliminarea vechilor identificatori din lista limitată de operații. Datele nu sunt copiate în SQLite. Reîncercarea reîmprospătează sesiunea din seiful recuperat.

Loturile și comenzile importate rămân asociate originalului; lanțul de înlocuiri identifică factura curentă, inclusiv după schimbări succesive. Unicitatea comenzilor rămâne intactă. Înlocuitoarele importate păstrează și regulile de editare specifice importului.

Trigger-ele existente înregistrează anularea și noua factură în publicare și pun numai PDF-ul nou în coada documentelor. Identitatea și fișierul Drive ale originalului nu sunt reutilizate pentru înlocuitoare. Generarea folosește snapshotul emitentului destinație, inclusiv conturile bancare. Eroarea PDF nu inversează emiterea și nu cere un număr nou.

## Dovezi

- 292 teste automate: toate trec; TypeScript și build Vite pentru renderer/main/preload: trec.
- Ambele sensuri, manual/importat, ambele registre; păstrarea pozițiilor, conturilor, soldurilor, comenzilor și setării emitentului companiei.
- Validări negative pentru identitate, ID, emitent, dată/motiv, plăți și credite; Viewer și seif blocat.
- Reîncercări/concurență, rollback SQLite inclusiv cozi/audit; orchestrarea reală a seifului testată cu adaptoare de stocare sintetice pentru întreruperi și recuperare.
- Payload-ul normal de publicare conține originalele anulate și înlocuitoarea activă, fără sold dublat.
- Browser local cu date sintetice: editor, modificări nesalvate/abandonare, dialog normal/separat, motiv obligatoriu, dată locală, Viewer, factură blocată, navigare din tastatură, reîncercare cu același operationId și eșec PDF după emitere. Fără erori în consola paginii.
- PDF-uri sintetice pentru ambii emitenți: extragere text și verificare vizuală; referință, emitent, bancă, cont și total corecte.

## Limite și publicare

Nu a fost rulat un instalator Windows și nu au fost mutate facturi reale în Drive sau în platformă. Aceste verificări rămân necesare la release, după confirmarea utilizatorului. Buildul local nu echivalează cu validarea unui instalator Windows.

Înainte de publicare: reverificarea ultimei versiuni remote și a modificărilor din alte checkout-uri, backup Writer/seif, build Windows și test controlat al operației și sincronizării. Nu împinge automat ramura de release.

Rollback: înainte de utilizare se poate retrage modificarea de cod. După emiterea unor înlocuitoare, păstrați datele și numerele deja alocate; nu restaurați un backup vechi peste operații valide și nu reveniți la cod care ignoră lanțurile de înlocuire. Recuperarea documentelor se face prin reîncercarea PDF-ului, nu prin reemitere.
