# Nulmeting: Rhadix Makelaarsportaal (testomgeving)

**Vastgelegd:** 9 november 2026, vóór de eerste woningimport. **Bron:** de bestaande meting
(`meting.sh`, elke 5 minuten) en een momentopname van 9-11 rond 11:00 UTC. Er is geen
belastingtest uitgevoerd en er is niets gewijzigd. De ruwe meetwaarden van de rustige periode staan ernaast:

- `2026-11-09-nulmeting-systeem.csv` (792 regels);
- `2026-11-09-nulmeting-containers.csv`.

**Gebruik:** deze nulmeting is de referentie. Na elke brochure-import en conceptgeneratie meten we dezelfde
punten opnieuw (§8) en vergelijken we met de tabellen hieronder.

## 1. Serverconfiguratie

| Onderdeel | Waarde |
|---|---|
| Server | Hetzner Cloud **CPX32**, Falkenstein (FSN1) |
| CPU | 4 vCPU (AMD EPYC-Genoa), gedeeld |
| Geheugen | 8 GB (7,7 GB bruikbaar), plus 4 GB swap (`vm.swappiness=10`) |
| Schijf | 160 GB SSD (bestandssysteem 150 GB) |
| Software | Ubuntu 24.04.4 LTS, kernel 6.8.0-138; Docker 29.9.3; Compose v5.7.0 |
| Omgevingen | Alleen **test** (`makelaarsportaal-test.rhadix.nl`); productie draait nog niet |
| Toegang | Alleen via Cloudflare (443, host- en Hetzner-firewall). SSH alleen met sleutel, vanaf één IP |
| Achtergrondtaken | <ul><li>back-up dagelijks 02:30 UTC (restic naar Object Storage);</li><li>hersteltest zondag 04:30 UTC;</li><li>meting elke 5 minuten.</li></ul> |

**Containers (testomgeving):**

| Container | Geheugengrens | CPU-grens |
|---|---|---|
| `db` (Postgres 16) | 768 MB | 2 |
| `api` | 1 GB | 2 |
| `verwerker` | 4 GB + 2 GB swap | 4 |
| `web` (nginx) | 128 MB | 1 |

**Versie:** studio `6183855` (vanaf 9-11 10:55 UTC); tijdens de rustige periode `080ba65`. De rustwaarden
van beide versies zijn functioneel gelijk.

## 2. Rustige meetperiode

- **Periode:** 6 november 2026, 14:00 UTC, tot 9 november 2026, 08:00 UTC: **66 uur, 792 metingen, zonder
  onderbrekingen** (geen gat langer dan 6 minuten).
- **Wat er in die periode níet gebeurde:** geen deployments, builds, imports of conceptgeneraties. Er waren
  geen gebruikers op het portaal; de eerste logins volgden op 9-11 vanaf 08:00 UTC.
- **Wél in de periode (normaal bedrijf):**
  - drie nachtelijke back-ups: 7, 8 en 9 november, elk ±4 minuten;
  - één hersteltest: zondag 8 november.
  - Die zitten in de cijfers; in §3 staan ze apart.
- **Buiten de periode** (niet meegeteld):
  - 6-11 12:10–13:55 UTC: inrichting, drie builds en twee uitrollen;
  - 9-11 vanaf 08:00 UTC: inloggen en koppelen;
  - 9-11 10:45–10:56 UTC: build en uitrol `6183855`.

## 3. Systeem (rustige periode)

| Meetwaarde | Gemiddeld | Minimum | Maximum | p95 |
|---|---|---|---|---|
| CPU-gebruik (%) | 0,4 | 0 | 33 (back-up) | 3 |
| CPU zonder back-upvenster (%) | 0,3 | 0 | 13 | 3 |
| CPU tijdens back-up/hersteltest (%, 17 metingen) | 3,0 | 0 | 33 | 18 |
| Load (1 min) | 0,03 | 0,00 | 0,72 | 0,12 |
| Geheugen in gebruik (MB) | 839 | 801 | 867 | 855 |
| Geheugen beschikbaar (MB) | 6.906 | 6.877 | 6.943 | 6.926 |
| Swap in gebruik (MB) | 0 | 0 | 0 | 0 |
| Schijf (%) | 22 | 22 | 22 | 22 |
| Database (map, MB) | 48 | 48 | 48 | 48 |
| Applicatieopslag (MB) | 1 | 1 | 1 | 1 |

**Beschikbaarheid:** de gezondheidscontrole van de testomgeving gaf in de hele periode **792 van de 792 keer 200**.

## 4. Per container (rustige periode)

| Container | CPU gem. (%) | CPU max (%) | Geheugen gem. (MB) | Geheugen max (MB) | Grens (MB) | Max in % van de grens |
|---|---|---|---|---|---|---|
| `db` | 0,69 | 8,4 | 34 | 38 | 768 | 5 % |
| `api` | 0,33 | 8,4 | 86 | 89 | 1.024 | 9 % |
| `verwerker` | 0,18 | 0,4 | 75 | 78 | 4.096 | 2 % |
| `web` | 0,00 | 0,0 | 6 | 6 | 128 | 5 % |
| tijdelijke hersteltestcontainer (1 meting) | 69 | 69 | 31 | 31 | — | — |

## 5. Database en applicatieopslag (momentopname 9-11, ±11:00 UTC)

**Database:** Postgres-database `studio` is **8,7 MB** (`pg_database_size`); de datamap met WAL is 48 MB. 10
migraties zijn toegepast, tot en met `010_rollen_kantoor.sql`.

| Tabel | Rijen |
|---|---|
| kantoor | 1 (Rhadix testmakelaars) |
| gebruiker | 2 (platformbeheer en de testkantoorbeheerder, beide via de Rhadix-login) |
| lidmaatschap | 1 |
| rhadix_organisatie | 2 |
| auditregel | 2 |
| project, bestand, gegeven, besluit, concept, verwerking, aanlevering, activiteit, sessie | 0 |

**Applicatieopslag:** `/srv/makelaarsportaal-test/opslag` bevat **0 bestanden, 0 bytes**.

## 6. Schijfgebruik: structureel en tijdelijk

Momentopname 9-11: **38 GB van 150 GB in gebruik (27 %)**. In de rustige periode was dat 22 %; de build van
9-11 heeft er ±5 GB tijdelijk bijgezet.

| Soort | Omvang | Toelichting |
|---|---|---|
| **Structureel** | | |
| Besturingssysteem en pakketten (`/usr` en de rest) | ±2 GB | |
| Swapbestand | 4,1 GB | Vast |
| SigLIP-model (`/srv/makelaarsportaal-modellen`) | 3,3 GB | Vast; groeit niet |
| Actieve images (app en web, huidige versie) | ±4,6 GB | Een nieuwe versie vervangt de vorige |
| Database (datamap) | 48 MB | Groeit met woningen |
| Applicatieopslag | 0 | Groeit met woningen (brochures, foto's, concepten) |
| Dumps vóór uitrol | 248 kB | De laatste 10 worden bewaard |
| Logs en meetbestanden | ±50 MB | Met rotatie |
| **Tijdelijk** (opnieuw te gebruiken) | | |
| Docker-buildcache | 18,4 GB | Van de builds op de server; versnelt de volgende build |
| Oudere images (d3beaa0, a8aa1b1, 080ba65) | 10,8 GB | Worden niet gebruikt; `080ba65` is de terugvaloptie |
| Ongebruikte Docker-volumes | 97 MB | |

**Conclusie:**
- Het **structurele gebruik is ±14 GB** (zonder woningen); de rest, ±29 GB, is tijdelijk buildmateriaal.
- **Voor vergelijkingen** tellen de applicatieopslag, de database en de actieve images, niet het totale
  schijfpercentage. Dat percentage verandert ook bij elke build.

## 7. Reactietijden en fouten

| Meting | Uitkomst |
|---|---|
| `/api/gezond` op de server (20×, licht) | min 1,0 ms · mediaan 1,1 ms · max 7,2 ms |
| `/api/gezond` via Cloudflare, vanaf de Mac (10×) | min 113 ms · mediaan 162 ms · max 223 ms (vooral netwerk en Cloudflare) |
| HTTP-statussen in de nginx-log (alle verzoeken tot en met 9-11) | 101× 200, 9× 304, 6× 401 (niet ingelogd), 3× 403 (organisatie nog niet gekoppeld; opgelost) |
| Fouten in de logs van API en verwerker sinds 6-11 14:00 | 0 |

**Niet gemeten:**
- De meting registreert per 5 minuten alleen de gezondheidscode, geen reactietijd.
- De nginx-log bevat geen verwerkingstijd per verzoek.
- Echte reactietijden onder gebruik (lijsten, uploads, beoordeling) volgen dus pas uit de importmetingen.

## 8. Wat we na elke import en conceptgeneratie vergelijken

Per brochure: dezelfde onderdelen, plus de piek tijdens de verwerking. Daarvoor tijdelijk elke 2 seconden
meten: `MP_MEETINTERVAL=2 /usr/local/sbin/meting.sh <aantal>`.

| Meetpunt | Nulmeting | Na import | Na concept |
|---|---|---|---|
| Geheugen in gebruik, rust (MB) | 839 | | |
| Piek geheugen `verwerker` (MB, grens 4.096 + 2.048 swap) | 78 | | |
| Swap in gebruik, piek (MB) | 0 | | |
| CPU-piek systeem (%) | 13 (zonder back-up) | | |
| Duur import, waarvan beeldclassificatie (s) | — | | |
| Duur conceptgeneratie (s) | — | | |
| Database (`pg_database_size`) | 8,7 MB | | |
| Rijen bestand / gegeven / besluit / concept | 0 / 0 / 0 / 0 | | |
| Applicatieopslag (bestanden / MB) | 0 / 0 | | |
| Fouten in de API- en verwerkerlog | 0 | | |
| Gezondheidscontrole | 100 % | | |

## 9. Representativiteit en voorlopige conclusies

**Representatief voor de rust:**
- De periode is 66 uur lang (ruim meer dan 24 uur), zonder onderbrekingen, met drie back-ups en een hersteltest.
- Dat is een betrouwbare nulmeting van een **lege, ongebruikte** omgeving: het OS, de vier containers en de
  achtergrondtaken.

**Niet representatief voor gebruik:**
- er staan geen woningen in;
- er was vrijwel geen verkeer;
- de CPU is één keer per 5 minuten gemeten (gemiddeld over 1 seconde), dus korte pieken kunnen gemist zijn.
- Belasting, reactietijden en groei volgen pas uit de drie imports.

**Voorlopige conclusies:**
1. **De ruststand is licht.** Het geheugen in gebruik is ±840 MB van 7,7 GB; de containers samen ±200 MB.
   Er is ±6,9 GB beschikbaar, en de swap is niet gebruikt.
2. **De verwerker krijgt de ruimte.** Zijn grens is 4 GB; in rust gebruikt hij 78 MB. Bij de eerdere proef
   piekte de verwerker op 3,0 GB (Markt 27, arm64). Op deze server past dat binnen de grens, met ±2 GB
   reserve voor de API, de database en het OS. Dat moeten de imports bevestigen.
3. **De CPU is in rust vrijwel onbelast** (gemiddeld 0,3 %). De beeldclassificatie gebruikt straks alle
   4 vCPU; verwacht een langere verwerkingstijd dan in de proef met 6 kernen.
4. **Schijfruimte is geen beperking.** Er is 107 GB vrij en het structurele gebruik is ±14 GB. Het tijdelijke
   buildmateriaal (±29 GB) kan later met akkoord worden opgeruimd; voor de metingen hoeft dat niet.
5. **De back-ups zijn licht:** ±4 minuten per nacht, met een CPU-piek tot 33 % en verder geen effect.
