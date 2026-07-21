### 🚀 Sistem Nou: Extragere Comenzi & Facturare (Partea 1)

- **Bază de date pregătită:** Am restructurat sistemul central (SQLite) pentru a suporta noile concepte de Clienți, Companii, Magazine, Facturi și Plăți.
- **Setări Facturare:** A fost adăugat noul ecran „Setări Facturare” de unde poți salva sigur datele tale de conectare direct către cloud-ul Lovable (Supabase URL, Key, Email, Parolă), cât și detaliile firmei tale emitente.
- **Sincronizare cu Lovable Cloud:** Am integrat oficial SDK-ul Supabase! Noul panou de "Facturi" permite selectarea săptămânii de lucru. Printr-un singur click pe "Sincronizează", aplicația extrage în siguranță absolut toate comenzile (nelivrate, facturabile) și produsele asociate direct de la tine de pe platformă.
- **Logică inteligentă:** Comenzile extrase din Lovable sunt prelucrate și grupate automat per *Magazin (Store)* pentru a le avea pregătite de emitere pe o singură factură consolidată, utilizând prețul înghețat (unit_price_snapshot) al platformei.
