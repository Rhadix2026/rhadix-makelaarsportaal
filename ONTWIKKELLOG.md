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
