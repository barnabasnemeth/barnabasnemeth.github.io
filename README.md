# barnabasnemeth.github.io

## Helyi előnézet

A `localhost`, `127.0.0.1` és `[::1]` címeken a webhely automatikusan helyi
előnézetet használ. A megszokott helyi webszerverrel, például a Live Server
`http://127.0.0.1:5500/` címén is megjelenik a tortalista és két, egyértelműen
mintaként jelölt szezonális termék. Ehhez nem kell éles adatbázis-migráció.

A `/admin.html` helyben belépés nélkül kipróbálható. A módosítások a böngésző
helyi tárhelyére kerülnek, ugyanazon a címen a főoldal és a rendelési oldal is
ezeket látja. Rendelés és ajánlatkérés elküldése ebben az előnézetben le van tiltva.
A helyi adatok a `cremes-local-preview-v1` localStorage-kulcs törlésével
állíthatók vissza. Az alap kínálat nyilvános pillanatképe a
`js/local-preview-data.json` fájlban található.

Az éles domain továbbra is a Supabase adatbázist használja.

## Szezonális termékek

Élesítés előtt futtasd a `supabase/migrations/0004_seasonal_products.sql` fájlt
a meglévő Supabase projekt SQL Editorában. A korábbi migrációk már legyenek
alkalmazva; a `0001_init.sql` fájlt meglévő adatbázison ne futtasd újra.
Ezután tölthetők fel a frissített statikus fájlok.

Az admin **Kínálat → Szezonális termékek** részében lehet terméket hozzáadni,
szerkeszteni és inaktívvá tenni. Kép nélkül a `/images/logo.png` jelenik meg.
A rendelési határidő magyar idő szerinti dátum és idő, és a megadott pillanatban
lezárul a rendelés. Az átvételi időszak mindkét szélső napot tartalmazza.
Lejárat után a termék a főoldalon marad, amíg inaktívvá nem teszitek.

Kizárólag szezonális termékeknél nincs kétnapos előrendelési korlát vagy
rövid határidős felár. Vegyes kosárnál a normál szabályok is érvényesek.
A teljes zárások és a beállított átvételi idősávok mindkét esetben számítanak.

## Ellenőrzés

Node.js használatával: `npm ci`, majd `npm test`.
A tesztek elkülönített, memóriában futó PostgreSQL adatbázist és DOM környezetet
használnak; az éles Supabase projektet nem módosítják.

A `rendeles.html` és a `rendeles/index.html` ugyanazt a rendelési oldalt
szolgálja ki; a két példányt együtt kell frissíteni.

## Átvételi időpontok ellenőrzése

Az időpont-ellenőrzés élesítéséhez a `0004_seasonal_products.sql` után futtasd
a `supabase/migrations/0005_pickup_slot_validation.sql` migrációt, majd töltsd
fel a frissített statikus fájlokat. Ez a migráció a rendelést mentő függvényt
frissíti; árakat és felárbeállításokat nem módosít.

Az átvételi sáv kezdőpontja budapesti idő szerint értendő. A már elkezdődött
sáv nem rendelhető. Tortát tartalmazó kosárnál a beállított előrendelési napok
24 órás időtartamokat jelentenek: a kétnapos korlát pontosan 48 eltelt óra,
óraátállításkor is. Kizárólag szezonális kosárnál nincs előrendelési korlát,
de az átvételi sávnak még a jövőben kell kezdődnie.

Az idősávok címkéje például `12–14` vagy `12:00–14:00` lehet (kötőjel,
félkvirtmínusz és kvirtmínusz is elfogadott). Nem értelmezhető időpontot a
felület és a szerver is elutasít.
