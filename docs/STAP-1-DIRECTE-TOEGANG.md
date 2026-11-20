# Stap 1 – Directe toegang tot het Makelaarsportaal

**Status:** afgerond en geaccepteerd op 20-11-2026 (staging/test). **Niet** in productie.

## Doel

Een makelaar opent het Makelaarsportaal rechtstreeks, logt in met het bestaande Rhadix-account en komt
direct op het overzicht Woningprojecten. Zonder de website van Rhoderlanden Groep en zonder het
algemene Rhadix-applicatieoverzicht.

## Wijziging

| Onderdeel | Wijziging | Commit (staging) |
|---|---|---|
| Rhadix-platform (Datavalidatie), frontend | `?app=rhadix-makelaarsportaal`: direct het inlogscherm ("Inloggen bij Rhadix Makelaarsportaal"), geen landingspagina, geen "Terug naar appkeuze". Na inloggen of bij een geldige sessie direct door naar het vaste adres van het portaal, alleen als de app is uitgerold en in de apps-claim van de gebruiker zit (bestaande regel `appStatus`). Anders gewoon het overzicht. | Rhadix-datavalidatie `ab008cc` |
| Rhadix-platform, uitloggen | `GET /api/auth/logout?app=rhadix-makelaarsportaal`: sessie intrekken zoals altijd, daarna naar `PUBLIC_BASE_URL/?app=rhadix-makelaarsportaal` (het inlogscherm van het portaal). | Rhadix-datavalidatie `ab008cc` |
| Makelaarsportaal | `/api/inlogopties` levert `inloggen` = `<platform>/?app=<slug>`; `/api/ik` levert `uitloggen` = `<platform>/api/auth/logout?app=<slug>`. Inlogscherm gebruikt die ingang. | rhadix-makelaarsportaal `2aad652` |

Ongewijzigd: inlogsysteem, gebruikers, organisaties en organisatie-ID's, kantoorkoppeling op
`tenant_id`, rollen, autorisatie (apps-claim, RLS, DB-triggers), sessieduur en infrastructuur.

**Geen open redirect:** de URL-parameter bevat alleen een slug, nooit een adres. Alleen slugs uit een
vaste lijst worden herkend (frontend `lib/directeToegang.js`, backend `DIRECTE_APP_SLUGS`). Het
doeladres komt uit de vaste configuratie van het platform.

## Testresultaten

### Automatisch

| Repository | Resultaat |
|---|---|
| Rhadix-datavalidatie backend | volledige suite groen (Python 3.12), waarvan 3 nieuwe uitlogtests (bekende slug, onbekende/kwaadaardige waarden, sessie echt ingetrokken) |
| Rhadix-datavalidatie frontend | `npm test` 99/99 (6 nieuw: doorstuurregel), `test:render` 28/28, lint schoon, build ok; GitHub CI `ab008cc` groen, deploy staging geslaagd |
| rhadix-makelaarsportaal | 114/114 tests, typecheck en build ok |

### Uitrol test

`makelaarsportaal-test` op `2aad652`. Vlak vooraf gecontroleerd: 0 lopende verwerkingen. Databasedump
vooraf, gezondheidscontrole ok, database-container niet opnieuw aangemaakt. Rollback: `deploy/uitrollen.sh
portaal@<server> makelaarsportaal-test 977ef15` (images aanwezig).

### End-to-end (browser, staging/test, 20-11-2026)

| # | Controle | Resultaat |
|---|---|---|
| 1 | Portaal rechtstreeks openen zonder sessie | inlogscherm portaal; `/api/ik` 401; knop naar `app-staging.rhadix.nl/?app=rhadix-makelaarsportaal` ✓ |
| 2 | Klik "Inloggen via Rhadix" | direct "Inloggen bij Rhadix Makelaarsportaal", geen landingspagina, geen applicatieoverzicht ✓ |
| 3 | Inloggen met het testmakelaarsaccount (door opdrachtgever) | direct het overzicht Woningprojecten, geen tussenstap ✓ |
| 4 | Onbevoegde gebruiker (synthetisch zorg-testaccount, ORG_USER, zonder Makelaarsportaal) | niet doorgestuurd; platform toont "Geen toegang" op de tegel; portaal `/api/ik` en `/api/projecten` 403 met melding, ook bij rechtstreeks openen ✓ |
| 5 | Uitloggen via `logout?app=` | SSO-cookie ingetrokken; portaal daarna 401; gebruiker op het inlogscherm van het portaal ✓ |
| 6 | Open-redirectpogingen (`?app=https://…`, `?app=//…`, `?app=uitvraag`, kwaadaardige waarden op logout) | genegeerd; altijd het eigen platform ✓ |
| 7 | Andere Rhadix-applicaties (staging en productie) | ongewijzigd bereikbaar ✓ |

## Productiegereedheid (gecontroleerd 20-11-2026, niets uitgevoerd)

De code is af en getest. Voor productie zijn nog besluiten en voorbereidingen nodig:

1. **Release van Datavalidatie.** `staging` loopt 29 commits voor op `main`. Daaronder vallen, naast
   `ab008cc`, ook `705f093` (portaal als product-app) en `d485a7c` (organisatietype MAKELAAR), die deze
   stap nodig heeft, en losstaand werk met eigen akkoordmomenten: B-16 (tokenintrekking), B-26, B-28,
   B-31, website-aanvragen, B-33. Keuze nodig: volledige release, of een release met alleen de drie
   makelaarsportaal-commits.
2. **Adres van het portaal in de productiebuild.** `VITE_MAKELAARSPORTAAL_URL` wordt in
   `deploy-production.yml` niet meegegeven. Zonder dat adres toont productie de tegel als "niet
   uitgerold" en stuurt de ingang niet door (bewust veilig gedrag). Dit is een wijziging aan een
   workflow, dus apart akkoord nodig.
3. **Productie-instantie van het portaal bestaat nog niet.** Geen DNS (`makelaarsportaal.rhadix.nl`),
   geen `.env` in `/srv/makelaarsportaal`, geen containers. Nodig: `.env` met de publieke sleutel van
   Datavalidatie-productie, `STUDIO_SSO_PLATFORM=https://app.rhadix.nl` en de cookienaam van productie,
   DNS en Cloudflare, en een eerste uitrol.
4. **Inrichting in Datavalidatie-productie:** makelaarsorganisatie (type MAKELAAR), app-toewijzing en
   gebruikers, en de koppeling kantoor ↔ organisatie-ID in het portaal.

Advies: stap 2 en stap 3 eerst op test afronden, en daarna één gecontroleerde productiegang plannen
met punt 1 tot en met 4.

## Vervolg

- Stap 2 – Look & feel: inrichting en vormgeving van het eerste inlogscherm, met de stylesheet van de
  makelaar. Het inlogscherm op het platform is nu gedeeld; alleen de kop is portaalgericht.
- Stap 3 – Vereenvoudiging van het werkproces voor de makelaar.
