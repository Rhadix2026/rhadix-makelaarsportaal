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

| Meetpunt | Nulmeting | Na import Markt 27 | Na concept |
|---|---|---|---|
| Geheugen in gebruik, rust (MB) | 839 | 833 (5 min na de import) | 1.316 gem. tijdens, max 1.580 (systeem) |
| Piek geheugen `verwerker` (MB, grens 4.096 + 2.048 swap) | 78 | **4.096**, inclusief de bestandscache van het model (zie §10) | **1.114** (werkgeheugen 755, cache 332) |
| Swap in gebruik, piek (MB) | 0 | **301** (verwerker); daarna 44 | **0** (verwerker); systeem 8, al aanwezig |
| CPU-piek systeem (%) | 13 (zonder back-up) | 37 (één meting); verwerker 287 % van 400 % | 96; verwerker 381 % van 400 % |
| Duur import, waarvan beeldclassificatie (s) | — | **127,9**, waarvan 117,4 | |
| Duur conceptgeneratie (s) | — | — | **36,2** (bouw 13,2, kwaliteit 22,0) |
| Database (`pg_database_size`) | 8,7 MB | 9,0 MB | 9,3 MB |
| Rijen bestand / gegeven / besluit / concept | 0 / 0 / 0 / 0 | 38 / 23 / 0 / 0 | 38 / 23 / 7 / 1 |
| Applicatieopslag (bestanden / MB) | 0 / 0 | 43 / 14,9 | ±75 MB totaal; concept v1: 531 bestanden, 46,6 MB |
| Fouten in de API- en verwerkerlog | 0 | 0 | 0 (één eerdere poging mislukte op RLS, hersteld in migratie 011) |
| Gezondheidscontrole | 100 % | 100 % (2 van 2 metingen) | 100 % |

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

## 10. Meting 1: brochure-import Markt 27 (9 november 2026)

**Bron:**
- de verwerkingsregistratie in de database (tijden per stap);
- de bestaande meting, elke 5 minuten;
- de cgroup-tellers van de containers (`memory.peak`, `memory.swap.peak`, `cpu.stat`): de hoogste waarden sinds
  de containerstart om 10:55:47 UTC, dus inclusief deze import;
- de nginx- en containerlogs.

Er is niets opnieuw geïmporteerd of gewijzigd.

**Invoer:**
- **brochure:** Markt 27, PDF van 5,2 MB (5.472.422 bytes), 12 pagina's;
- **project:** `rhadix-testmakelaars-markt-27`, kantoor Rhadix testmakelaars;
- **uitgevoerd** door de kantoorbeheerder via de online Productiestudio.

### 10.1 Tijdlijn (UTC)

| Moment | Gebeurtenis |
|---|---|
| 11:04:19 | Woningproject aangemaakt |
| 11:04:41 | PDF geüpload (201) |
| 11:05:19 | Import aangevraagd |
| 11:05:21 | Verwerking gestart (2,5 s in de wachtrij) |
| 11:07:29 | Verwerking klaar, zonder fout |

**Duur:**
- **totale verwerking: 127,9 s**;
- van upload tot resultaat: 2 min 48 s, inclusief de handelingen van de gebruiker.

### 10.2 Verwerkingstijd per stap

| Stap | Duur |
|---|---|
| Import (generator) | 7,35 s, waarvan PDF lezen 4,03 s en beelden 3,27 s; schrijven, structuur, teksten en gegevens samen < 0,1 s |
| Kwaliteitscontrole van de aanlevering | 0,40 s |
| **Beeldclassificatie (SigLIP, CPU)** | **117,4 s** (92 % van het totaal, ±3,1 s per beeld voor 37 beelden) |
| **Totaal** | **127,9 s** |

**Ter vergelijking**, de eerdere proef in arm64-containers (lokaal, 6 kernen): import 110,6 s, classificatie
106 s. Op de CPX32 met 4 vCPU duurt de classificatie dus ±11 % langer. Dat is minder dan het
verschil in kernen doet verwachten.

### 10.3 CPU en geheugen

| | Nulmeting (rust) | Tijdens of na de import |
|---|---|---|
| Systeem: CPU | gem. 0,3 %, max 13 % | 37 % in de enige meting tijdens de import (11:05:32, 11 s na de start). De verwerker gebruikte toen 287 % (2,9 van de 4 vCPU) |
| Verwerker: CPU-tijd | — | 376 s CPU-tijd sinds de start, vrijwel alles van deze import: **gemiddeld ±2,9 vCPU gedurende 128 s** |
| Systeem: geheugen in gebruik | gem. 839 MB, max 867 MB | 1.594 MB om 11:05:32. De echte piek viel tussen twee metingen in (zie hieronder) |
| Verwerker: geheugen | max 78 MB | **piek 4.096 MB = de grens**, plus **301 MB swap**. Na afloop 636 MB, grotendeels bestandscache |
| API: geheugen | max 89 MB | piek 117 MB |
| Database: geheugen | max 38 MB | piek 81 MB |
| Web: geheugen | 6 MB | 6 MB |
| Swap (systeem) | 0 MB | 44 MB na afloop |
| OOM of herstarts | — | **geen** (OOMKilled = false, 0 herstarts, geen OOM in de kernellog) |

**Toelichting op de geheugenpiek:**
- De cgroup-teller `memory.peak` telt ook de **bestandscache** mee. Daaronder valt het SigLIP-model van 3,3 GB,
  dat tijdens de classificatie wordt ingelezen. De kernel kan die cache terugwinnen. *(Aanvulling na §12: tijdens de
  classificatie is het model in gebruik en dus niet terug te winnen; het hoort dan bij de werkset.)*
- De verwerker zat dus op zijn grens van 4 GB. De kernel heeft cache vrijgemaakt, en daarnaast 301 MB
  werkgeheugen naar swap verplaatst. Dat laatste wijst op echte geheugendruk, al bleef die beperkt.
- De extra 2 GB swap (`memswap_limit` 6 GB) heeft een geheugenfout voorkomen.
- **Wat niet vastligt:** hoeveel van de 4 GB werkgeheugen was en hoeveel cache. Die verdeling (`anon`
  tegenover `file`) is alleen tijdens de verwerking te meten, en de meting om de 5 minuten viel niet op het
  piekmoment.
- **Systeembreed** was er op het piekmoment naar schatting nog ±2,5 GB vrij: de verwerker maximaal 4 GB,
  de overige containers ±0,2 GB, het OS ±0,6 GB.

### 10.4 Schijfgroei

| | Nulmeting | Na Markt 27 | Groei |
|---|---|---|---|
| Applicatieopslag | 0 bestanden, 0 MB | 43 bestanden, 14,9 MB | +14,9 MB |
| waarvan de bron-PDF | — | 1 bestand, 5,3 MB | |
| waarvan uitgepakte foto's | — | 34 bestanden, 4,3 MB | |
| waarvan plattegronden | — | 2 bestanden, 0,17 MB | |
| waarvan importrapport, logo en overige | — | 6 bestanden, ±5,1 MB (import/1, inclusief de tekst- en structuurbestanden) | |
| Datamap database | 48 MB | 48 MB | 0 (binnen de vooraf toegewezen ruimte) |

**Verhouding:** de opslag groeit met ±2,9× de PDF-omvang. Voor ±20 woningen van deze omvang is dat ±300 MB,
nog zonder concepten.

### 10.5 Database

| | Nulmeting | Na Markt 27 |
|---|---|---|
| `pg_database_size` | 8,7 MB | 9,0 MB (+0,3 MB) |
| project | 0 | 1 |
| bestand | 0 | 38: 1 brochure, 34 foto's, 2 plattegronden, 1 logo |
| gegeven | 0 | 23: 22 uit de brochure (overgenomen), 1 handmatig (projectformulier). De interface toonde er 19 als woningkenmerk |
| verwerking | 0 | 1 (klaar) |
| besluit, concept | 0 | 0 |

### 10.6 Fouten en vertragingen

- **Fouten:** geen, niet in de API- en verwerkerlog en niet in de kernellog. Alle verzoeken gaven 2xx.
- **Wachttijd:** 2,5 s, de interval van de verwerker.
- **Tijdens de verwerking** vroeg de interface ±88 keer de aanlevering en de beoordeling op (polling); alle
  verzoeken beantwoord.
- **Vertraging:** alleen de beeldclassificatie (117 s), en die is CPU-gebonden. De beperkte swap kan daar een
  paar procent aan hebben bijgedragen; dat is niet afzonderlijk te meten.

### 10.7 Eerste beoordeling van de capaciteit (CPX32, 8 GB)

1. **CPU:** voldoende. De import gebruikt de 4 vCPU twee minuten lang goed (±2,9 vCPU) en duurt maar ±11 %
   langer dan op 6 kernen. Eén import tegelijk (de wachtrij) is voor de pilot passend.
2. **Geheugen:** **voldoende, maar krap voor de verwerker.**
   - De verwerker raakte zijn grens van 4 GB en gebruikte 301 MB swap, zonder fout.
   - Systeembreed bleef er ruimte over: ±6,9 GB beschikbaar in rust, en de overige containers gebruiken samen
     < 0,3 GB.
   - Een grotere brochure (meer of grotere foto's) of de conceptgeneratie (Chromium, eerder ±2,7 GB) kan
     meer swap vragen en daardoor trager worden. Ruimte voor een tweede gelijktijdige verwerking is er niet,
     maar die komt door de wachtrij ook niet voor.
3. **Schijf:** ruim voldoende, met ±15 MB per woning bij 107 GB vrij.
4. **Advies voor de volgende stap:**
   - meet bij de conceptgeneratie en bij de volgende twee brochures tijdens de verwerking elke 2 s
     (`MP_MEETINTERVAL=2 /usr/local/sbin/meting.sh 150`, ook `memory.stat` van de verwerker), zodat werkgeheugen
     en cache te scheiden zijn;
   - beslis daarna of de grens van de verwerker naar ±5 GB moet (dat past op de CPX32, want de rest gebruikt
     < 1,5 GB) of dat de 4 GB volstaat;
   - opschalen naar een CPX42 is op basis van deze meting **niet** nodig.

## 11. Meting 2: conceptgeneratie Markt 27, v1 (9 november 2026)

**Bron:**
- de fijne meting (`meting-fijn.sh`, elke 2 s, per container uit de cgroups), geanalyseerd met `fijnmeting-rapport.py`;
- de verwerkingsregistratie (staptijden);
- de cgroup-piekwaarden van de verwerker sinds de herstart van 12:40 UTC;
- de nginx- en containerlogs.

Er is niets opnieuw gegenereerd of gewijzigd.

**Verwerking:**
- verwerking 6 (`conceptgeneratie`), gestart 12:43:58 UTC (13:43:58 Nederlandse tijd) door de kantoorbeheerder;
- klaar om 12:44:34 UTC, zonder fout;
- resultaat: **concept v1**, status *te beoordelen*, met 0 blokkerende punten en 17 waarschuwingen in het
  kwaliteitsrapport. Die waarschuwingen gelden voor publicatie.

**Eerdere poging:** verwerking 5, 12:29 UTC, mislukte na 34,5 s bij het vastleggen (RLS op `concept`; hersteld in
migratie 011). De gegenereerde bestanden van die poging zijn bij v1 overschreven met dezelfde invoer.

### 11.1 Tijd per stap

| Stap | Duur |
|---|---|
| Aanleveren (export) en woningmap | 0,6 s |
| Beeldclassificatie | 0,0 s (hergebruikt uit de import) |
| **Bouw** (`mp bouw`: automatische compositie, website) | **13,2 s** |
| **Kwaliteitscontrole** (`mp kwaliteit`: DS-3, Chromium) | **22,0 s** |
| **Totaal** | **36,2 s** |

**Ter vergelijking:** de lokale arm64-proef deed 28,1 s; de Mac (stap 6) 47,9 s.

### 11.2 CPU en geheugen (elke 2 s, 17 metingen)

| | Gemiddeld | Maximaal |
|---|---|---|
| Verwerker: CPU (100 % = 1 vCPU) | 125 % | **381 %** (bouw) |
| ‣ tijdens bouw (6 metingen) | 236 % | 381 % |
| ‣ tijdens kwaliteitscontrole (10 metingen) | 70 % | 154 % |
| Systeem: CPU (100 % = 4 vCPU) | 34 % | 96 % |
| Verwerker: geheugen | 741 MB | **1.114 MB** (werkgeheugen 755, cache 332) |
| ‣ tijdens bouw | 598 MB | 1.114 MB |
| ‣ tijdens kwaliteitscontrole | 862 MB | 916 MB |
| Verwerker: werkgeheugen (`anon`) | 467 MB | 755 MB |
| Verwerker: cgroup-piek sinds de herstart (`memory.peak`) | — | 1.137 MB |
| Systeem: geheugen in gebruik | 1.316 MB | 1.580 MB |
| Systeem: beschikbaar | 6.429 MB | minimum **6.166 MB** |
| API, database, web | max 86, 35 en 4 MB | CPU max 4, 7 en 0 % |

**Na afloop:** de verwerker viel binnen 2 s terug naar 388 MB, waarvan 63 MB werkgeheugen en 315 MB cache.

### 11.3 Swap

- **Verwerker:** 0 MB, gedurende de hele generatie. `memory.swap.peak` is 0 sinds de herstart.
- **Systeem:** 8 MB, en die waren er al vóór de generatie (de database had 7 MB uitgeswapt sinds 6-11). Er is geen
  nieuw swapgebruik.

### 11.4 Schijfgroei

| | Na de import (§10) | Na concept v1 | Groei |
|---|---|---|---|
| Applicatieopslag totaal | 14,9 MB | 75,4 MB | +60,5 MB |
| ‣ conceptmap `concepten/v1` | — | **46,6 MB, 531 bestanden** | +46,6 MB |
| — website (`site`) | — | 18,8 MB, 225 bestanden | |
| — woningmap (generatorinvoer, `woning`) | — | 23,1 MB, 258 bestanden | |
| — export (`aanlevering`) | — | 4,5 MB, 40 bestanden | |
| — rapporten en logboek | — | 0,1 MB | |
| ‣ kwaliteitscontroles van de aanlevering (`controle`, 3×) | — | ±14 MB | +14 MB (tussen de import en het concept) |
| Database | 9,0 MB | 9,3 MB | +0,3 MB |

**Per woning met één conceptversie:** ±75 MB, ofwel ±14× de PDF. Elke volgende conceptversie kost ±47 MB extra,
en elke kwaliteitscontrole ±5 MB.

### 11.5 Fouten, vertragingen en herstarts

- Geen fouten in de API- en verwerkerlog. Geen OOM: `OOMKilled = false` en niets in de kernellog.
- **Geen herstarts.** De containers draaien sinds de uitrol van `1ae95ae`, 12:40 UTC.
- De wachtrij pakte de aanvraag direct op.
- **Preview:** 39 verzoeken van de gebruiker beantwoord (200).
- **Preview zonder aanmelding** (gecontroleerd met de echte link): 404, ook met een vervalst preview- of
  Rhadix-cookie.

### 11.6 Vergelijking: nulmeting, import en concept

| | Nulmeting (rust) | Brochure-import (§10) | Conceptgeneratie |
|---|---|---|---|
| Duur | — | 127,9 s (classificatie 117,4) | 36,2 s (bouw 13,2, kwaliteit 22,0) |
| Verwerker: CPU | 0,2 % | gem. ±290 % | gem. 125 %, max 381 % |
| Verwerker: geheugen, piek | 78 MB | **4.096 MB** (grens; grotendeels modelcache) + 301 MB swap | **1.114 MB**, 0 swap |
| Systeem: beschikbaar, minimum | 6.877 MB | ±2,5 GB (schatting) | 6.166 MB |
| Schijfgroei | — | +14,9 MB | +60,5 MB (waarvan concept 46,6) |

### 11.7 Beoordeling van de capaciteit voor de twee overige brochures

1. **Conceptgeneratie past ruim.** Piek 1,1 GB van de 4 GB, geen swap, 6,2 GB vrij op de server.
2. **De brochure-import is het zwaarste moment.** Daar raakte de verwerker zijn grens, vooral door de
   bestandscache van het SigLIP-model (3,3 GB), plus 301 MB swap. Er was geen fout en de vertraging bleef beperkt.
3. **Schijf:** ±75 MB per woning met één concept. Voor twee woningen erbij ±150–300 MB, afhankelijk van de
   PDF-omvang en het aantal versies. Er is 107 GB vrij.
4. **CPU:** de import gebruikt ±2,9 vCPU, de bouw kort alle 4. Eén verwerking tegelijk (de wachtrij); de
   kwaliteitscontrole en de interface blijven bruikbaar.
5. **Conclusie:** de CPX32 is voldoende voor de twee overige brochures en hun concepten.

### 11.8 Advies: processorgrens van 4 GB

**Handhaven.** Twee redenen:
- de conceptgeneratie gebruikt maximaal 1,1 GB;
- bij de import bestond de piek grotendeels uit bestandscache, die de kernel terugwint. De 2 GB extra swap
  ving de rest op, zonder fout.

**Wat nog niet vastligt:** het werkgeheugen tijdens de **beeldclassificatie**. De import van Markt 27 viel vóór de
start van de fijne meting. Bij de volgende brochure meet de fijne meting automatisch de verdeling tussen werkgeheugen
en cache.

**Beslisregel na de tweede brochure:**
- **4 GB blijft** als het werkgeheugen tijdens de classificatie onder de ±3 GB blijft en de swap van de verwerker
  onder de ±0,5 GB en kortstondig;
- **anders naar 5 GB** (past op de CPX32: de overige containers gebruiken < 0,2 GB, het OS ±0,6 GB). Dat is een
  configuratiewijziging; alleen met akkoord.

## 12. Meting 3: brochure-import Landgoed Rhoderlanden (9 november 2026)

**Bron:**
- de fijne meting (elke 2 s, 75 metingen tijdens de import), via `fijnmeting-rapport.py`;
- de verwerkingsregistratie;
- de cgroup-tellers van de verwerker (`memory.peak`, `memory.swap.peak`, `memory.events`);
- de logs.

Er is niets opnieuw geïmporteerd of gewijzigd.

**Invoer:**
- **brochure:** Landgoed "Rhoderlanden", PDF van 8,7 MB (8.672.978 bytes), 50 pagina's (Canva, via Heyzine);
- **verwerking:** project `rhoderlanden`, verwerking 1, gestart 13:07:09 UTC, klaar 13:09:46 UTC, zonder fout.

### 12.1 Tijd per stap

| Stap | Rhoderlanden | Markt 27 |
|---|---|---|
| Import (generator) | 15,8 s (PDF lezen 8,7 s, beelden 7,1 s) | 7,4 s |
| Controle van de aanlevering | 0,7 s | 0,4 s |
| Beeldclassificatie | **137,5 s** voor 41 beelden (40 foto's en een logo), ±3,4 s per beeld | 117,4 s voor 37 beelden, ±3,2 s per beeld |
| **Totaal** | **156,7 s** | 127,9 s |

### 12.2 CPU (elke 2 s)

| | Gemiddeld | Maximaal |
|---|---|---|
| Verwerker, hele import (100 % = 1 vCPU) | 283 % | 326 % |
| ‣ import en controle (8 metingen) | 123 % | 141 % |
| ‣ beeldclassificatie (67 metingen) | 303 % | 326 % |
| Systeem (100 % = 4 vCPU) | 73 % | 83 % |
| API, database, web | max 3 %, 7 % en 0 % | |

### 12.3 Geheugen

| | Gemiddeld | Maximaal |
|---|---|---|
| Verwerker: totaal (grens 4.096 MB) | 3.393 MB | **4.095 MB** (de grens is 1.402 keer geraakt; `memory.events max`) |
| Verwerker: werkgeheugen (`anon`) | 697 MB | 1.118 MB |
| Verwerker: bestandscache (`file`, vooral het SigLIP-model) | — | 3.292 MB |
| Systeem: in gebruik | 1.606 MB | 2.094 MB |
| Systeem: beschikbaar | 6.139 MB | minimum **5.651 MB** |
| API, database, web | 124, 36 en 4 MB | |

**Na afloop:** de verwerker staat op 3.344 MB, waarvan 29 MB werkgeheugen en 3.298 MB cache. Die cache is
vrij te maken.

### 12.4 Swap

- **Verwerker:**
  - de swap begint 49 s na de start, aan het begin van de classificatie;
  - binnen ±15 s piek **509 MB**;
  - daarna ±500 MB, tot het einde van de classificatie: **±100 s aaneengesloten**;
  - na afloop nog 35 MB.
- **Systeem:** piek 526 MB, nu 52 MB.
- **Oorzaak:** tijdens de classificatie is het model in gebruik (±3,3 GB bestandspagina's). Samen met ±1 GB
  werkgeheugen is de werkset **±4,4 GB**, en dat is meer dan de grens van 4 GB. De kernel verplaatst daarom ±0,5 GB
  werkgeheugen naar swap.
- **Correctie op §10:** de modelcache is tijdens de classificatie dus géén vrij terug te winnen ruimte, maar
  feitelijk onderdeel van de werkset. Pas na afloop is hij vrij te maken.
- *Bijgesteld in §16.4: met een verse verwerker is de werkset ±2,6 GB; de 3,3 GB cache hier was grotendeels
  verouderde cache van eerdere verwerkingen.*

### 12.5 Opslag en database

| | Vóór (na Markt 27) | Na Rhoderlanden | Groei |
|---|---|---|---|
| Applicatieopslag totaal | 75,4 MB | 149,9 MB | **+74,5 MB** |
| ‣ bron-PDF | — | 8,5 MB | |
| ‣ import (46 bestanden: 40 foto's, 57,5 MB; logo 1,4 MB; rapport) | — | 66,0 MB | |
| Database | 9,3 MB | 9,4 MB | +0,1 MB |
| Rijen bestand / gegeven | 38 / 23 | 80 / 26 | +42 / +3 |

**Verhouding:**
- de uitgepakte foto's zijn **6,6× zo groot als de PDF**, tegenover 0,8× bij Markt 27;
- de beelden komen in hoge kwaliteit uit de Canva-PDF;
- reken voor een brochure als deze op ±75 MB per import en, bij één concept, naar verwachting ±150 MB per woning.

**Inhoudelijk** (geen capaciteitspunt): de import vond maar 3 gegevens in de tekst. De verkoopbrochure is vooral
beeld en sfeer. Dat komt terug bij de beoordeling.

### 12.6 Fouten, vertragingen en herstarts

- Geen fouten in de logs, geen OOM (`oom` en `oom_kill` = 0) en geen herstarts.
- **Vertraging door swap:** de classificatie per beeld is ±6 % langzamer dan bij Markt 27 (3,4 tegenover 3,2 s).
  Ook de grotere beelden spelen daarbij mee, dus de swap kost hooguit enkele procenten.

### 12.7 Vergelijking

| | Nulmeting | Markt 27-import | Markt 27-concept | Rhoderlanden-import |
|---|---|---|---|---|
| Duur | — | 127,9 s | 36,2 s | 156,7 s |
| Verwerker: CPU, gem. / max | 0,2 % | ±290 % | 125 / 381 % | 283 / 326 % |
| Verwerker: geheugen, max | 78 MB | 4.096 MB | 1.114 MB | 4.095 MB |
| Verwerker: werkgeheugen, max | — | onbekend (vóór de fijne meting) | 755 MB | 1.118 MB |
| Verwerker: swap, piek | 0 | 301 MB | 0 | **509 MB, ±100 s** |
| Systeem: beschikbaar, minimum | 6.877 MB | ±2,5 GB (schatting) | 6.166 MB | 5.651 MB |
| Opslag: groei | — | +14,9 MB | +60,5 MB | +74,5 MB |

### 12.8 Beoordeling: CPX32 en processorgrens

1. **CPX32 (8 GB):** voldoende.
   - Ook bij deze grotere brochure bleef er systeembreed ≥ 5,6 GB beschikbaar.
   - De CPU (gemiddeld 73 %) en de schijf (±150 MB per woning, 107 GB vrij) zijn geen knelpunt.
2. **Processorgrens van 4 GB:** werkbaar, maar aan de krappe kant.
   - Toetsing aan de beslisregel uit §11.8: het werkgeheugen (1,1 GB) blijft ruim onder de 3 GB, maar de swap
     (509 MB) ligt op de grens van 0,5 GB en duurde ±100 s. Dat is niet kortstondig.
   - De oorzaak is structureel: model plus werkgeheugen is ±4,4 GB bij elke import.
   - **Advies:** verhoog de grens naar **5 GB** (`MP_VERWERKER_GEHEUGEN=5g`, swapgrens 7g). Dat haalt de swap
     tijdens de classificatie weg. Het past op de CPX32: de overige containers gebruiken < 0,2 GB, het OS ±0,6 GB,
     en er blijft ±2 GB marge over.
   - Het is een configuratiewijziging (`.env` en `up -d` voor de verwerker), dus alleen met akkoord. De 4 GB is niet
     onveilig: zonder aanpassing gaat de pilot ook door, met enkele procenten vertraging en geen fouten.
3. **De conceptgeneratie** (§11) raakt dit niet: 1,1 GB. De verwerker maakt de modelcache die nu nog vastzit,
   vanzelf vrij zodra die ruimte nodig heeft.

## 13. Meting 4: conceptgeneratie Landgoed Rhoderlanden, v1 (9 november 2026)

**Bron:**
- de fijne meting (elke 2 s, 19 metingen), via `fijnmeting-rapport.py`;
- de verwerkingsregistratie;
- de cgroup-tellers;
- de logs.

Er is niets opnieuw gegenereerd of gewijzigd.

**Verwerking:**
- project `rhoderlanden`, verwerking 4, gestart 13:25:21 UTC (14:25 Nederlandse tijd), klaar 13:26:03 UTC, zonder fout;
- resultaat: **concept v1**, *te beoordelen*, met 0 blokkerende punten en 16 waarschuwingen (voor publicatie).

### 13.1 Tijd per stap

| Stap | Rhoderlanden | Markt 27 (§11) |
|---|---|---|
| Aanleveren (export) en woningmap | 1,3 s | 0,6 s |
| Bouw | **15,8 s** | 13,2 s |
| Kwaliteitscontrole (DS-3, Chromium) | **24,2 s** | 22,0 s |
| **Totaal** | **41,5 s** | 36,2 s |

### 13.2 CPU (elke 2 s)

| | Gemiddeld | Maximaal |
|---|---|---|
| Verwerker, totaal | 144 % | **379 %** |
| ‣ bouw (8 metingen) | 249 % | 379 % |
| ‣ kwaliteitscontrole (11 metingen) | 67 % | 171 % |
| Systeem (100 % = 4 vCPU) | 38 % | 96 % |
| API, database, web | max 2 %, 4 % en 0 % | |

### 13.3 Geheugen

| | Gemiddeld | Maximaal |
|---|---|---|
| Verwerker: werkgeheugen (`anon`) | 480 MB | **691 MB** |
| Verwerker: totaal, inclusief cache | 3.889 MB | 4.073 MB |
| Verwerker: bestandscache | — | 3.266–3.497 MB |
| Systeem: in gebruik | 1.435 MB | 1.620 MB |
| Systeem: beschikbaar | 6.311 MB | minimum **6.125 MB** |
| API | 323 MB | 324 MB (159 werkgeheugen, 155 cache, door de previewbestanden; was 86–124) |
| Database, web | 30 en 4 MB | 40 en 4 MB |

**Over de verwerker:**
- De hoge totaalwaarde is **cache die van de import was blijven staan**: het model en de beelden. Die is niet meer in
  gebruik.
- De kernel heeft die cache tijdens de generatie stap voor stap vrijgemaakt. De grens werd daarbij 358 keer geraakt
  (`memory.events max`, van 1.402 naar 1.760).
- Het werkgeheugen zelf (691 MB) blijft ver onder de grens.

### 13.4 Swap

- **Verwerker:** van 35 MB (restant van de import) naar **40 MB**, dus +5 MB, eenmalig in de bouwfase. Geen
  merkbare duur.
- **Systeem:** van 52 naar 56 MB.

### 13.5 Opslag en database

| | Na de import (§12) | Na concept v1 | Groei |
|---|---|---|---|
| Applicatieopslag totaal | 149,9 MB | **441,4 MB** | +291,5 MB |
| ‣ conceptmap `concepten/v1` | — | **175,1 MB, 591 bestanden** | +175,1 MB |
| — website (`site`) | — | 30,1 MB, 254 bestanden | |
| — woningmap (generatorinvoer) | — | 87,3 MB, 286 bestanden | |
| — export (`aanlevering`) | — | 57,5 MB, 44 bestanden | |
| ‣ kwaliteitscontroles van de aanlevering (`controle`) | — | 115,0 MB, 88 bestanden | +115,0 MB (vóór het concept) |
| Database | 9,4 MB | 9,5 MB | +0,1 MB |

**Per woning, alles bij elkaar:**

| | Markt 27 | Rhoderlanden |
|---|---|---|
| Bron, import, kwaliteitscontroles en één concept | ±75 MB | **±365 MB** |

**Wat dit vooral bepaalt:** de omvang van de foto's. Bij Rhoderlanden zijn ze 57,5 MB, en elke kwaliteitscontrole en
elke conceptversie bewaart er een eigen kopie van (export plus woningmap).

**Gevolg:** met 107 GB vrij is dit geen knelpunt (20 woningen ≈ 1,5–7,5 GB). Wel groeien ook de back-ups
mee; Object Storage biedt 1 TB.

### 13.6 Fouten, vertragingen en herstarts

- Geen fouten in de logs, geen OOM (`oom` en `oom_kill` = 0) en geen herstarts. De containers draaien sinds
  12:40 UTC.
- Er was geen vertraging door geheugen: de generatie duurde ±15 % langer dan bij Markt 27. Dat past bij de grotere
  beelden en de extra pagina's.

### 13.7 Vergelijking van alle metingen

| | Nulmeting | Markt 27-import | Markt 27-concept | Rhoderlanden-import | Rhoderlanden-concept |
|---|---|---|---|---|---|
| Duur | — | 127,9 s | 36,2 s | 156,7 s | **41,5 s** |
| Verwerker: CPU, gem. / max | 0,2 % | ±290 % | 125 / 381 % | 283 / 326 % | **144 / 379 %** |
| Verwerker: werkgeheugen, max | 78 MB (totaal) | onbekend | 755 MB | 1.118 MB | **691 MB** |
| Verwerker: totaal, max (inclusief cache) | 78 MB | 4.096 MB | 1.114 MB | 4.095 MB | 4.073 MB (cache van de import) |
| Verwerker: swap, piek | 0 | 301 MB | 0 | 509 MB, ±100 s | **40 MB (+5)** |
| Systeem: beschikbaar, minimum | 6.877 MB | ±2,5 GB (schatting) | 6.166 MB | 5.651 MB | **6.125 MB** |
| Opslag: groei | — | +14,9 MB | +60,5 MB | +74,5 MB | **+291,5 MB** (inclusief controles) |
| Fouten / herstarts | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | **0 / 0** |

## 14. Advies na vier metingen

**1. CPX32 (4 vCPU, 8 GB, 160 GB): handhaven voor de pilot.**
- **Geheugen:** systeembreed bleef in alle metingen ≥ 5,6 GB beschikbaar.
- **CPU:** de verwerker benut de 4 vCPU goed (classificatie ±3 vCPU, bouw kort 4). Eén verwerking tegelijk
  (de wachtrij) houdt de interface bruikbaar: de API bleef onder 3 % CPU.
- **Doorlooptijd:** een woning van brochure tot concept kost ±3–3,5 minuut machinetijd.
- **Schijf:** ±75–365 MB per woning. Dat is geen knelpunt.
- **Opschalen naar CPX42** is pas nodig bij productie en test tegelijk met zware verwerkingen, bij meerdere
  verwerkers parallel, of als de doorlooptijd van de classificatie een probleem wordt.

**2. Processorgrens: verhogen van 4 GB naar 5 GB** (`MP_VERWERKER_GEHEUGEN=5g`,
`MP_VERWERKER_GEHEUGEN_SWAP=7g`). Onderbouwing:
- *(Bijgesteld in §16.4: de werkset is ±2,6 GB plus opgebouwde cache; het advies voor 5 GB blijft staan.)*
- **De import is bepalend, niet de conceptgeneratie.** Tijdens de classificatie zijn het model (±3,3 GB in gebruik)
  en het werkgeheugen (tot ±1,1 GB) samen **±4,4 GB**. Dat is structureel meer dan 4 GB, dus bij elke import ±0,3–0,5 GB
  swap gedurende ±100 s. Dat bleek bij Markt 27 én bij Rhoderlanden.
- **De conceptgeneratie** gebruikt hooguit ±0,7 GB werkgeheugen en heeft de grens niet nodig.
- **Ruimte:**
  - het ergste geval met 5 GB is verwerker 5 GB, plus API, database en web ±0,4 GB, plus het OS ±0,6 GB =
    **±6,0 GB van 7,7 GB**;
  - de grootste gemeten systeembelasting is 2,1 GB in gebruik.
  - Er blijft dus marge, en de swap van 4 GB blijft als vangnet.
- **Effect:**
  - geen swap meer tijdens de classificatie;
  - een paar procent sneller;
  - minder schrijfbelasting op de SSD;
  - een grotere brochure (meer of grotere foto's) zit niet meteen tegen de grens.
- **Risico van 4 GB handhaven:** klein. Er zijn geen fouten; het gaat om enkele procenten vertraging. Bij een nog
  grotere brochure kan de swap wel verder oplopen.
- **Uitvoering (met akkoord):**
  - de twee regels in `/srv/makelaarsportaal-test/.env`, daarna `docker compose … up -d verwerker`;
  - bij een lopende verwerking wacht de verwerker tot die klaar is (`stop_grace_period` 3 min);
  - **controle:** bij de volgende import moet `memory.swap.peak` van de verwerker ±0 blijven.

## 15. Configuratiewijziging: processorgrens 4 GB naar 5 GB (9 november 2026, 13:33 UTC)

**Akkoord:** gebruiker, 9-11-2026. Alleen de testomgeving; productie bestaat nog niet. De CPX32 blijft.

| | Vóór | Na |
|---|---|---|
| `MP_VERWERKER_GEHEUGEN` (geheugengrens verwerker) | 4g (4.096 MiB) | **5g (5.120 MiB)** |
| `MP_VERWERKER_GEHEUGEN_SWAP` (geheugen + swap, verwerker) | 6g | 6g (ongewijzigd) |
| Swap die de verwerker daardoor maximaal kan gebruiken | 2.048 MiB | 1.024 MiB (gevolg van de ongewijzigde swapgrens) |
| CPU verwerker | 4 | 4 (ongewijzigd) |
| db / api / web | 768 MiB, 1 GiB, 128 MiB; 2, 2, 1 CPU | ongewijzigd, niet herstart |
| Host-swap (4 GB-bestand, swappiness 10) | — | ongewijzigd |

**Uitvoering:**
1. **Vooraf:** 0 lopende verwerkingen (10 afgerond); de verwerker was in rust (0,2 % CPU).
2. **`.env` bewaard** als `.env.voor-5g` (chmod 600). Alleen de regel `MP_VERWERKER_GEHEUGEN` aangepast (één regel in de diff).
3. **Herstart van alleen de verwerker:** `docker compose … up -d --no-deps verwerker` (13:33:40 UTC). Daarbij geen
   wijziging aan de image (`1ae95ae`) en geen migraties.

**Controle na de herstart:**
- **Limiet:** cgroup `memory.max` = 5.120 MiB en `memory.swap.max` = 1.024 MiB; `docker inspect` bevestigt het.
- **Overige containers:** db, api en web hebben dezelfde limieten en dezelfde starttijden, 0 herstarts.
- **Gezondheid:** `/api/gezond` lokaal 200 en via Cloudflare 200; de verwerker meldt "verwerker gestart".
- **Gegevens ongewijzigd:**
  - 2 projecten, 80 bestanden, 26 gegevens, 14 besluiten, 2 concepten, 2 gebruikers, 10 verwerkingen;
  - database 9,47 MB; opslag 441,4 MB.
- **Monitoring:**
  - de fijne meting (elke 2 s tijdens verwerkingen) draait door en vindt de nieuwe container vanzelf (binnen 30 s);
  - de 5-minutenmeting en de back-up-timer zijn actief.
- **Systeem:** 6,8 GB beschikbaar.

**Bij de derde capaciteitstest** (brochure-import):
- swap van de verwerker (`memory.swap.peak`) ±0;
- totaal geheugen onder 5.120 MiB;
- de classificatietijd per beeld vergelijken met 3,2 s (Markt 27) en 3,4 s (Rhoderlanden).

## 16. Meting 5: brochure-import Beusemkolkweg 16, met processorgrens 5 GB (9 november 2026)

**Bron:**
- de fijne meting (elke 2 s, 130 metingen tijdens de import), via `fijnmeting-rapport.py`;
- de verwerkingsregistratie;
- de cgroup-tellers van de verwerker sinds de herstart van 13:33:40 UTC, dus inclusief deze import;
- de logs.

Er is niets opnieuw geïmporteerd of gewijzigd.

**Invoer:**
- **brochure:** Beusemkolkweg 16, PDF van 17,4 MB (18.268.525 bytes), 60 pagina's;
- **verwerking:** project `beusemkolkweg 16`, verwerking 1, gestart 13:39:02 UTC, klaar 13:43:36 UTC, zonder fout;
- **geïmporteerd:** 80 foto's, 9 plattegronden en 1 logo; 18 gegevens uit de tekst.

### 16.1 Tijd per stap en per beeld

| | Markt 27 (4 GB) | Rhoderlanden (4 GB) | Beusemkolkweg 16 (5 GB) |
|---|---|---|---|
| PDF | 5,2 MB, 12 p. | 8,3 MB, 50 p. | 17,4 MB, 60 p. |
| Import (generator) | 7,4 s | 15,8 s | 20,8 s (PDF lezen 10,7 s, beelden 10,0 s) |
| Controle | 0,4 s | 0,7 s | 1,0 s |
| Beeldclassificatie | 117,4 s | 137,5 s | **249,5 s** |
| Geclassificeerde beelden | 37 (34 foto's, 2 plattegronden, 1 logo) | 41 (40 foto's, 1 logo) | 90 (80 foto's, 9 plattegronden, 1 logo) |
| **Per beeld** | 3,17 s | 3,35 s | **2,77 s** |
| Gemiddelde beeldgrootte (opslag) | ±131 kB | ±1,4 MB | ±170 kB |
| **Totaal** | 127,9 s | 156,7 s | **273,3 s** |

**Een zuivere vergelijking van de geheugengrenzen is niet mogelijk.** De drie imports verschillen in drie opzichten:
- **brochure en beelden:** het aantal, de pixelmaat en de compressie. Rhoderlanden heeft ±8× grotere beelden; het
  decoderen kost tijd, de classificatie zelf werkt op een vaste invoermaat;
- **het soort beeld:** plattegronden en logo's zijn eenvoudiger;
- **de staat van de verwerker:** Beusemkolkweg startte met een **verse container**, met een lege cache na de herstart
  voor de 5 GB-grens. Rhoderlanden draaide in een container met cache van eerdere verwerkingen.

**Lezing:**
- de lagere tijd per beeld (2,77 s) past bij geen swap (zie §16.3) en kleinere beelden;
- hoeveel elk van beide bijdraagt, is met deze drie metingen niet te scheiden.

### 16.2 CPU (elke 2 s)

| | Gemiddeld | Maximaal |
|---|---|---|
| Verwerker, hele import (100 % = 1 vCPU) | 299 % | 328 % |
| ‣ import en controle (10 metingen) | 138 % | 179 % |
| ‣ beeldclassificatie (120 metingen) | 312 % | 328 % |
| Systeem (100 % = 4 vCPU) | 77 % | 87 % |
| API, database, web | max 4 %, 5 % en 0 % | |

### 16.3 Geheugen en swap

| | Gemiddeld | Maximaal |
|---|---|---|
| Verwerker: totaal (grens **5.120 MiB**) | 2.189 MB | **2.599 MB** (fijne meting); cgroup-piek `memory.peak` 2.672 MB |
| Verwerker: werkgeheugen (`anon`) | 1.161 MB | 1.385 MB |
| Verwerker: bestandscache (model en beelden) | 999 MB | 1.182 MB |
| Verwerker: grens geraakt (`memory.events max`) | — | **0 keer** |
| **Verwerker: swap** | 0 | **0 MB** (`memory.swap.peak` = 0) |
| Systeem: in gebruik | 2.183 MB | 2.444 MB |
| **Systeem: beschikbaar tijdens de piek** | 5.562 MB | minimum **5.302 MB** |
| Systeem: swap | 16 MB | 16 MB (al aanwezig) |
| API | 350 MB | 360 MB (stabiel; hoger dan eerder door de bekeken previews) |
| Database, web | 32 en 4 MB | 40 en 4 MB |

**Na afloop:** de verwerker op 1.252 MB, waarvan 60 MB werkgeheugen en 1.182 MB cache.

### 16.4 Correctie op §12.4 en §14: de werkset van de classificatie

- **Wat deze meting laat zien:** met een verse verwerker is de werkset tijdens de classificatie **±2,6 GB**:
  ±1,4 GB werkgeheugen plus ±1,2 GB bestandscache van het model. En dat bij de zwaarste brochure (90 beelden).
- **Wat in §12.4 werd aangenomen:** ±4,4 GB, met het model (3,3 GB) volledig als werkset. Dat was **te hoog**.
  - De 3,3 GB cache bij Rhoderlanden bestond grotendeels uit verouderde cache van eerdere verwerkingen in dezelfde
    container, plus de grote beelden.
  - De kernel kon die niet snel genoeg vrijmaken binnen de grens van 4 GB, en verplaatste daarom werkgeheugen naar
    swap.
- **Gevolg:**
  - de 5 GB-grens is ruim voldoende;
  - de swap onder 4 GB kwam vooral door de combinatie met opgebouwde cache.
  - De verhoging naar 5 GB blijft zinvol: ze geeft ruimte voor die cache, zodat er niet hoeft te worden uitgeswapt,
    en marge voor grotere brochures.

### 16.5 Opslag en database

| | Vóór | Na Beusemkolkweg-import | Groei |
|---|---|---|---|
| Applicatieopslag totaal | 441,4 MB | 507,2 MB | **+65,9 MB** |
| ‣ bron-PDF | — | 17,8 MB | |
| ‣ import (95 bestanden: 80 foto's 14,4 MB, 9 plattegronden 1,0 MB, logo, rapport) | — | 33,0 MB | |
| ‣ kwaliteitscontrole van de aanlevering (1×, 93 bestanden) | — | 15,1 MB | |
| Database | 9,47 MB | 9,62 MB | **+0,15 MB** |
| Rijen bestand / gegeven | 80 / 26 | 171 / 44 | +91 / +18 |
| Schijf (totaal, inclusief buildbestanden) | 27–36 % | 36 % | geen structurele groei; de stijging sinds §6 komt van builds op de server |

### 16.6 Fouten, vertragingen en herstarts

- Geen fouten in de logs, geen OOM (`oom` en `oom_kill` = 0) en geen herstarts. De verwerker draait sinds de
  grenswijziging van 13:33:40 UTC; db, api en web zijn niet herstart.
- Geen vertraging door geheugen: de grens werd niet geraakt en er was geen swap.

### 16.7 Beoordeling

1. **De 5 GB-grens was bij deze zwaardere brochure ruim voldoende.** Piek 2,6–2,7 GB (±52 % van de grens), geen
   swap, de grens niet geraakt.
2. **De server** hield tijdens de piek ±5,3 GB beschikbaar. De CPX32 is voor deze verwerking ruim voldoende.
3. **De beeldclassificatie** blijft CPU-gebonden (±3,1 vCPU) en schaalt met het aantal beelden: ±2,8–3,4 s per
   beeld, bij 90 beelden ±4 minuten.
4. **De conceptgeneratie van Beusemkolkweg 16 kan starten.**
   - Er lopen geen verwerkingen en de verwerker is in rust.
   - De generatie vroeg eerder hooguit ±0,7 GB werkgeheugen (§11, §13).
   - De fijne meting staat aan.
