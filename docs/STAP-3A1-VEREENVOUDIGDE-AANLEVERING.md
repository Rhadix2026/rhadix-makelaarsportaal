# Stap 3A.1 – Vereenvoudigde woningaanlevering

**Status (20-11-2026):** op test (`844ffa3`), ter beoordeling. Niet in productie.

## Wat de makelaar ziet

- **Ingang:** https://makelaarsportaal-test.rhadix.nl/?merk=morskieft. Na het inloggen zie je
  Woningprojecten met de knop **Woning aanleveren**.
- **Formulier `#/aanleveren`:** naam of adres van de woning, verkoopbrochure (PDF) en de knop
  **Woning aanleveren**. Het kantoor wordt getoond, niet gekozen.
- **Daarna `#/projecten/:id/aangeleverd`:** de voortgang van de brochureverwerking. Als die klaar is:
  het aantal foto's, het aantal gevonden gegevens en het aantal aandachtspunten voor Rhadix.

## Hoe het aansluit (geen tweede workflow)

| Stap | Bestaand onderdeel |
|---|---|
| Woning aanmaken | `POST /api/projecten`: eigen kantoor, `naam`, profiel = standaardprofiel van het kantoor of `buitenplaats`. Ontwerpsysteem kiest de server zoals altijd. |
| Brochure uploaden | `POST /api/projecten/:id/bestanden?soort=brochure` (zelfde upload en opslag) |
| Import | `POST /api/projecten/:id/verwerkingen` `brochure-import`: bestaande import, beeldclassificatie (SigLIP), wachtrij en één-verwerking-per-project |
| Voortgang | component `VerwerkingVoortgang` (bestaand) |
| Verder | zelfde project-ID, status blijft `aanlevering_incompleet`; Rhadix werkt verder via aanlevering, beoordeling en vrijgave in het uitgebreide beheer |

Mislukt de upload of de start van de import nadat de woning al is aangemaakt, dan gaat
"Opnieuw proberen" verder met dezelfde woning (geen dubbele projecten).

## Voor de makelaar verborgen (blijft in datamodel en beheer)

- **Velden:** adres, postcode, plaats, woningtype, profiel, definitief domein, contactpersoon en
  kantoorkeuze. De import vult de woninggegevens aan.
- **Menu en filter:** het menu **Kantoren** (`#/kantoren` leidt naar het dashboard) en het
  kantoorfilter op het dashboard.
- **Formulier:** het volledige formulier `#/projecten/nieuw` (toont voor de makelaar het eenvoudige
  formulier).

**Wanneer:** de vereenvoudigde route geldt voor een gebruiker die geen platformbeheerder is en bij
een kantoor met een kantoorthema hoort (nu alleen Morskieft: `eenvoudigeAanlevering` in
`web/src/onderdelen/rechten.ts`). Platformbeheer houdt alles.

**Rechten:** ongewijzigd. De server controleert het kantoorrecht bij elke stap (RLS en
`rechtOp`). Zichtbaarheid in de interface is alleen gemak, geen beveiliging.

## Tests

- **Automatisch:** 118/118, waarvan nieuw `tests/eenvoudig.test.ts`:
  - de volgorde (eigen kantoor, `buitenplaats`, beginstatus, lege velden, brochure in hetzelfde project);
  - een makelaar van een ander kantoor kan geen project aanmaken, uploaden, importeren of inzien
    (400/404), ziet geen projecten van het andere kantoor en alleen het eigen kantoor.
- **Uitrol test:**
  - vooraf 0 lopende verwerkingen, met databasedump; gezond;
  - de vingerafdruk van kantoor, lidmaatschap, gebruikers en projecten is gelijk vóór en na.
- **End-to-end op test** met de bestaande testbrochure Markt 27 (één import):

  | # | Controle | Resultaat |
  |---|---|---|
  | 1 | Dashboard als makelaar | geen menu Kantoren, knop "Woning aanleveren", geen kantoorfilter; `#/kantoren` en `#/projecten/nieuw` geven het dashboard en het eenvoudige formulier ✓ |
  | 2 | Formulier | alleen naam en brochure; lege verzending geeft twee duidelijke meldingen; tablet en mobiel zonder horizontaal scrollen ✓ |
  | 3 | Aanleveren | project `1e7df96b…`, door naar de voortgangspagina ✓ |
  | 4 | Bestaande import | klaar in 131 s ✓ |
  | 5 | Gegevens in het project | kantoor juist, profiel `buitenplaats`, ontwerpsysteem 1.0, status `aanlevering_incompleet`; adres "Markt 27", plaats "Wolvega", woningtype ingevuld; 1 brochure, 34 foto's (alle geclassificeerd), 2 plattegronden, 23 gegevens, 2 aandachtspunten ✓ |
  | 6 | Rhadix-beheer | platformbeheer: rechten produceren en kantoorbeheer; projectdetail, aanlevering en beoordeling bereikbaar; menu Kantoren aanwezig ✓ |
  | 7 | Organisatiescheiding | server-side getest (zie boven); onbevoegde gebruiker eerder op test 403 ✓ |

  De end-to-end-test is gedaan met een platformbeheer-testsessie, met de interface in de
  testbrowser weergegeven als makelaar van het gekoppelde kantoor. Het echte makelaarsaccount
  beoordeelt de opdrachtgever.

## Aandachtspunten

- **Testproject:** "TEST stap 3A.1 – Markt 27, Wolvega (Claude)" staat in het testkantoor. Rhadix kan
  het laten staan of opruimen.
- **Projectdetail:** een makelaar die op een bestaand project klikt, ziet nog het volledige
  projectdetail, met bewerken en het uitgebreide aanleverscherm. Vereenvoudigen kan in een volgende
  stap.
- **Bestandskiezer:** de bestandskiezer gebruikt de standaardknop van de browser.
- **Momentopname:** "Aanlevering opslaan" (een momentopname) wordt in deze route niet automatisch
  gedaan. De gegevens staan wel direct in het project.
- **Tijdelijke firewallregel:** TCP 22 vanaf 77.165.193.32 staat nog open (zie stap 2).
