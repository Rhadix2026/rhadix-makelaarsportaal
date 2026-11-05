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
