# Makelaarsplatform — Productiestudio

Interne studio waarmee het platformteam van aangeleverd woningmateriaal een woningwebsite maakt.
De studio **bouwt de generator niet na**. Hij stuurt de bestaande generator aan
(`makelaarsplatform-generator`), in een aparte **productie-instantie**: een lokale kloon op een
vaste commit.

**Ontwerp en stappenplan:** `~/Developer/ONTWERP-PRODUCTIESTUDIO-1.0-2026-11-05/` (document 11:
stappenplan MVP 1).

**Status:** stap 3 (dashboard en woningprojecten). Alleen lokaal (`127.0.0.1`), geen deployments.

## Onderdelen

| Map | Inhoud |
|---|---|
| `api/src/` | API (Fastify, TypeScript via tsx): `server.ts`, `config.ts`, `db.ts` (migratierunner), `generator.ts` (adapter naar de productie-instantie) |
| `db/migraties/` | Plain-SQL-migraties, in naamvolgorde, elk één keer |
| `web/` | Interface (React + Vite) in de Rhadix-look-and-feel, opnieuw vastgelegd in `web/src/tokens.css` (AB-005: geen gedeelde code) |
| `tests/` | `node --test`-tests |
| `compose.yaml` | Alleen de database: eigen project `makelaarsstudio`, eigen netwerk en volume, `127.0.0.1:5490` |

## Inloggen en gegevensscheiding

- **Inloggen:**
  - eigen accounts met een wachtwoord (scrypt, ingebouwd in Node) en een sessie in een
    HttpOnly-cookie (`SameSite=Strict`, 12 uur);
  - na 5 mislukte pogingen wordt een adres 15 minuten geblokkeerd;
  - geen externe authenticatiedienst.
- **Voorbereid op SSO:** een gebruiker kan in plaats van een wachtwoord een externe identiteit
  hebben (`extern_bron` + `extern_id`). Een latere OIDC-koppeling maakt via `maakSessie()`
  dezelfde sessie aan.
- **Rollen:**
  - `platformbeheer` (op gebruikersniveau) ziet en beheert alle kantoren;
  - per kantoor `makelaar` of `kantoorbeheerder` (lidmaatschap). Die zien alleen hun eigen
    kantoren en wijzigen in de eerste fase niets.
- **Scheiding in de database (Row Level Security):**
  - elke gebruikersvraag loopt via `alsGebruiker()`, onder de rol `studio_app` met
    `app.gebruiker`;
  - zonder ingelogde gebruiker ziet `studio_app` niets;
  - sessies zijn voor `studio_app` onbereikbaar;
  - wijzigingen gaan met oud en nieuw naar de `auditregel`.
- **Systeempagina** (technische status) is alleen voor platformbeheer, los van het dagelijkse
  werk.

### Een gebruiker aanmaken (eenmalig, zelf uitvoeren)

Het wachtwoord wordt verborgen gevraagd en komt niet in de opdrachtregel of de logs:

```bash
npm run gebruiker -- maak --email <adres> --naam "<naam>" --platformbeheer
npm run gebruiker -- maak --email <adres> --naam "<naam>" --kantoor <korte-naam> --rol makelaar
npm run gebruiker -- lijst
npm run gebruiker -- deactiveer --email <adres>     # sessies worden direct beëindigd
```

## Woningprojecten

- **Koppeling:** elk project hoort bij precies één kantoor. Projecten vallen onder dezelfde
  RLS-scheiding: platformbeheer ziet alles, andere gebruikers alleen de projecten van hun eigen
  kantoren.
- **Korte naam (slug):**
  - wordt `<kantoor>-<woning>` en ligt vast na het aanmaken (straks de mapnaam in de
    productie-instantie);
  - de namen van de referentiewoningen en de voorvoegsels `kalibratie-`, `import-` en `probe-`
    worden geweigerd, ook in de database zelf.
- **Ontwerpsysteem:** de standaardversie van de generator, vastgezet bij het aanmaken.
- **Kantoorinstellingen zijn standaardwaarden:** het standaardprofiel van het kantoor wordt bij
  het aanmaken gekopieerd. Een keuze per woning verandert het kantoor niet, en een latere
  kantoorwijziging verandert bestaande projecten niet.
- **Verplicht** zijn alleen het kantoor en de naam; de overige gegevens vult de brochure-import aan.
  Zonder profielkeuze geldt de kantoorstandaard; een bewuste keuze 'Nog niet gekozen' blijft staan.
- **Kantoor wijzigen** kan alleen zolang er nog niets is aangeleverd.
- **Statussen** volgen FO 2.0 §4. In deze stap is elke nieuwe woning `aanlevering_incompleet`;
  statusovergangen komen met de aanlevering en de generatie.

## Aanlevering en brochure-import (stap 4)

- **Aanleveren:** een PDF-brochure en losse foto's (JPEG, PNG, WebP, TIFF; meerdere tegelijk)
  gaan als ruwe inhoud naar `POST /api/projecten/:id/bestanden?soort=brochure|foto`. Het type
  volgt uit de inhoud. Originelen worden byte-voor-byte bewaard op sha256 in de opslag
  (`STUDIO_OPSLAG`, standaard `data/opslag/`, niet in git). Dezelfde foto twee keer levert
  geen tweede bestand op.
- **Verwerking:** een wachtrij met één verwerker (`verwerking`, `SKIP LOCKED`). Het werk
  gebeurt in een kindproces (`api/src/verwerker-kind.ts`), zodat de API bereikbaar blijft. Daarin
  worden de bestaande functies van de productie-instantie rechtstreeks aangeroepen:
  - `importeer()` schrijft in de studio-opslag, nooit in de generator;
  - `controleerAanlevering()`;
  - `SIGLIP.classificeerBeelden()` (lokaal; met `STUDIO_CLASSIFICATIE=uit` overgeslagen).
- **Drie lagen:**
  1. **Brongegevens:** de bestanden en de beelden die de import uit de PDF haalt, met pagina.
  2. **Geëxtraheerd:** het importrapport, per import onveranderlijk bewaard. De vraagprijs wordt
     niet bewaard.
  3. **Vastgelegd:** de tabel `gegeven`. `overgenomen` betekent automatisch aangevuld en nog niet
     goedgekeurd; `goedgekeurd` betekent door ons bevestigd of handmatig ingevoerd. Een
     goedgekeurde waarde wordt nooit automatisch vervangen. Een afwijkende brochurewaarde komt
     als melding op het scherm en kan alleen met bevestiging worden overgenomen.
- **Tegenstrijdigheden:** `conflict` van de generator geldt als inhoudelijke tegenstrijdigheid,
  `onduidelijk` als mogelijke terminologische afwijking. Een van beide wordt pas opgelost met een
  expliciet besluit: bevestiging plus motivering, bewaard in `gegeven.besluit`. De server dwingt dit af.
- **Meldingen** (`api/src/beoordeling.ts`) staan in drie niveaus:
  - blokkerend: moet opgelost zijn vóór het genereren;
  - aandachtspunt: vraagt een menselijke beoordeling;
  - informatief: geen handeling nodig.
- **Bulkgoedkeuring** (`POST …/gegevens/bulkgoedkeuring`): de server kiest alleen overgenomen
  gegevens zonder enig signaal. Tegenstrijdigheden, terminologische afwijkingen, afwijkingen van de
  brochure en lagere zekerheid blijven over voor een afzonderlijke beoordeling.
- **Fotokwaliteit:** per foto en in totaal, volgens de norm van de generator voor originelen (EIS:
  1200 px; 1600 px liggend voor het openingsbeeld). Een brochurebeeld onder de norm telt als
  "origineel nog aan te leveren".
- **Bestandsnamen:** op het scherm een korte naam (`web/src/onderdelen/bestandsnaam.ts`).
  Technische namen worden vervangen door een omschrijving; de volledige naam blijft bewaard en
  staat in de tooltip.
- **Dubbele foto's:** dHash met dezelfde drempel als de generator (≤ 6). Het beeld met de
  meeste pixels blijft; bij gelijke kwaliteit gaat de losse foto voor. Zonder losse foto's worden
  de brochurefoto's gebruikt.
- **Opslaan:** `POST /api/projecten/:id/aanleveringen` maakt een genummerde momentopname. Er
  wordt geen website gegenereerd en de status verandert niet.
- **Kantoorhuisstijl:** het logo uploaden, of het logo uit de brochure overnemen. De kleuren
  worden afgeleid met `logoKleuren()` en `huisstijlVoorstel()` van de generator, met een
  contrast van minimaal 4,5:1 per profiel. Lege kleuren worden aangevuld; ingestelde kleuren
  blijven staan tot het voorstel wordt bevestigd.
- **Scheiding:** `bestand`, `verwerking`, `gegeven` en `aanlevering` hebben elk een
  `kantoor_id` met RLS. Een trigger dwingt af dat dit gelijk is aan het kantoor van het project.

## Broncontrole, kwaliteitscontrole en vrijgave (stap 5)

- **Vier fasen:** aanlevering → broncontrole → kwaliteitscontrole → vrijgave voor
  conceptgeneratie (`#/projecten/:id/beoordeling`). Per fase zie je de status en de openstaande
  punten. Elk open punt zegt welke handeling nodig is (`api/src/controle.ts`, `beoordeling()`).
- **Broncontrole:** tellingen van overgenomen, gecontroleerd, gecorrigeerd en afgewezen
  gegevens, opgeloste tegenstrijdigheden en wat ontbreekt. Alleen gegevens die nog beoordeeld
  moeten worden, staan open; vastgestelde gegevens hoeven niet opnieuw. Een brochuregegeven kan
  gemotiveerd worden **afgewezen** (status `afgewezen`); het komt dan niet in de export.
- **Kwaliteitscontrole** (`POST /api/projecten/:id/kwaliteitscontrole`):
  - de studio zet de vastgelegde gegevens om naar het aanleverformaat van de generator
    (`woning.json`, `teksten.md`, `fotos.csv`, `fotos/`, `plattegronden/`, logo) in de opslag;
  - daarop lopen de bestaande controles: `controleerAanlevering()`, `naarManifest()` met het
    manifestschema van de generator, `controleerFeiten()` en `controleerTaal()`;
  - bedragen in de teksten worden gemeld als aandachtspunt;
  - het resultaat wordt bewaard als `verwerking` (soort `kwaliteitscontrole`), met een
    vingerafdruk van de stand. Na elke wijziging is de controle verouderd.
- **Beslissingen op projectniveau** (`PUT …/beslissingen/:onderwerp`): publicatierechten (met
  toelichting), presentatieprofiel, websiteadres (domein of tijdelijk `<slug>.invalid`),
  openingsbeeld (liggend en groot genoeg) en het accepteren van de fotokwaliteit voor een eerste
  concept.
- **Besluitenlog** (tabel `besluit`): wie, wanneer, wat en waarom, voor elke menselijke
  beslissing. Het log wordt alleen aangevuld; de rol `studio_app` mag niet wijzigen of verwijderen.
- **Snelle beoordeling** (`POST /api/projecten/:id/snelle-beoordeling`): met de expliciete
  verklaring "Neem de aangeleverde brochuregegevens en overige broninformatie over als uitgangspunt
  voor het eerste concept" in één handeling: bronovername, de verplichte keuzes (voorstellen van de
  import als standaard), de kwaliteitscontrole en de vrijgave. Elke stap is een eigen besluit.
  De bronovername legt wie, wanneer en de bronversie (import, sha256) vast en geldt alleen voor die
  bronversie. **Overnemen is geen verificatie:** de gegevens blijven `overgenomen` en gaan als
  onbevestigd mee. De uitgebreide beoordeling blijft beschikbaar.
- **Vrijgave:** alleen als alle verplichte controles zijn afgerond. De status wordt
  `klaar_voor_productie`: gereed voor een eerste concept, **geen publicatie**. Er wordt niets
  gegenereerd. Elke latere wijziging van gegevens, bestanden of projectbeslissingen laat de
  vrijgave vervallen; dat regelt een databasetrigger.
  Het kantoor van een project ligt vast zodra er iets is aangeleverd.

## Conceptgeneratie en preview (stap 6)

- **Eén actie** (`POST /api/projecten/:id/concepten`, scherm `#/projecten/:id/concept`), alleen na de
  vrijgave en met alle verplichte controles afgerond. De generatie loopt via de wachtrij in een kindproces:
  1. export van de vastgelegde gegevens naar het aanleverformaat (zoals bij de kwaliteitscontrole);
  2. `controleerAanlevering()` + `naarManifest()` van de generator. De woningmap staat in de
     studio-opslag, niet in `woningen/` van de productie-instantie;
  3. de beeldclassificatie uit de aanlevering wordt hergebruikt, met `altUitCategorie()`;
  4. `mp bouw <woningmap> --uit <site>`: de bestaande **automatische compositie**;
  5. `mp kwaliteit <woningmap> --uit <site>`: het kwaliteitsrapport van **Design System 1.0**
     (ontwerp, taal, keuring met axe, LCP, CLS en externe verzoeken).
- **Versies:** elke generatie is een nieuwe map `projecten/<id>/concepten/v<n>/` en een rij in `concept`.
  Een versie wordt nooit overschreven: de rol `studio_app` mag alleen de beoordeling bijwerken en
  niets verwijderen. Runbestanden die `mp` in `.cache/` en `metingen/` van de productie-instantie
  achterlaat, worden naar `v<n>/generator-log/` verplaatst.
- **Preview:** `/api/voorbeeld/<token>/`, met een geheim token per versie. De pagina staat in een
  sandbox (`allow-scripts`, anonieme herkomst, geen cookies, geen referrer, niet indexeren). Het
  scherm toont desktop (1440), tablet (768) en mobiel (390).
- **Beoordeling:** accepteren, of verbeterpunten per onderdeel vastleggen. Beide komen in het
  besluitenlog; bij verbeterpunten gaat de status naar `correctie`. Daarna kan een nieuwe versie worden gemaakt.
- **Metingen per versie** (`api/src/tijd.ts`), afzonderlijk:
  - **machinetijd:** import, kwaliteitscontroles en conceptgeneratie per stap;
  - **actieve gebruikerstijd:** uit interactiemomenten (tabel `activiteit`, hoogstens één per 30 s
    per scherm, alleen bij een zichtbaar venster) plus uploads, aanvragen en besluiten. Per gebruiker
    tellen alleen tussenpozen tot de inactiviteitsgrens (`STUDIO_INACTIVITEIT_MIN`, standaard 5).
    Betrouwbaar alleen als de interacties vanaf de eerste handeling zijn geregistreerd; anders als
    indicatie (ondergrens) gemarkeerd;
  - **kalenderdoorlooptijd:** eerste upload tot het concept, inclusief stilstand.
  De ambitie van 15 minuten wordt getoetst aan machine + actief, alleen als de actieve tijd
  betrouwbaar is. Versies van vóór de tijdregistratie houden hun opgeslagen metingen; het scherm
  markeert ze en toont de actieve tijd als achteraf afgeleide indicatie (niet opgeslagen).
- **Uitgangspunten per versie** (`concept.uitgangspunten`): de bronovername (wie, wanneer, welke
  bronversie) en de open onzekerheden met de gebruikte waarde, vastgelegd bij het genereren.
- **Kwaliteitsmeldingen:** per categorie (fotografie, inhoud en feiten, tekstkwaliteit, vormgeving en
  techniek), eerst een samenvatting met aantallen en prioriteit; per melding of actie nodig is voor de
  conceptgeneratie, de publicatie of geen van beide. Technische details zijn uitklapbaar
  (`api/src/indeling.ts`; alleen presentatie, de rapporten blijven ongewijzigd).
- **Blokkeerregels:** de conceptgeneratie wordt alleen geblokkeerd door kritische ontbrekende gegevens,
  ontbrekende verplichte keuzes, een ontbrekende bronovername of beoordeling, en blokkades in de
  kwaliteitscontrole. Inhoudelijke tegenstrijdigheden, terminologische afwijkingen, niet afzonderlijk
  gecontroleerde gegevens en de fotokwaliteit blokkeren het interne concept niet: de vastgelegde
  waarde gaat als onbevestigd mee en blijft zichtbaar. Vóór publicatie zijn ze verplicht.
- **Financiële gegevens:** de VvE-bijdrage en servicekosten in de brochuretekst worden een feit met
  bron, met `publiceren = false`. Ze komen niet in het manifest. De brochuretekst blijft ongewijzigd
  (geen automatische tekstcorrectie); de makelaar beslist.

## Tests

- `npm test` maakt bij elk testbestand een verse database `studio_test` in de studio-container.
- **Borging in drie lagen:**
  - de configuratie weigert onder de testrunner (`NODE_TEST_CONTEXT`) of met `STUDIO_TEST=1`
    elke andere database dan `studio_test`;
  - `tests/hulp.ts` controleert de verbonden database;
  - `tests/borging.test.ts` toetst beide.
- **Regressie** (`tests/borging.test.ts`): de generator en de productie-instantie staan op de
  vaste commit met een schone werkmap, en de referentiemanifesten en de goedgekeurde concepten
  zijn byte-gelijk.

## Gescheiden van Rhadix

| Wat | Studio | Rhadix (in gebruik, niet aanraken) |
|---|---|---|
| Compose-project | `makelaarsstudio` | `rhadix-v127`, `rhadix-v131` |
| Container | `makelaarsstudio-db` | `rhadix-v1xx-*` |
| Netwerk / volume | `makelaarsstudio_net` / `makelaarsstudio_db` | eigen |
| Poorten | 5480 (web), 8480 (API), 5490 (db), alleen 127.0.0.1 | 5174, 5175, 5433, 5435, 8001, 8010 |

## Gebruik

```bash
nvm use                      # Node 24.22.0
cp .env.voorbeeld .env       # eenmalig; vul een eigen databasewachtwoord in (STUDIO_DB_WACHTWOORD en STUDIO_DB_URL)
npm ci
npm run db:start             # alleen de studio-database
npm run dev                  # API op 127.0.0.1:8480 en interface op http://127.0.0.1:5480
npm test                     # vereist een draaiende studio-database
npm run typecheck && npm run build
npm run db:stop              # database stoppen (gegevens blijven in het volume)
```

## Productie-instantie van de generator

```bash
git clone ~/Developer/makelaarsplatform-generator ~/Developer/makelaarsplatform-productie
cd ~/Developer/makelaarsplatform-productie && git checkout --detach 4eb7f2cc3f91
npm ci
# lokaal kopiëren (geen download): Chromium en de SigLIP-omgeving uit de ontwikkelrepo
cp -c -R ../makelaarsplatform-generator/.cache/ms-playwright .cache/
cp -c -R ../makelaarsplatform-generator/.cache/ai/{venv,hf} .cache/ai/
```

- **Vaste versie:** de studio meldt het als de instantie niet op de vastgezette commit
  (`api/src/generator.ts`, `VERWACHTE_COMMIT`) staat of als de werkmap gewijzigd is.
- **Bijwerken:** een update van de instantie is een bewuste stap, na de regressie in de
  generator (versie 0 identiek, de tests groen).

## Lettertype

Oxanium, Copyright 2019 The Oxanium Project Authors, SIL Open Font License 1.1
(`web/public/fonts/Oxanium-OFL.txt`).
