# Stap 3A.4 – Verbeteringen na de test met 'bossie' (Beusemkolkweg 16, Tilligte)

**Status (20-11-2026):** lokaal gebouwd en getest (127/127, waaronder een benchmark met de echte brochure en de
echte generator). **Nog niet naar staging of test**: wacht op akkoord. Productie en andere applicaties ongewijzigd.

## 1. Domeinnaam

- **Was:** adres + plaats (`beusemkolkweg16tilligte.nl`), naar aanleiding van het voorbeeld in 3A.3.
- **Nu:** straat + huisnummer + `.nl`, zonder plaats: `beusemkolkweg16.nl`; `markt27.nl`.
- De makelaar kan het voorstel wijzigen. Een bezette naam (of een mislukte controle) blokkeert het concept
  niet: het concept krijgt een tijdelijk adres. Getest met een register dat alles als bezet meldt.

## 2. Woningtype

- **Bevinding:** woningtype wordt door de generator niet gebruikt (niet in `woning.json`, niet in de
  controles) en was dus al niet verplicht. Alleen de woningpagina toonde "niet herkend".
- **Nu:** de regel verschijnt alleen als het woningtype herkend is; er wordt niets gevraagd.
- **Ontwerp:** de vereenvoudigde aanlevering gebruikt al het profiel `buitenplaats` (het premium ontwerp,
  afgeleid van de eerste referentiewoning), tenzij het kantoor zelf een standaardprofiel heeft ingesteld.
  Niets hangt af van het woningtype. 'bossie' had dit profiel ook al.

## 3. Zon- en schaduwvisualisatie

- **Hoe de aanvraag werd verwerkt:** alleen als besluit `zonschaduw` in het besluitenlog. De aanvraag ging
  niet mee naar de generator, dus het concept had geen onderdeel. Er bestaat nog geen koppeling met de
  zonnestudie.
- **Nu:** is de visualisatie aangevraagd (de stand op het moment van genereren), dan toont de **afgeschermde
  preview** een eigen sectie "Zon en schaduw" vóór de afsluiting. Die sectie is onmiskenbaar intern: een
  gestreepte rand, het label "Intern · alleen in de afgeschermde preview", "nog niet berekend, er worden geen
  zonuren of schaduwen getoond", plus de aanvraagdatum, de locatie en de gekozen foto.
- **Waarom het nooit publiek kan worden:** de plaatshouder wordt pas toegevoegd bij het serveren van de
  preview (`/api/voorbeeld`). De gegenereerde site op schijf en de generator blijven ongewijzigd. Een test
  controleert dat het opgeslagen `index.html` geen plaatshouder bevat.

### Onderzoek: de interactieve simulatie later aansluiten

Basis: `~/Developer/zonnestudie-poc`, live op rhoderlanden.nl/zon.

- **Wat de proof of concept heeft:**
  - AHN4 (DSM/DTM 0,5 m), een luchtfoto en 3DBAG;
  - schaduwlagen per half uur voor 4 dagen (seizoensknoppen), een tijdschuif en een afspeelknop;
  - een warmtekaart met zonuren;
  - ±1 minuut rekentijd en ±4 MB statische bestanden per object; geen rekenwerk tijdens een bezoek.
- **Koppeling in vijf stappen:**
  1. **Locatie:** BAG-geocodering van het adres naar verblijfsobject en pand (les van het landgoed: via het
     verblijfsobject met woonfunctie, niet het eerste adrespunt). Rhadix bevestigt de locatie.
  2. **Berekening als verwerking:** de soort `zonnestudie` in de bestaande wachtrij, met dezelfde voortgang.
     Uitvoer naar `projecten/<id>/zon/`, met de zelftest en de DSM-dekking als kwaliteitscontrole.
  3. **Generatorblok `zon-schaduw`:** aan te zetten met een manifestvlag. Het blok wordt alleen gerenderd
     als er gecontroleerde lagen zijn, anders niets (geen lege of fictieve weergave).
  4. **Datumkeuze:** de proof of concept rekent 4 vaste dagen. Een vrije datumkeuze vraagt een berekening
     per dag in de browser of meer vooraf berekende dagen. Voorstel: 12 dagen (de 21e van elke maand) met
     een maandschuif en een tijdschuif. Dat is ±12 MB per object en ±3 minuten rekentijd **[schatting]**.
  5. **Vervalt dan:** de plaatshouder in de preview. Met lagen toont de preview het echte blok.
- **Nodig voor een besluit:** een definitie van het kerncijfer (zonuren rond de woning of een gekozen terras),
  het aantal dagen of de vrije datumkeuze, en de opslag (±1–3 GB bij 250 objecten).

## 4. Publiekswebsite en navigatie

- **Interne projectnaam:**
  - **Oorzaak:** de export gaf `project.naam` ('bossie') door als `woning.naam`. De generator gebruikt die
    naam in de header ("bossie · Tilligte"), de voettekst en de alt-teksten van de foto's ("bossie, foto 1 van 10").
  - **Nu:** de publieke naam is het objectadres (`publiekeNaam()`). Een expliciete commerciële objectnaam
    gaat voor zodra die bestaat; daar is nog geen veld voor in het datamodel.
  - Het **tijdelijke conceptadres** bevatte via de slug ook de projectnaam
    (`rhadix-testmakelaars-bossie.invalid` in canonical en og:url). Het is nu neutraal:
    `concept-<id>.invalid`.
- **Navigatie** (`navigatieVoorKopers()`): alleen de bestaande koppen en de volgorde van de brochure worden
  gebruikt, er wordt niets verzonnen. Benchmark Beusemkolkweg 16:

  | Hoofdstuk | Was | Nu |
  |---|---|---|
  | Indeling eerste en tweede verdieping | nav "Eerste en tweede" | nav "Verdiepingen" |
  | Indeling begane grond kantoor | nav "Begane grond kantoor" | nav "Kantoor" |
  | Verdieping (brochure p. 33, hoort bij het kantoor; plattegrond p. 44 "Kantoor eerste verdieping") | kop "Verdieping", nav "Verdieping" | kop "Verdieping kantoor", geen eigen link |
  | Wonen in (kop ook in de brochure zo afgebroken, p. 54) | kop "Wonen in", nav "Wonen in" | kop "Wonen in de omgeving van Tilligte", nav "Omgeving" |

  Navigatie op de website: Beschrijving · Begane grond · Verdiepingen · Kantoor · Bijzonderheden · Contact.
  "Omgeving" valt weg door het bestaande maximum van 6 links van de generator.

## Tests

- **Automatisch: 127/127.** Nieuw:
  - `tests/publiek.test.ts`: publieke naam, navigatieregels op de koppen van Beusemkolkweg en de plaatshouder
    (ontsnapping, positie, alleen bij een aanvraag, geen cijfers);
  - `tests/benchmark-beusemkolkweg.test.ts`: de route van de makelaar met de echte brochure en de echte
    generator. Gecontroleerd worden het voorstel `beusemkolkweg16.nl`, een bezette en een gewijzigde naam
    zonder blokkade, het ontbrekende woningtype zonder blokkade, het profiel `buitenplaats`, geen 'bossie' in
    de website, de navigatie, de plaatshouder alleen in de preview, en een site op schijf zonder plaatshouder.
- **Bijgewerkte tests:**
  - het tijdelijke adres en de publieke naam in `concept.test.ts` en `beoordeling.test.ts`;
  - het domeinvoorstel in `eenvoudig.test.ts` en `makelaarroute.test.ts`.
