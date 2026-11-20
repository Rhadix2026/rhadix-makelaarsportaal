# Voorstel: inlogmelding en aandachtspaneel voor verbeterpunten

**Status (20-11-2026):** goedgekeurd en lokaal gebouwd (migratie 016, 150/150 tests). Niet op staging of test; uitrol pas na akkoord.

## 1. Wat er al is

| Gegeven | Bestaat? | Bruikbaar voor "nieuw sinds het laatste bezoek"? |
|---|---|---|
| Laatste aanmelding in het portaal | **nee**. Een Rhadix-aanmelding maakt geen sessie in het portaal; alleen de noodtoegang doet dat (`sessie.aangemaakt_op`) | nee |
| `gebruiker.aangemaakt_op` | ja (eerste aanmelding) | nee |
| `activiteit` | ja, maar alleen per project en voor 4 projectschermen (tijdmeting); niet voor het dashboard of het overzicht Verbeterpunten | nee |
| `auditregel` | ja, handelingen (indienen, behandelen …); geen bezoeken | nee |
| Centraal Rhadix-platform `users.last_login_at` | ja, maar die waarde wordt bij elke aanmelding overschreven (het is het tijdstip van de huidige aanmelding) en is niet bereikbaar zonder een nieuwe koppeling | nee |
| Verbeterpunten: `ingediend_op`, `bijgewerkt_op`, status | ja (migratie 015) | ja: dit is waar "nieuw" mee wordt vergeleken |

**Conclusie:** er wordt nergens vastgelegd wanneer iemand de verbeterpunten het laatst heeft bekeken. Zonder een
kleine aanvullende registratie is "nieuw sinds het laatste bezoek" niet betrouwbaar te bepalen.

## 2. Benodigde aanpassingen

**Database (één kleine migratie, 016):** de tabel `gezien`, één rij per gebruiker en onderwerp.

```sql
CREATE TABLE gezien (
  gebruiker_id uuid NOT NULL REFERENCES gebruiker (id) ON DELETE CASCADE,
  onderwerp    text NOT NULL CHECK (onderwerp IN ('verbeterpunten')),  -- later bijvoorbeeld 'concepten_te_beoordelen'
  gezien_op    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gebruiker_id, onderwerp)
);
-- RLS: alleen de eigen rij lezen en bijwerken.
```

- Er worden geen verbeterpunten gekopieerd en er komt geen tweede takenlijst: alleen één tijdstip per gebruiker.
- **Alternatief zonder databasewijziging:** het tijdstip in de browser bewaren (localStorage).
  - Nadeel: "nieuw" verschilt per apparaat en browser, en is weg na het wissen van de browsergegevens.
  - Daarom niet mijn advies.

**API (hergebruik van de bestaande registratie en rechten):**
- `GET /api/aandacht` geeft per soort een blok terug:
  `{ soorten: [{ soort: 'verbeterpunten', open, nieuw, items: [max. 8] }] }`.
  - Berekend onder de bestaande rijregels (dezelfde als `/api/projecten/:id/verbeterpunten`), dus nooit gegevens van
    een andere organisatie.
  - Later kan er een tweede blok bij, bijvoorbeeld "concepten klaar voor beoordeling", zonder dat het scherm verandert.
- `POST /api/aandacht/verbeterpunten/gezien` zet `gezien_op = now()` voor de aanvrager.
  - Wordt aangeroepen bij "Bekijk verbeterpunten" en bij het openen van het overzicht Verbeterpunten.
  - Niet bij "Later".

**Interface:**
- een melding na het inloggen (component in `main.tsx`);
- een paneel op het dashboard (`Projecten.tsx`);
- het bestaande overzicht en de pagina's per project blijven ongewijzigd.

## 3. Nieuw tegenover al bekeken

| Rol | Wat telt als **nieuw** | **Open** (totaal) |
|---|---|---|
| Platformbeheer | punten met `ingediend_op` > `gezien_op` (nieuw ingediend) | OPEN + IN_BEHANDELING, alle kantoren |
| Kantoorbeheerder | punten van het eigen kantoor met `bijgewerkt_op` > `gezien_op` en een reactie of afhandeling van Rhadix (in behandeling genomen, beantwoord, verwerkt, geannuleerd) | OPEN + IN_BEHANDELING van het eigen kantoor |
| Makelaar | zoals de kantoorbeheerder, maar alleen voor de punten die hij zelf heeft ingediend (**te bepalen**, zie §7) | idem, eigen punten |

- **Zonder rij in `gezien` (eerste keer):** alle open punten tellen als nieuw. Dat is eerlijk; daarna wordt het tijdstip
  vastgelegd.
- In het paneel krijgen nieuwe punten een stip en vette tekst. Bekeken punten zijn gewoon.

## 4. Schets: melding na het inloggen

Rechtsboven, onder de menubalk. Niet blokkerend: geen grijze achtergrond, en de pagina blijft bruikbaar.

```
┌───────────────────────────────────────────────┐
│ ● Verbeterpunten                              │
│   3 nieuw sinds uw laatste bezoek             │
│   7 open of in behandeling                    │
│                                               │
│   [ Bekijk verbeterpunten ]   [ Later ]       │
└───────────────────────────────────────────────┘
```

- **Eén keer per sessie:** de melding verschijnt bij het starten van een sessie (het eerste scherm na het inloggen of
  na een nieuw tabblad), en alleen als `nieuw > 0`, of als `open > 0` bij platformbeheer. Daarna niet opnieuw bij
  een paginawissel; dat wordt per tabblad bijgehouden in sessionStorage.
- **Bekijk verbeterpunten:** gaat naar het overzicht en zet `gezien_op`.
- **Later:** sluit de melding voor deze sessie. `gezien_op` blijft staan, dus bij een volgende sessie volgt dezelfde
  melding weer.
- Met de toetsenbordfocus op de knoppen, `role="status"`, sluiten met Esc.
- Op mobiel over de volle breedte onder de menubalk.

## 5. Schets: aandachtspaneel op het dashboard

**Desktop (≥ 1100 px):** het projectoverzicht links, het paneel rechts (±320 px), in- en uitklapbaar. De klapstand
wordt per kijker in localStorage bewaard.

```
┌ Woningprojecten ──────────────────────────────┐ ┌ Aandacht ─────────────── [–] ┐
│ [stat] [stat] [stat] [stat] [stat]            │ │ Verbeterpunten               │
│ filters …                                     │ │  7 open · 3 nieuw            │
│ ┌───────────────────────────────────────────┐ │ │ ● Markt 27, Wolvega          │
│ │ project … status …                        │ │ │   Morskieft · v1 · Open      │
│ │ project … status …                        │ │ │   "Liever de voorgevel …"    │
│ │ …                                         │ │ │ ● Beusemkolkweg 16, Tilligte │
│ └───────────────────────────────────────────┘ │ │   Morskieft · v2 · In beh.   │
│                                               │ │   "Menu op mobiel …"         │
│                                               │ │   …                          │
│                                               │ │ [ Alle verbeterpunten → ]    │
└───────────────────────────────────────────────┘ └──────────────────────────────┘
```

- **Per regel:**
  - woningadres (niet de interne projectnaam);
  - kantoor (alleen bij platformbeheer);
  - versie en status;
  - een korte omschrijving van maximaal 60 tekens.
- **Een regel aanklikken** opent de conceptpagina van dat project en die versie (`#/projecten/:id/bekijken/vN`), waar
  het punt staat.
- Maximaal 8 regels, nieuwe eerst, dan de oudste open punten.
- **Mobiel en tablet (< 1100 px):** het paneel staat ingeklapt boven het projectoverzicht ("Aandacht · 7 open · 3
  nieuw ▾") en opent op tik. Één kolom, dus geen horizontaal scrollen.
- **Geen open punten:** het paneel toont "Geen openstaande verbeterpunten", of blijft weg bij een kantoorgebruiker
  zonder punten.

## 6. Impact op het huidige dashboard

- De statistieken, de filters, de tabel en de knoppen blijven ongewijzigd. Alleen de buitenste opmaak wordt bij brede
  schermen een raster van twee kolommen.
- Er komt één extra lichte aanroep per dashboardbezoek (`/api/aandacht`). Die telt op indexen die al bestaan
  (`verbeterpunt_open`, `verbeterpunt_project`).
- Het menu-item "Verbeterpunten" en het overzicht blijven bestaan; het paneel verwijst ernaar.
- De eenvoudige weergave voor Morskieft houdt dezelfde opbouw, met het paneel alleen als er iets te melden is.

## 7. Rollen (en een keuze)

| | Melding | Paneel | Inhoud |
|---|---|---|---|
| Platformbeheer | ja | ja | alle kantoren, met kantoornaam |
| Kantoorbeheerder | ja, bij nieuwe reacties of afhandeling | ja | alleen het eigen kantoor, zonder kantoornaam |
| Makelaar | **te bepalen:** (a) geen melding en geen paneel, of (b) alleen voor de eigen ingediende punten | idem | alleen de eigen punten |

Mijn advies voor de makelaar is (b): dan ziet hij dat Rhadix op zijn punt heeft gereageerd. Andere gegevens worden
daarmee niet zichtbaar.

## 8. Testplan

**Automatisch:**
- **Rollen:**
  - platformbeheer telt alle kantoren;
  - de kantoorbeheerder alleen het eigen kantoor;
  - de makelaar alleen de eigen punten (bij keuze b) of krijgt 403 (bij keuze a);
  - een ander kantoor krijgt 0 en ziet geen projectnamen.
- **Nieuw tegenover bekeken:**
  - zonder `gezien` is alles nieuw;
  - na "gezien" is het aantal nieuw 0;
  - een nieuw ingediend punt geeft platformbeheer +1 nieuw;
  - een reactie of afhandeling van Rhadix geeft de kantoorbeheerder +1 nieuw;
  - "Later" verandert niets.
- **Lekken:** de aantallen en regels komen uitsluitend uit rijen die de gebruiker mag zien. Getest met twee kantoren
  en punten in beide.
- **Database:** `gezien` alleen voor de eigen rij; iemand anders' tijdstip kan niet worden gelezen of gezet.

**Interface (lokaal, en daarna op test na akkoord):**
- de melding verschijnt één keer per sessie;
- geen nieuwe melding na een paginawissel;
- "Later" sluit hem voor de sessie, "Bekijk" gaat naar het overzicht en zet de teller op nul;
- het paneel klapt in en uit en onthoudt de stand;
- de links gaan naar het juiste project en de juiste versie;
- mobiel op 390, 360 en 320 px zonder horizontaal scrollen;
- het werken in het portaal wordt niet geblokkeerd (de focus blijft vrij).

**Behoud:** vingerafdruk vóór en na de migratie (projecten, concepten, verbeterpunten, besluiten, gebruikers).
Migratie 016 voegt alleen de tabel `gezien` toe. Er komt een terugdraaiscript, en een test van heen en terug.

## 9. Toekomstige uitbreiding (niet bouwen)

`/api/aandacht` levert blokken per soort. Het paneel toont elk blok op dezelfde manier: titel, aantallen en regels met
een link. Later kunnen er blokken bij, bijvoorbeeld "Concepten klaar voor beoordeling" of "Kwaliteitscontrole met
blokkades". Daarvoor zijn alleen een query en een nieuwe waarde voor `gezien.onderwerp` nodig; het scherm hoeft niet
te veranderen.
