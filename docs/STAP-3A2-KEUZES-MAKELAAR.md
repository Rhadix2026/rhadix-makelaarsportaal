# Stap 3A.2 – Aanvullende keuzes makelaar

**Status (20-11-2026):** op test (`50b5515`), ter beoordeling. Niet in productie. Geen
conceptgeneratie, geen domeinregistratie, geen opschoning van testgegevens.

## Wat de makelaar ziet

Na de brochure-import opent de woningpagina (`#/projecten/:id`, ook vanaf het dashboard):

1. **Uit de brochure:**
   - adres, woningtype, aantal foto's, aantal gegevens en het aantal aandachtspunten voor Rhadix;
   - tijdens de import de bestaande voortgang.
2. **Domeinnaam:**
   - een voorstel uit het herkende adres (Markt 27 → `markt27.nl`; Denekamperstraat 23B →
     `denekamperstraat23b.nl`), in een bewerkbaar veld;
   - de knop **Controleer domeinnaam**, met als uitkomst beschikbaar / bezet / controle niet mogelijk,
     plus de bron en het tijdstip. "Niet gereserveerd" staat er altijd bij;
   - geen koop, betaling of registratie.
3. **Homepagefoto:**
   - een galerij met miniaturen van alle geïmporteerde foto's, met paginanummer en "foto n van m"
     bij meerdere foto's op één pagina;
   - het voorstel van de import is gemarkeerd. Ongeschikte foto's zijn zichtbaar maar niet te kiezen
     ("te klein of staand", bestaande norm);
   - de gekozen foto is duidelijk gemarkeerd.
4. **Zon- en schaduwvisualisatie:** Ja/Nee. Bij Ja kiest de makelaar in dezelfde galerij een foto
   waarop het pand of de tuin herkenbaar is. De locatie is het adres uit de import, dat Rhadix
   controleert.

De makelaar komt niet meer in de technische beheerschermen: `#/projecten/:id`, `/aanlevering`,
`/beoordeling` en `/bewerken` tonen voor de makelaar de woningpagina.

## Hergebruikt

| Onderdeel | Bestaand |
|---|---|
| Homepagefoto | `project.openingsbeeld_id` via `PUT /api/projecten/:id/beslissingen/openingsbeeld` (zelfde kandidaten, norm en voorstel van de import). De conceptgenerator neemt dit al over (export: kolom `hero`). |
| Vastleggen van domeinwens en zon/schaduw | Het bestaande besluitenlog (`besluit`), met de bestaande RLS: alleen het eigen kantoor en platformbeheer. Zichtbaar in het besluitenlog van de beoordeling. |
| Miniaturen, foto-ID's, opslag | `/api/bestanden/:id/miniatuur`, bestaande bestands-ID's |
| Gegevens | Bestaand aanleveroverzicht en bestaande beoordeling |
| Voortgang | `VerwerkingVoortgang` |

Geen nieuwe tabellen, geen migratie, geen nieuwe workflow. Import, classificatie, wachtrij,
kwaliteitscontroles, statussen en versiehistorie zijn ongewijzigd.

## Nieuw

- `api/src/keuzes.ts` en de routes:
  - `GET /api/projecten/:id/keuzes`;
  - `POST /api/projecten/:id/keuzes/domein` (`{domein, controleer}`);
  - `PUT /api/projecten/:id/keuzes/zonschaduw` (`{gewenst, bestand_id}`).
- `web/src/onderdelen/FotoGalerij.tsx` (herbruikbaar), de woningpagina met de keuzes, en het blok
  **Keuzes makelaar** op het projectdetail voor Rhadix-beheer (met een link naar de beoordeling om de
  homepagefoto te wijzigen).

## Wat bij het project wordt vastgelegd

| Keuze | Waar | Inhoud |
|---|---|---|
| Domeinwens | `besluit` onderwerp `domeinwens`, handeling `gecontroleerd: <uitkomst>` of `opgegeven` | domein, uitkomst (status, bron, tijdstip, eventuele reden), `gereserveerd: false`, door wie en wanneer |
| Homepagefoto | `project.openingsbeeld_id` en `besluit` `openingsbeeld` (bestaand) | bestands-ID |
| Zon/schaduw | `besluit` onderwerp `zonschaduw`, handeling `aangevraagd` of `niet gewenst` | gewenst, bestands-ID (moet bij dit project horen), adres als locatie en de herkomst van die locatie |

Het **definitieve** domein (`project.domein`) blijft bij Rhadix/kantoorbeheer en blokkeert het
concept niet (tijdelijk conceptadres).

## Domeinnaamcontrole

- **Bestaande registrarkoppeling:** geen (geen TransIP en ook geen andere registrar).
- **Nu gebruikt:** RDAP van SIDN, de beheerder van `.nl`. Dit is de officiële, gratis bron, zonder
  sleutel en alleen lezend.
  - `404` betekent niet geregistreerd en wordt getoond als **beschikbaar**.
  - `200` betekent geregistreerd en wordt getoond als **bezet**.
  - Al het andere (weigering, storing, time-out) wordt **controle niet mogelijk**. Er wordt nooit
    een uitslag geraden.
- **Opvraaglimiet:** SIDN beperkt opvragingen streng. Bij een snelle reeks volgt 429; met 15 s
  tussenruimte kwamen 8 van de 8 goed door. De server houdt daarom minimaal 5 s tussen opvragingen
  aan en onthoudt een uitslag 10 minuten. Uitslagen "niet mogelijk" worden niet onthouden.
- **Voorstel voor later:** de TransIP API (`/v6/domain-availability`) via het Rhadix-account, met een
  API-sleutel die alleen mag lezen en op het server-IP is vastgezet. Die geeft ook prijs en
  registreerbaarheid en hoort bij de latere registratie door Rhadix. RDAP blijft dan de terugval.

## Zon- en schaduwvisualisatie: aansluiting

Er is nog geen directe technische koppeling met de eerder gebouwde zonnestudie
(`~/Developer/zonnestudie-poc`: AHN4/PDOK, statische lagen, demo op rhoderlanden.nl/zon). De
aanvraag legt alles vast wat Rhadix nodig heeft om die te starten: gewenst, foto en adres.

Nog nodig voor de uitvoering:

- geocodering van het adres naar het BAG-pand. Les uit het landgoed: via verblijfsobject en
  gebruiksdoel, niet het eerste adrespunt;
- het rekenscript per woning en een plek in de generator of website (een blok of `/zon/`);
- een controlestap voor Rhadix (locatie en foto) vóór de berekening.

## Tests

- **Automatisch:** 121/121. Nieuw in `tests/eenvoudig.test.ts`:
  - domeinvoorstel en validatie (`.nl`, punycode geweigerd);
  - de uitkomsten van de controle (404, 200, 429, storing), de wachttijd en het onthouden;
  - via de API: controle op de server tegen een nep-RDAP, keuzes lezen en schrijven, de
    homepagefoto heen en terug, zon/schaduw (ja zonder foto en een foto van een ander project
    geweigerd), de organisatiescheiding (404/403), en de zichtbaarheid in het besluitenlog.
- **Uitrol test:** 0 lopende verwerkingen vooraf, gezond, gegevens door de uitrol ongewijzigd.
- **End-to-end op test,** met het bestaande testproject Markt 27 (geen nieuwe import):

  | Controle | Resultaat |
  |---|---|
  | Adres uit het project | "Markt 27, 8471 AS Wolvega" → voorstel `markt27.nl`, bewerkbaar ✓ |
  | Live controle | `markt27wolvega.nl` beschikbaar; `markt27.nl` bezet; één poging liep tegen de time-out en is eerlijk als "niet mogelijk" vastgelegd ✓ |
  | Homepagefoto | 34 miniaturen met pagina en volgnummer; gekozen en opgeslagen (`openingsbeeld_id`), gemarkeerd; ongeschikte foto's niet te kiezen ✓ |
  | Zon/schaduw | Ja + foto (pagina 4, foto 1 van 2) vastgelegd met adres ✓ |
  | Responsief | tablet en mobiel zonder horizontaal scrollen ✓ |
  | Rhadix-beheer | blok "Keuzes makelaar" toont alles; beoordeling: openingsbeeld gekozen, besluitenlog met domeinwens, zon/schaduw en openingsbeeld ✓ |
  | Andere organisatie | `GET keuzes` 403, `POST domein` 403 ✓ |

  Gedaan met een platformbeheer-testsessie, met de interface getoond als makelaar van het gekoppelde
  kantoor.

## Aandachtspunten voor 3A.3

- **Norm voor de homepagefoto:** bij Markt 27 voldeed maar 1 van de 34 foto's aan de bestaande norm
  (liggend, ≥ 1200 px breed). Brochurefoto's zijn vaak kleiner. Kiest Rhadix voor een lagere norm of
  voor betere bronbeelden?
- **Volgorde bij een gekozen homepagefoto:** de makelaar kan een homepagefoto kiezen terwijl een
  eerdere keuze van Rhadix bestond. Het laatste besluit telt; alles staat in het log.
- **Fotokeuze en definitief domein:** het besluit "zon/schaduw ja" zonder foto wordt pas vastgelegd
  bij het kiezen van een foto. Het definitieve domein vastleggen blijft een stap voor Rhadix.
- **Testgegevens:** het testproject Markt 27 bevat nu keuzes (domeinwensen, homepagefoto, zon/schaduw).
  Niet opgeschoond, zoals afgesproken.
- **Tijdelijke firewallregel:** TCP 22 vanaf 77.165.193.32 staat nog open.
