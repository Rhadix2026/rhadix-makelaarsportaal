# Ontwikkellog

Gemeten uitvoering per stap, als basis voor latere inschattingen (stappenplan §11.6).

- **Doorlooptijd:** de wandkloktijd van het akkoord tot de oplevering, inclusief downloads.
- **Wachttijd** op een beoordeling telt niet mee.

## Stap 1: statuspagina (05-11-2026)

| Meting | Waarde |
|---|---|
| Start (akkoord ontvangen) | 2026-11-05 12:34:57 UTC |
| Oplevering | 2026-11-05 ±12:45 UTC |
| Doorlooptijd | ±10 min |
| Iteraties | 1 herstelronde: op mobiel liep de pagina horizontaal over (een lang pad in de tabel) en op desktop stond de knop onder de titel. Gevonden met een schermafdruk, opgelost in de CSS |
| Tests | 5 nieuw (alle groen); typecheck schoon; build in 0,3 s; 81 generatortests groen in de productie-instantie |
| Externe afhankelijkheden | npm-pakketten (12, exacte versies, minstens 2 weken oud); het `postgres:16-alpine`-image (21-10-2026, vastgezet op digest) |
| Lokaal gekopieerd (geen download) | Chromium (572 MB) en de SigLIP-omgeving (venv 501 MB, model 3,3 GB) als APFS-kloon; Oxanium-fonts (OFL) uit de Rhadix-frontend, alleen gelezen |

## Stap 2: inloggen en makelaarskantoren (05-11-2026)

| Meting | Waarde |
|---|---|
| Start (akkoord ontvangen) | 2026-11-05 13:31:39 UTC |
| Oplevering | 2026-11-05 ±13:42 UTC |
| Doorlooptijd | ±11 min |
| Iteraties | 2 herstelrondes. (1) **Testisolatie:** de eerste testrun schreef naar de lokale hoofddatabase `studio` in plaats van `studio_test`, omdat de configuratie vóór de testinstelling werd geladen. Opgelost met een preload (`--import ./tests/omgeving.ts`) en een harde controle op de databasenaam in `tests/hulp.ts`. De testrijen (5 testgebruikers, 3 testkantoren, sessies) zijn verwijderd; de hoofddatabase bevatte verder niets. (2) **Opmaak:** een uitgerekt formulierveld, de mobiele navigatie die over de rand liep, en een overbodig streepje in de contactkolom. Gevonden met schermafdrukken |
| Tests | 37 (5 status, 11 authenticatie, 13 gegevensscheiding (API + RLS), 8 kantoren), alle groen; typecheck schoon; build in 0,06 s |
| Visuele controle | Een tijdelijke demo-instantie (database `studio_demo`, poorten 5481/8481, alleen `.invalid`-gegevens) met Chromium doorlopen: inloggen, een fout wachtwoord, de lijst, een nieuw kantoor met invoerfouten, detail, systeem, uitloggen, de makelaarsweergave en mobiel (390 px, geen horizontaal scrollen). 0 consolefouten. Daarna verwijderd |
| Externe afhankelijkheden | Geen nieuwe |

## Stap 3: dashboard en woningprojecten (05-11-2026)

| Meting | Waarde |
|---|---|
| Start (akkoord ontvangen) | 2026-11-05 14:52:02 UTC |
| Oplevering | 2026-11-05 15:00 UTC |
| Iteraties | 3 opmaakrondes, gevonden met schermafdrukken en een automatische labelcontrole op 390, 768, 1024 en 1440 px. (1) De navigatie liep op mobiel 15 px over de rand en de gebruikersnaam brak af bij 1024 px. (2) **Labels braken midden in een woord** (verbeterpunt 1), door `overflow-wrap: anywhere`. Opgelost: labels breken niet meer; op smalle schermen staat het label boven de waarde. (3) Een dubbele rand door de cascadevolgorde. Geen functionele fouten: de tests slaagden in één keer |
| Tests | 57 (+20): woningprojecten 15, borging en regressie 6; de bestaande 36 aangepast op merknaam en juridische naam. Daarnaast 81 generatortests groen in de productie-instantie |
| Migratie | `003_woningprojecten.sql` op de echte studio-database: de kantoornaam wordt merknaam (gecontroleerd: gegevens behouden) |
| Verbeterpunten stap 2 | 1 labels: opgelost. 2 merknaam en juridische naam: opgelost. 3 alleen geldige profielen: keuze met omschrijving uit de generator, en een melding bij een ongeldige opgeslagen waarde. 4 logo en huisstijl: gepland bij stap 4 (uploads). 5 kantoor als standaard: opgelost en getest. 6 alleen een testdatabase: drievoudig geborgd en getest |

## Stap 4: aanlevering, brochure-import en kantoorhuisstijl (05-11-2026)

| Meting | Waarde |
|---|---|
| Start (akkoord ontvangen) | 2026-11-05 16:00:22 UTC |
| Oplevering | 2026-11-05 ±16:30 UTC |
| Doorlooptijd | ±30 min |
| Iteraties | 3 rondes. (1) Mijn shell gebruikte Node 20 (de nvm-standaard). pdfjs vraagt Node ≥ 22, dus de importtest faalde; alle tests en de verwerking draaien nu op Node 24, zoals `.nvmrc` voorschrijft. (2) Een testbeeld werd terecht als dubbel herkend (gelijke compositie); de test is aangepast. (3) Opmaak en gebruik: dubbele React-sleutels in de meldingen, en een knop "overgenomen gegevens zonder melding goedkeuren", omdat 22 losse klikken onwerkbaar bleken |
| Tests | 63 (+6 aanlevering: upload, dubbelen, woningtype, Markt 27-import veld voor veld gelijk aan de generator met bescherming, opslaan en RLS, huisstijl). Daarnaast 81 generatortests groen en de productie-instantie ongewijzigd |
| Migratie | `004_aanlevering.sql` op de echte studio-database. Daarvóór een back-up in `data/backups/` (niet in git) |

### Praktijktest Markt 27 Wolvega (Linde Makelaars)

Uitgevoerd in een tijdelijke demo-omgeving (`studio_demo`, 5481/8481), met de originele brochure
(5,2 MB, 36 pagina's) en de beeldclassificatie aan. Daarna verwijderd.

| Meting | Waarde |
|---|---|
| Project aanmaken (alleen kantoor en naam) tot gecontroleerde import | 30,3 s |
| Verwerking | 29,7 s: import 2,4 s (PDF lezen 1,7 s, beelden 0,7 s), generatorcontrole 0,1 s, beeldclassificatie 26,7 s (inclusief het laden van het model) |
| Upload brochure | 0,02 s (lokaal) |
| Gevonden | 34 foto's, 2 plattegronden, logo, 18 kenmerken, adres, postcode, plaats, woningtype (maisonnette), disclaimer. 22 gegevens automatisch aangevuld; vraagprijs herkend en bewust niet bewaard; 21 onderdelen uitgesloten van publicatie |
| Classificatie | 34 foto's, waarvan 3 ter controle (vraagteken). Een tweede indeling na 2 extra foto's: 16,7 s |
| Correcties van waarden | **0**: alle 22 waarden zijn gelijk aan de goedgekeurde referentie (concept-5) |
| Handmatige beslissingen | 2 tegenstrijdigheden (kamers 3 ↔ 4, buitenruimte balkon ↔ zonneterras): beide besloten zoals in concept-5. 20 overige gegevens met één knop goedgekeurd. Profiel 'stads' (voorstel) gekozen. Brochurelogo als kantoorlogo (merk #04158A, detail #F02B89). Lege kantoorgegevens aangevuld (telefoon, e-mail, website, adres). Aanlevering opgeslagen als versie 1. In totaal 7 handelingen |
| Nog open voor stap 5 | Rechten bevestigen en domein (blokkades van `controleerAanlevering`); 33 brochurebeelden < 1200 px (originele foto's opvragen); geen slottekst |
| Dubbelherkenning | Getoetst met 2 vergrote kopieën van brochurefoto's als "losse foto's": beide brochurefoto's werden als dubbel gemarkeerd, de losse foto ging voor |

## Stap 4: afrondende verbeteringen na review (05-11-2026)

| Meting | Waarde |
|---|---|
| Doorlooptijd | ±25 min |
| Verbeteringen | (1) Korte bestandsnamen, de volledige naam intern; getoetst met een base64-naam uit een mailbijlage, een uuid-naam en een lange cameranaam op 390, 768, 1024 en 1440 px: niets loopt over. (2) Bulkgoedkeuring server-side, alleen voor gegevens zonder signaal. (3) Meldingen in blokkerend, aandachtspunt en informatief. (4) Tegenstrijdigheid (kamers) en terminologische afwijking (buitenruimte) alleen op te lossen met bevestiging en motivering; migratie `005_besluiten.sql`. (5) Fotokwaliteit: geschikt, onvoldoende resolutie, originelen nodig, openingsbeeld. (6) Secundaire teksten donkerder (#4b5563, 7,6:1) met meer regelafstand; foto-chips van 12 naar 13 px; Rhadix-tokens ongewijzigd |
| Markt 27 na de verbeteringen | 4 blokkerend (kamers, profiel, rechten, domein), 6 aandachtspunten, 6 informatief. Bulkgoedkeuring: 15 van de 22 gegevens; 7 blijven open (kamers, buitenruimte, woningtype en 4 maten uit de lopende tekst met zekerheid 'middel'). Fotokwaliteit: 1 van 34 geschikt, 33 onder 1200 px, 33 originelen nodig, geen openingsbeeld mogelijk |
| Tests | 64 (+1 bestandsnamen; de importtest is uitgebreid met besluiten, niveaus, bulk en fotokwaliteit), alle groen. 81 generatortests groen; productie-instantie en generator ongewijzigd |

## Stap 5: broncontrole, kwaliteitscontrole en vrijgave (05-11-2026)

| Meting | Waarde |
|---|---|
| Doorlooptijd | ±60 min (inclusief een onderbreking van de shell-toegang) |
| Hergebruik generator | `controleerAanlevering()`, `naarManifest()` + `schema/manifest.schema.json` (Ajv van de productie-instantie), `controleerFeiten()`, `controleerTaal()`/`tekstenMetHerkomst()`, `EIS`/`EIS_BROCHURE`, `huisstijlVoorstel()`. Het DS-3-kwaliteitsrapport (`stelRapportSamen`, ontwerp en keuring) vraagt een gebouwde site en hoort bij stap 6 |
| Nieuw (alleen waar nodig) | Export database → aanleveringsformaat, fasen en checklist, beslissingen op projectniveau, besluitenlog (`besluit`, alleen aanvullen), afwijzen van gegevens, triggers die de vrijgave laten vervallen; migratie `006_beoordeling_vrijgave.sql` |
| Iteraties | (1) Het opslagpad stond niet in het overzicht: de export haalt het nu intern op. (2) De test vond "€ 158 per maand" (VvE-bijdrage) in de brochuretekst. Die staat ook in het goedgekeurde concept-5; het wordt nu een aandachtspunt "bedrag in de tekst". (3) Technische paden uit de feitencontrole leesbaar gemaakt. (4) Een knop voor de bulkgoedkeuring ook op het beoordelingsscherm |
| Tests | 66 (+2: de volledige workflow met Markt 27, en het besluitenlog dat niet te wijzigen of te verwijderen is). 81 generatortests groen; generator en productie-instantie ongewijzigd |

### Praktijktest Markt 27 (demo-omgeving, daarna verwijderd)

| Meting | Waarde |
|---|---|
| Import (met classificatie) | ±21–30 s, zoals in stap 4 |
| Kwaliteitscontrole | 0,13–0,18 s (export, aanleveringscontrole, manifestschema, feiten- en taalcontrole) |
| Eerste controle | 4 blokkades: profiel, kantoor zonder telefoon en e-mail, publicatierechten, websiteadres. Plus 10 aandachtspunten en 5 informatief |
| Menselijke handelingen tot vrijgave | 16: bulkgoedkeuring (15 gegevens), 2 besluiten over tegenstrijdigheden, 5 gegevens met lagere zekerheid afzonderlijk, de kantoorgegevens aanvullen uit de brochure, rechten, profiel, websiteadres (tijdelijk), openingsbeeld, fotokwaliteit accepteren, de kwaliteitscontrole opnieuw uitvoeren, de vrijgave |
| Na de beslissingen | 0 blokkades. 4 aandachtspunten: het VvE-bedrag en 3 lange zinnen. 5 informatief. Vrijgave geslaagd; status `klaar_voor_productie`; alle 4 fasen gereed; 28 besluiten in het log |
| Borging | Een vrijgave met een verouderde kwaliteitscontrole wordt geweigerd (409). Een wijziging na de vrijgave laat de status terugvallen naar `aanlevering_incompleet`. Bij een nieuwe import blijven goedgekeurde, gecorrigeerde en afgewezen gegevens staan |

## Stap 6: conceptgeneratie en preview (05-11-2026)

| Meting | Waarde |
|---|---|
| Hergebruik generator | `controleerAanlevering()`, `naarManifest()`, het manifestschema, `altUitCategorie()`, `mp bouw` (automatische compositie, renderen, QA) en `mp kwaliteit` (DS-3: ontwerp, taal, keuring). Geen nieuwe generator, compositieregels of bouwblokken |
| Nieuw | Wachtrijsoort `conceptgeneratie`, tabel `concept` (onveranderlijke versies; alleen de beoordeling is bij te werken), afgeschermde preview met token, het scherm "Concept en preview", metingen per versie; besluiten na stap 5 (verplicht/aanbevolen, financiële feiten met `publiceren = false`); migratie `007_concepten.sql` |
| Iteraties | (1) Een makelaar kon een concept niet lezen: een gewone join op `gebruiker` viel weg door RLS; nu een LEFT JOIN (ook in de lijst met aanleveringen). (2) Lettertypes in de sandbox-preview vroegen CORS: alleen voor `.woff2` toegestaan. (3) De runbestanden van `mp` in de productie-instantie (`.cache/`, `metingen/`) bevatten woninggegevens: ze worden nu naar de conceptmap verplaatst. (4) Tests aangepast: de VvE-bijdrage is een extra (23e) gegeven en geldt als informatie |
| Tests | 67 (+1: de volledige keten met twee echte builds, de preview, verbeterpunten, v2 zonder v1 te overschrijven en de rechten). 81 generatortests groen; productie-instantie ongewijzigd |

### Praktijktest Markt 27 (demo-omgeving, classificatie aan, daarna verwijderd)

| Meting | Waarde |
|---|---|
| Aanlevering en import | 21 s (inclusief de beeldclassificatie) |
| Menselijke controle | 11 handelingen: bulkgoedkeuring, 2 besluiten over tegenstrijdigheden, kantoorgegevens en logo uit de brochure, rechten, profiel, conceptadres, openingsbeeld, kwaliteitscontrole, vrijgave. Geautomatiseerd in ±1 s; in de praktijk bepaald door het lezen en beslissen |
| Conceptgeneratie | 26,7 s: export en manifest 0,2 s, classificatie hergebruikt (0 s), `mp bouw` 6,6 s, `mp kwaliteit` 19,7 s |
| Handmatige correcties | 0 gegevens gecorrigeerd, 0 afgewezen, 0 in de compositie; 2 besluiten over tegenstrijdigheden |
| Tot het eerste concept (machine) | **47,9 s** (ambitie ≤ 15 min: gehaald) |
| Kwaliteitsrapport v1 | 0 blokkerend; axe 0 bevindingen op 390 en 1280 px; LCP mobiel 108 ms; CLS 0; geen externe verzoeken; 14 waarschuwingen (o.a. 3 onzekere fotocategorieën, 4 onbevestigde feiten, ontbrekende openingstekst, introductie en slottekst, tekstbreedte, 3 lange zinnen) |
| Pagina | Automatische compositie in 14 delen, met ruimtesecties (Entree, Wonen, Koken, Slapen en werken, Sanitair, Buiten, Omgeving), plattegronden, kenmerken en contact; profiel stads, DS 1.0 |

## Herstel na stap 6: navigatie naar project en concepten (5-11-2026)

| Onderdeel | Uitkomst |
|---|---|
| Oorzaak "concept v1 niet te zien" | De praktijktest van stap 6 liep in een tijdelijke demo-omgeving (eigen database en opslag) die daarna is verwijderd. In de studio-database heeft Markt 27 geen concept, geen kwaliteitscontrole, geen vrijgave en geen besluiten. Concept v1 is niet te herstellen. Het rapport van stap 6 had dit expliciet moeten melden |
| Status | "Aanlevering incompleet" klopt met de werkelijke voortgang (alleen de import is gedaan; 22 gegevens overgenomen, niets beoordeeld) |
| Oorzaak "project niet te openen" | Alleen de vetgedrukte naam in de dashboardrij was een link, zonder zichtbaar linkkenmerk; de rest van de rij reageerde niet |
| Correcties | Hele dashboardrij klikbaar (de naam blijft het toetsenbordpad), "Openen →" en een kolom Concepten; kaart "Conceptversies" op de projectpagina met per versie "Preview bekijken" of de reden waarom er nog geen concept is; directe link per versie (`#/projecten/:id/concept/v<n>`) met een melding als de versie niet bestaat; API-veld `concepten` (aantal versies) bij projecten; fasebalk op mobiel in één kolom (liep bij 390 px buiten beeld) |
| Controle | Route dashboard → project → concepten op 1440 en 390 px doorlopen in een geïsoleerde kopie van de database (eigen poorten, testbeheerder alleen in de kopie): rijklik opent het project, geen concept en uitgeschakelde genereerknop correct gemeld, geen consolefouten, geen horizontaal scrollen. Woninggegevens en opslag ongewijzigd |
| Tests | 67 groen (concepttest uitgebreid met het aantal versies in lijst en detail); 81 generatortests groen; productie-instantie ongewijzigd |

## Optimalisatie beoordeling en tijdregistratie (5-11-2026)

| Onderdeel | Uitkomst |
|---|---|
| Oorzaak "ruim 4 uur menselijke controle" bij Markt 27 v1 | De meting was kloktijd van de import (17:33) tot de vrijgave (21:56), inclusief stilstand. Uit het besluitenlog: 13 besluiten tussen 21:50:36 en 21:56:37, zonder pauze > 5 min. Interacties werden toen niet geregistreerd; lezen vóór het eerste besluit is niet vast te stellen |
| Snelle beoordeling | Bronovername als eigen besluit (wie, wanneer, import, sha256), geldt alleen voor die bronversie; gegevens blijven `overgenomen` (geen verificatie). Eén handeling voor overname, verplichte keuzes, kwaliteitscontrole en vrijgave; invoer eerst volledig gecontroleerd, daarna pas vastgelegd. Nieuw verplicht punt "Broninformatie overgenomen als uitgangspunt of afzonderlijk beoordeeld" |
| Fase-afhankelijk | Inhoudelijke tegenstrijdigheden blokkeren het interne concept niet meer; gebruikte waarde zichtbaar en onbevestigd in de export; vóór publicatie verplicht. `concept.uitgangspunten` legt bronovername en open onzekerheden per versie vast |
| Tijdregistratie | Machinetijd, actieve gebruikerstijd (interacties + handelingen, inactiviteitsgrens `STUDIO_INACTIVITEIT_MIN` = 5) en kalenderdoorlooptijd afzonderlijk; betrouwbaarheid per meting. Historische metingen (v1) ongewijzigd; het scherm markeert ze en toont een achteraf afgeleide indicatie |
| Kwaliteitsmeldingen | Vier categorieën, samenvatting met aantallen en prioriteit, actie per melding (conceptgeneratie, publicatie, geen), technische details uitklapbaar |
| Migratie | `008_overname_tijd.sql` (tabel `activiteit`, kolom `concept.uitgangspunten`); back-up vooraf. Concept v1, gegevens, besluiten, audit, project en alle 713 opgeslagen bestanden gecontroleerd ongewijzigd |
| Controle | Schermen in een geïsoleerde kopie (eigen poorten, testbeheerder alleen daar) op 1440 en 390 px: geen consolefouten, geen horizontaal scrollen |
| Tests | 71 groen (+4: actieve tijd, interacties, betrouwbaarheid, indeling; de concepttest loopt nu via de snelle beoordeling met een echte build). 81 generatortests groen; productie-instantie ongewijzigd |

## Realisatie online, fase 1 en voorbereiding fase 2 (6-11-2026)

| Onderdeel | Uitkomst |
|---|---|
| Repositorycontrole | Alle commits (nu 14) doorzocht: geen klantbestanden, echte wachtwoorden, tokens of sleutels; alleen fictieve e-mailadressen en 127.0.0.1; auteur alleen het Apple-relayadres. "Contact Linde" in een test is een plaatshouder. Geschikt om openbaar te maken met volledige geschiedenis |
| Online-instellingen | `STUDIO_HOST`, `STUDIO_HERKOMST`, `STUDIO_COOKIE_SECURE`, `STUDIO_OMGEVING`, `STUDIO_ROL` (alles/api/verwerker); lokaal ongewijzigd. Verwerker als eigen proces (`api/src/verwerker.ts`) op de bestaande wachtrij. `/api/gezond` zonder sessie |
| Images (arm64) | `deploy/Dockerfile.app` (studio + generator op `4eb7f2c` als git-checkout, Chromium 156, SigLIP-omgeving; model gekoppeld) 3,8 GB; `deploy/Dockerfile.web` (nginx) 77 MB. Alle basisimages (node, postgres, nginx) multi-arch met arm64 |
| Proef in arm64-containers (Docker Desktop, 8 kernen) | Markt 27 van upload tot concept via de API: import 110,6 s (classificatie 106 s, CPU-gebonden op 6 kernen), snelle beoordeling, concept 28,1 s; 0 blokkerend, axe 0, LCP 88 ms. Pieken: verwerker 3,0 GB, API 103 MB, db 35 MB, web 9 MB |
| Back-up en herstel | pg_dump en tellingen; restic-rondgang op Linux-opslag (876 bestanden, checksums gelijk, `restic check` in orde); dump teruggezet in een tijdelijke db: tellingen gelijk. Restic via Docker Desktop-bestandsdeling op de Mac gaf I/O-fouten (bekend effect; op de server niet van toepassing) |
| Server | `deploy/server/`: inrichten, nginx, Cloudflare-IP's, back-up, hersteltest, meting, systemd-timers, LEESMIJ; `deploy/uitrollen.sh`. Nog niets uitgevoerd op een server |
| Tests | 72 groen |
