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
| Geheugen in gebruik, rust (MB) | 839 | 833 (5 min na de import) | |
| Piek geheugen `verwerker` (MB, grens 4.096 + 2.048 swap) | 78 | **4.096**, inclusief de bestandscache van het model (zie §10) | |
| Swap in gebruik, piek (MB) | 0 | **301** (verwerker); daarna 44 | |
| CPU-piek systeem (%) | 13 (zonder back-up) | 37 (één meting); verwerker 287 % van 400 % | |
| Duur import, waarvan beeldclassificatie (s) | — | **127,9**, waarvan 117,4 | |
| Duur conceptgeneratie (s) | — | | |
| Database (`pg_database_size`) | 8,7 MB | 9,0 MB | |
| Rijen bestand / gegeven / besluit / concept | 0 / 0 / 0 / 0 | 38 / 23 / 0 / 0 | |
| Applicatieopslag (bestanden / MB) | 0 / 0 | 43 / 14,9 | |
| Fouten in de API- en verwerkerlog | 0 | 0 | |
| Gezondheidscontrole | 100 % | 100 % (2 van 2 metingen) | |

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
  dat tijdens de classificatie wordt ingelezen. De kernel kan die cache terugwinnen.
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
