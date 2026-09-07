# Registru separat — operare și recuperare

Registrul separat este o evidență oficială Writer-only. El nu înlocuiește registrele contabile ale societăților emitente și trebuie inclus în exportul lunar transmis contabilității corespunzătoare.

## Sursa de adevăr

- Starea financiară autoritară este seiful AES-256-GCM `VR - Management/Duplicat/registru-separat.vault`.
- `registru-separat.manifest` conține numai HMAC-uri opace folosite pentru a exclude clienții și comenzile din facturarea normală.
- `registru-separat.pending` este jurnalul idempotent de recuperare. Dacă există, emiterea normală se blochează până când registrul este deblocat și reconciliat.
- PDF-urile și exporturile din `Duplicat` nu sunt criptate și sunt protejate de permisiunile contului Google Drive.

Cheia seifului este aleatorie și este protejată local prin `safeStorage`. PIN-ul de șase cifre autorizează sesiunea, dar nu este folosit drept cheie de criptare. Cheia de recuperare afișată la configurare poate restaura accesul pe un Writer nou și trebuie păstrată offline.

## Reguli operaționale

- Un singur Writer poate emite documente. Viewer-ele nu primesc acces nici la operațiile de citire ale registrului.
- După configurare, facturarea normală și separată necesită o versiune Drive verificată. La indisponibilitatea Drive nu se emit documente.
- Seriile protejate sunt `TGBL`, `VRL`, `CN-TGBL` și `CN-VRL`; seriile normale rămân independente.
- Încasările cash din registrul separat nu alimentează automat Daily Cash.
- Returul de stoc este vizibil în SQLite numai ca `Retur registru separat`, fără client sau referință de document.
- Fișierele temporare de Share sunt eliminate la blocare, expirarea sesiunii, închiderea aplicației și următoarea pornire.
- O factură anulată poate fi reemisă cu un număr nou și emitentul curent al clientului; legătura cu documentul înlocuit rămâne în audit.

## Trecerea live

Înainte de activarea live trebuie eliminate toate documentele de test, apoi se folosește `Curăță datele de test` pentru încasările și creditele rămase. Contoarele trebuie să fie exact `2930 / 2930 / 1 / 1`. Fiecare curățare creează mai întâi un backup criptat. După prima emitere live, Modul test nu mai poate fi reactivat. Revenirea la o versiune mai veche a aplicației nu este sigură după prima emitere protejată.

## Recuperare

1. Oprește facturarea pe Writer-ul vechi.
2. Conectează noul Writer la același cont Google Drive.
3. Deschide accesul ascuns și alege recuperarea.
4. Introdu cheia de recuperare și setează un PIN nou.
5. Verifică dashboardul, contoarele și ultimul export înainte de reluarea emiterii.

Nu șterge manual fișierele `vault`, `manifest` sau `pending`. În caz de eroare, păstrează folderul `Duplicat`, oprește emiterea și recuperează din copia criptată din `Duplicat/Backups`.
