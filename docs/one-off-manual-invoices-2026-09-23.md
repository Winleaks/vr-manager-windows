# Facturi manuale pentru clienți ocazionali

Factura manuală are acum două moduri:

- Client permanent: păstrează fluxul existent, cu magazinul și produsele din catalog.
- Client ocazional: operatorul introduce numele și datele clientului, alege societatea emitentă și adaugă produse/bunuri direct pe factură, cu unitate, cantitate și preț.

Clientul ocazional este reprezentat intern prin entități marcate `is_one_off=1`, necesare pentru integritatea relațiilor SQLite, PDF și Drive. Aceste entități nu apar în lista clienților permanenți, în căutarea companiilor pentru sincronizare sau în asocierile VR Baker. Factura și istoricul rămân accesibile în lista facturilor.

Companiile ocazionale nu intră în coada de publicare financiară VR Baker, deoarece nu au cont de client în platformă. PDF-ul se încarcă în Drive prin fluxul normal de documente.

Produsele introduse manual nu sunt scrise în catalogul local/VR Baker și nu pot afecta stocul. Sunt salvate doar în pozițiile facturii. Numerotarea și emitentul folosesc aceleași reguli ca facturile manuale existente.

Migrarea 22 este aditivă și adaugă marcaje pe clienți, companii și magazine; baza este protejată prin snapshot înainte de migrare. Factura ocazională și crearea entităților sunt o singură tranzacție SQLite.
