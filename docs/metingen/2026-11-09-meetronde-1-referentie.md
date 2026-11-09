# Meetronde 1: referentie (Rhadix Makelaarsportaal, testomgeving)

Vastgelegd op 9 november 2026, 14:00 UTC, als vast vergelijkingspunt voor meetronde 2.

**Bronnen:**
- het uitgebreide verslag `2026-11-09-nulmeting.md` (§1–§16);
- de ruwe meetgegevens in `meetronde-1/`.

Niets in deze map wordt later aangepast; meetronde 2 krijgt een eigen bestand.

| Bestand in `meetronde-1/` | Inhoud |
|---|---|
| `systeem.csv` | 5-minutenmeting van het systeem, 6-11 12:13 tot 9-11 13:55 UTC |
| `containers.csv` | 5-minutenmeting per container, dezelfde periode |
| `fijn.csv` | fijne meting, elke 2 s tijdens verwerkingen, vanaf 9-11 12:11 UTC |
| `verwerkingen.csv` | alle 13 verwerkingen: soort, status, tijden, staptijden, fout (geen inhoud) |
| `configuratie.txt` | server, versies, grenzen per container (zonder geheimen) |

## 1. Configuratie

- **Server:** Hetzner CPX32 met 4 vCPU (AMD EPYC-Genoa), 7.745 MiB RAM, 4 GB swap (`swappiness` 10) en 160 GB SSD.
- **Software:** Ubuntu 24.04 en kernel 6.8.0-138. Tijdens de ronde kwamen automatische beveiligingsupdates binnen:
  24.04.4 werd 24.04.5, de kernel bleef gelijk.
- **Applicatie:**
  - versie `080ba65` (nulmeting) en `6183855`, `cca63f7` en `1ae95ae` (imports en concepten; functioneel gelijk
    voor de meting);
  - de generator op de vaste commit `4eb7f2c`.
- **Grenzen:**

  | Container | Geheugen | CPU |
  |---|---|---|
  | db | 768 MiB | 2 |
  | api | 1 GiB | 2 |
  | web | 128 MiB | 1 |
  | verwerker | **4 GiB** (geheugen + swap 6 GiB) tot 13:33:40 UTC, daarna **5 GiB** (geheugen + swap 6 GiB) | 4 |

- **Wijziging tijdens de ronde:** de verwerker ging van 4 naar 5 GiB, na de imports en concepten van Markt 27 en
  Rhoderlanden en vóór Beusemkolkweg 16. Alleen de verwerker is daarbij herstart.
- **Monitoring:** de 5-minutenmeting liep de hele ronde. De fijne meting liep vanaf 12:11 UTC; daardoor heeft de
  Markt 27-import géén fijne meting.

## 2. Resultaten

### 2.1 Nulmeting

| | Waarde |
|---|---|
| Periode | 6-11 14:00 tot 9-11 08:00 UTC: 66 uur, 792 metingen, 0 onderbrekingen |
| CPU | gem. 0,3 %; max 13 % (33 % tijdens de back-up) |
| RAM | gebruikt gem. 839 MB, max 867 MB; beschikbaar min 6.877 MB |
| Swap | 0 |
| Containers | db 38, api 89, verwerker 78, web 6 MB |
| Database, opslag | 8,7 MB; 0 bestanden |

### 2.2 Brochure-imports

| | Markt 27 | Rhoderlanden | Beusemkolkweg 16 |
|---|---|---|---|
| PDF | 5,2 MB, 12 p. | 8,3 MB, 50 p. | 17,4 MB, 60 p. |
| Verwerkergrens | 4 GiB | 4 GiB | **5 GiB** |
| Toestand van de verwerker bij de start | cache van eerder werk | cache van Markt 27 (concept) | **vers** (herstart 13:33) |
| Fijne meting | nee (alleen cgroup-pieken) | ja (75 metingen) | ja (130 metingen) |
| Import en controle | 7,8 s | 16,6 s | 21,7 s |
| Beeldclassificatie | 117,4 s / 37 beelden | 137,5 s / 41 beelden | 249,5 s / 90 beelden |
| **Per beeld** | 3,17 s | 3,35 s | **2,77 s** |
| **Totaal** | 127,9 s | 156,7 s | 273,3 s |
| Verwerker: CPU, gem. / max | ±290 % (cgroup) | 283 / 326 % | 299 / 328 % |
| Verwerker: totaal geheugen, max | 4.096 MB (grens) | 4.095 MB (grens, 1.402× geraakt) | **2.599 MB** (cgroup 2.672; grens 0× geraakt) |
| Verwerker: werkgeheugen, max | onbekend | 1.118 MB | 1.385 MB |
| Verwerker: swap, piek | 301 MB | 509 MB, ±100 s | **0** |
| Systeem: beschikbaar, min | ±2,5 GB (schatting) | 5.651 MB | 5.302 MB |
| Opslaggroei | +14,9 MB | +74,5 MB | +65,9 MB (incl. 1 controle) |
| Fouten / OOM / herstarts | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |

### 2.3 Conceptgeneraties

| | Markt 27 (v1) | Rhoderlanden (v1) | Beusemkolkweg 16 (v1) |
|---|---|---|---|
| Verwerkergrens | 4 GiB | 4 GiB | 5 GiB |
| Bouw / kwaliteitscontrole | 13,2 / 22,0 s | 15,8 / 24,2 s | 21,7 / 25,7 s |
| **Totaal** | 36,2 s | 41,5 s | 48,7 s |
| Verwerker: CPU, gem. / max | 125 / 381 % | 144 / 379 % | 175 / 382 % |
| Verwerker: werkgeheugen, max | 755 MB | 691 MB | 778 MB |
| Verwerker: totaal, max | 1.114 MB | 4.073 MB (oude cache van de import) | 2.296 MB |
| Verwerker: swap | 0 | +5 MB | 0 |
| Systeem: beschikbaar, min | 6.166 MB | 6.125 MB | 5.906 MB |
| Conceptmap | 46,6 MB | 175,1 MB | 136,3 MB |
| Kwaliteitsrapport (blokkerend / waarschuwingen) | 0 / 17 | 0 / 16 | 0 / 23 |
| Fouten / OOM / herstarts | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |

**Opslag per woning, totaal** (bron, import, controles en één concept): Markt 27 ±75 MB, Rhoderlanden ±365 MB,
Beusemkolkweg 16 ±202 MB. **Opslag aan het einde van de ronde:** 644,5 MB (2.963 bestanden); database 9,62 MB.

## 3. Bijzonderheden en fouten

1. **Mislukte conceptpoging, Markt 27** (verwerking 5, 12:29 UTC):
   - `new row violates row-level security policy for table "concept"`;
   - oorzaak: migratie 010 had drie regels laten staan; hersteld in migratie 011;
   - de opnieuw gestarte generatie (verwerking 6) slaagde.
2. **Swap onder 4 GiB:** bij beide imports raakte de verwerker de grens en ontstond 301 en 509 MB swap. Er waren
   geen fouten.
   - De eerste interpretatie (een werkset van ±4,4 GB) is in §16.4 bijgesteld: met een verse verwerker is de werkset
     ±2,6 GB.
   - De swap ontstond door de combinatie met opgebouwde cache.
3. **De 5-minutenmeting** ving de piek van de eerste import niet. Daarom is vanaf 12:11 UTC de fijne meting toegevoegd.
4. **Ontbrekende fijne meting:** voor de Markt 27-import is geen werkgeheugen per fase bekend.
5. **Rhoderlanden:** de import vond maar 3 gegevens in de tekst (beeldbrochure). Dat is een inhoudelijk punt, geen
   capaciteitspunt.

## 4. Beperkingen voor de vergelijking met ronde 2

- **Cache:**
  - in ronde 1 verschilde de toestand van de verwerker per meting (vers of met opgebouwde cache);
  - bij de start van ronde 2 staat het model al in de paginacache van de server (systeem ±5,1 GB cache, verwerker
    ±1,4 GB). Het model hoeft dan niet opnieuw van schijf te komen.
- **Grens:** de eerste twee imports draaiden onder 4 GiB, de derde onder 5 GiB. Ronde 2 draait volledig onder 5 GiB.
- **Gelijktijdige processen:** de meting telt alles op de server mee.
  - In ronde 1 liepen tijdens de verwerkingen geen back-up of builds.
  - Wel bekeek de gebruiker previews: de API ging naar ±360 MB.
- **Inhoud:** dezelfde drie brochures, dus vergelijkbaar. De uitkomst van de import (gegevens, beelden) kan door een
  nieuwe aanlevering iets verschillen.

## 5. Voorbereiding meetronde 2 (9 november 2026, 14:00 UTC)

### 5.1 Back-up (herstelbaar, gecontroleerd)

- **Snapshot:** restic **`67535ef2`** (13:59:18 UTC), versleuteld naar Hetzner Object Storage, met database-dump,
  volledige opslag en tellingen.
- **Hersteltest (13:59:44 UTC):** geslaagd.
  - Alle 2.963 bestanden teruggezet, met gelijke checksums.
  - De database teruggezet in een tijdelijke container zonder netwerk. De tellingen zijn gelijk: kantoor 1, project 3,
    bestand 171, gegeven 44, besluit 20, concept 3, verwerking 13, gebruiker 2.
  - Daarna opgeruimd.

### 5.2 Wat bij akkoord verwijderd zou worden (alleen de drie testwoningprojecten)

| Project | ID | Kantoor |
|---|---|---|
| markt 27 | `0a2b4161-4e5a-466e-97bb-8c1dc6098519` | Rhadix testmakelaars |
| rhoderlanden | `6ba6df29-8901-4b39-b34b-8fc8f800f47f` | Rhadix testmakelaars |
| beusemkolkweg 16 | `27b7cdef-a85e-44ef-9ef3-e31257225b12` | Rhadix testmakelaars |

**Proefverwijdering** in een transactie die is teruggedraaid (`ROLLBACK`; er is niets verwijderd):

| Tabel | Nu | Na verwijderen | Verwijderd |
|---|---|---|---|
| project | 3 | 0 | 3 |
| bestand | 171 | 0 | 171 |
| verwerking | 13 | 0 | 13 |
| gegeven | 44 | 0 | 44 |
| aanlevering | 3 | 0 | 3 |
| besluit | 20 | 0 | 20 |
| concept | 3 | 0 | 3 |
| activiteit | 37 | 0 | 37 |
| **kantoor** | 1 | 1 | **0** |
| **gebruiker** | 2 | 2 | **0** |
| **lidmaatschap** | 1 | 1 | **0** |
| **rhadix_organisatie** | 2 | 2 | **0** |
| **auditregel** | 48 | 48 | **0** (de geschiedenis blijft; de verwijdering zelf wordt er een nieuwe regel) |

**Opslag:**

| Map | Inhoud |
|---|---|
| `opslag/projecten/0a2b4161-…` (Markt 27) | 694 bestanden, 75,4 MB |
| `opslag/projecten/6ba6df29-…` (Rhoderlanden) | 726 bestanden, 364,6 MB |
| `opslag/projecten/27b7cdef-…` (Beusemkolkweg 16) | 1.466 bestanden, 202,2 MB |
| `opslag/miniaturen/` | 77 miniaturen, 2,3 MB. Alle 77 horen (op sha256) bij bestanden van deze drie projecten |

**Totaal:** 2.963 bestanden, ±644 MB.

**Blijft ongemoeid:**
- het kantoor Rhadix testmakelaars en zijn koppeling met de Rhadix-organisatie;
- de huisstijl: het kantoor heeft geen logo of kleuren die naar een projectbestand verwijzen (`logo_id` is leeg);
- de gebruikers, lidmaatschappen, sessies en het auditlog;
- de Rhadix-organisaties, licenties en applicaties in Datavalidatie staging. Daar komt niets aan;
- de meetgegevens (`/var/log/makelaarsportaal`) en de back-ups;
- productie (bestaat niet) en de andere Rhadix-applicaties.

**Werkwijze bij akkoord:**
1. Eén transactie: `DELETE FROM project WHERE id IN (de drie ID's)`. Alle afhankelijke gegevens volgen via
   `ON DELETE CASCADE`. De verwijdering wordt een auditregel.
2. Pas na een geslaagde commit de drie projectmappen en de 77 bijbehorende miniaturen verwijderen.
3. Daarna tellingen en opslag controleren.

**Terugzetten** kan uit snapshot `67535ef2`.

### 5.3 Toestand van de meetomgeving bij de start

| | Waarde |
|---|---|
| Uptime server | 3 dagen 1:51 (geen herstart sinds 6-11) |
| Containers | db en api *healthy*; verwerker en web *running*; 0 herstarts |
| Verwerker | grens `memory.max` **5.120 MiB**; swapgrens 1.024 MiB; nu 1.491 MiB (65 werkgeheugen, 1.406 cache); swap 0; grens 0× geraakt; 0 OOM |
| Systeem | gebruikt 999 MB, beschikbaar 6.746 MB, paginacache ±5,1 GB, swap 14 MB; geheugendruk (PSI) 0,00 |
| CPU | load 0,18; CPU-druk (PSI) avg10 0,54 %; geen zware processen (hoogste: systemd 3,6 %) |
| Schijf | 52 GB van 150 GB (36 %). Daarvan tijdelijk: buildcache 27,3 GB en oude images 18,0 GB |
| Lopende verwerkingen | 0 |
| Monitoring | fijne meting actief (elke 2 s bij verwerker-CPU ≥ 10 %); 5-minutenmeting actief |
| Achtergrondtaken | sysstat elke 10 min (licht). Vandaag niets anders zwaars; back-up om 02:30 UTC; apt-daily om 02:38 en 06:19 UTC; hersteltest zondag 04:30 UTC |
| Bewust niet gedaan | geen cache-opruiming en geen herstart |

## 6. Testprotocol meetronde 2

**Per woning, in deze volgorde:** Markt 27, dan Landgoed Rhoderlanden, dan Beusemkolkweg 16. Pas door naar de volgende
als de vorige verwerking op *klaar* staat.

| Stap | Wie | Wat wordt vastgelegd |
|---|---|---|
| 1. Project aanmaken en PDF uploaden | gebruiker | uploadmoment (nginx-log) |
| 2. Brochure-import en beeldclassificatie | gebruiker start; de verwerker voert uit | duur per stap; CPU, werkgeheugen, cache en swap per container (elke 2 s); systeem beschikbaar en swap; opslag- en databasegroei; fouten, OOM, herstarts |
| 3. Meting vastleggen | Claude | `fijnmeting-rapport.py`, cgroup-tellers, tellingen |
| 4. Vrijgave voor intern concept (snelle beoordeling) | gebruiker | — |
| 5. Concept genereren | gebruiker | als stap 2 |
| 6. Meting vastleggen | Claude | als stap 3 |

**Afspraken tijdens de ronde:**
- geen wijzigingen aan code of configuratie;
- geen builds of uitrollen op de server;
- geen handmatige back-ups;
- de dagelijkse back-up om 02:30 UTC valt buiten de testtijd.

## 7. Uitgevoerde verwijdering (9 november 2026, ±14:10 UTC, met akkoord van de gebruiker)

- **Vooraf:** 0 lopende verwerkingen; precies de drie projecten uit §5.2, en geen bestanden van andere projecten.
- **Database:** één transactie, met een controle dat de stand gelijk was aan de proefverwijdering (anders niets).
  Daarin drie auditregels "verwijderd (meetronde 1, …; back-up restic 67535ef2)" en de `DELETE` van de drie projecten.
  - Resultaat: project, bestand, verwerking, gegeven, aanlevering, besluit, concept en activiteit staan alle op 0.
- **Opslag:** de drie projectmappen (694 + 726 + 1.466 = 2.886 bestanden) en de 77 bijbehorende miniaturen
  (geselecteerd op sha256) zijn verwijderd. De opslag is daarna leeg.
- **Ongewijzigd:**
  - het kantoor Rhadix testmakelaars (zelfde ID, koppeling met Rhadix-organisatie `8f17e82b-…`, status actief,
    geen huisstijl);
  - de gebruikers *admin* (platformbeheer) en *rene makelaar* (kantoorbeheerder van Rhadix testmakelaars);
  - de Rhadix-organisaties (2) en de 48 bestaande auditregels;
  - de serverconfiguratie: `.env` gelijk aan de stand na de 5 GB-wijziging; containers niet herstart; grenzen gelijk;
  - de meetbestanden op de server en in deze map;
  - de back-up `67535ef2`.
- **Na afloop:**
  - `/api/gezond` gaf 200, lokaal en via Cloudflare;
  - db en api *healthy*;
  - de fijne meting, de 5-minutenmeting, de back-up en de hersteltest zijn actief.
