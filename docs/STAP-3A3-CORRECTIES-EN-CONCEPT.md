# Stap 3A.3 – Correcties woningpagina en "Conceptwebsite aanmaken"

**Status (20-11-2026):** op test (`258733d`), ter beoordeling. Niet in productie.

| # | Probleem | Oorzaak | Oplossing |
|---|---|---|---|
| 1 | Titel 'test rene' | Handmatige projectnaam uit het aanleverformulier (`project.naam`), getoond als titel | Titel = woningadres + plaats; projectnaam ongewijzigd eronder ("Projectnaam: …"); ook in het dashboard |
| 2a | Domeinveld leeg | Na de import laadde de pagina aanlevering en keuzes los van elkaar; het domeinblok klapte open met de keuzes van vóór de import (nog zonder adres) en hield die lege beginwaarde vast | Alles in één keer laden; voorstel uit adres + plaats (`markt27wolvega.nl`) zolang er geen eigen keuze is |
| 2b | Knop leek niet te werken | Gevolg van 2a: met een leeg veld was de knop uitgeschakeld (geen enkele controle bereikte de server) | Status: voorstel / gecontroleerd·beschikbaar / gecontroleerd·bezet / ongeldig / tijdelijk niet mogelijk; Enter controleert; blokkeert niets |
| 3 | 1 van 34 foto's kiesbaar | Norm van de generator voor brochures: liggend ≥ 1200 px; de Markt 27-foto's zijn 1181 px | Liggend vanaf 800 px kiesbaar; onder 1200 px met waarschuwing "lagere resolutie"; beeldnorm als aanbevolen (niet blokkerend) punt; automatische voorkeur: norm → omslag → buitenopname → breedte |
| 4 | Geen afrondende knop | Niet gebouwd in 3A.2 | Kaart "4. Conceptwebsite": bestaande snelle beoordeling + bestaande conceptgeneratie + bestaande voortgangsbalk; daarna Concept bekijken / Verbeterpunten / Nieuwe conceptversie |

Generator ongewijzigd. De generatormelding "geen liggende foto van minimaal 1200 px" blokkeert het interne concept
niet meer als er bewust een kleinere liggende foto (≥ 800 px) als openingsbeeld is gekozen (`fasen.ts`,
zelfde mechanisme als de publicatierechten); zonder keuze blijft het een blokkade.

## Tests
- Automatisch 123/123, nieuw `tests/makelaarroute.test.ts`: volledige route met makelaarrechten, echte import en twee echte conceptversies.
- Volledige route op test via de interface (project `test 3A.3 route (Claude)`, 66f1c9e4): import ±2 min, live SIDN-controle, foto 1181 px met waarschuwing, zon/schaduw, concept v1 in 40 s, tweede start 409, preview 200 met gekozen homepagefoto, wijziging → v2, geen overloop, andere organisatie 403.
