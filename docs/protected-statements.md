# Statement de cont — Registru separat

În profilul clientului: selectează emitentul, toate magazinele sau un magazin cu facturi la acel emitent, apoi perioada. Sunt disponibile Deschide, Printează și Trimite prin Windows Share (WhatsApp dacă este instalat). Același flux de consultare este disponibil pe Viewer.

## Calcul

- Statement-ul întregii companii folosește aceeași regulă ca registrul normal: facturi brute minus Credit Notes emise minus încasări active, inclusiv avansuri. Aplicările de credit sunt transferuri interne, nu încă o încasare.
- Statement-ul unui magazin selectează facturile după identitate, nu după numele magazinului. Credit Notes cu mai multe facturi sunt împărțite după pozițiile sursă.
- Raportul pe magazin include doar încasările alocate facturilor sale și aplicările active de credit. Avansurile nealocate nu sunt atribuite unui magazin.
- Dacă o încasare/creditare depășește soldul facturii, rândul explicativ `Excess to company account` scoate excedentul din contul magazinului. Acesta nu este o operațiune nouă și nu modifică registrul. Previne dubla scădere când creditul este reutilizat, inclusiv în același magazin.
- Soldul inițial provine din mișcările anterioare perioadei. Limitele perioadei sunt inclusive. Raportul reflectă înregistrările actualmente active, la fel ca Statement-ul normal; nu reconstruiește starea istorică de dinaintea unei reversări ulterioare.
- Emitenții și datele TEST/LIVE sunt separate. Facturile și Credit Notes anulate și încasările/aplicările reversate nu contribuie la raport.

## Protecție și compatibilitate

Citire exclusiv din seiful deblocat, prin IPC verificat. Viewer revalidează copia Drive. Writer refuză generarea cât timp există salvări nesincronizate. PDF-ul este temporar și urmează ștergerea existentă la blocarea registrului. Dialogurile Windows nu blochează coada operațiunilor registrului. Nu există schimbări de schemă, migrare sau modificări ale datelor financiare.

## Verificare

- `node --test --experimental-strip-types electron/database/protectedStatement.test.mts electron/security/protectedViewer.test.mts`
- `node scripts/testRendererInputs.mjs --statement-only` (Playwright disponibil; se poate configura `VR_HUB_PLAYWRIGHT_MODULE` și `VR_HUB_VITE_CACHE_DIR`). Date exclusiv sintetice.
- Suita completă: 481 teste trecute; TypeScript, lint și build Vite verificate local.
- PDF demonstrativ de 4 pagini inspectat integral, cu text căutabil, font Arial încorporat și sold final £541.60.
- Imprimarea fizică și distribuirea prin Windows Share/WhatsApp necesită verificare pe Windows; nu au fost executate pe acest Mac. Inclusă în versiunea 0.1.135.
