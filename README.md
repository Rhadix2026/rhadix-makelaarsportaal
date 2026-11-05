# Makelaarsplatform — Productiestudio

Interne studio waarmee het platformteam van aangeleverd woningmateriaal een woningwebsite maakt.
De studio **bouwt de generator niet na**. Hij stuurt de bestaande generator aan
(`makelaarsplatform-generator`), in een aparte **productie-instantie**: een lokale kloon op een
vaste commit.

**Ontwerp en stappenplan:** `~/Developer/ONTWERP-PRODUCTIESTUDIO-1.0-2026-11-05/` (document 11:
stappenplan MVP 1).

**Status:** stap 2 (inloggen en makelaarskantoren). Alleen lokaal (`127.0.0.1`), geen deployments.

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

## Tests

`npm test` maakt bij elk testbestand een verse database `studio_test` in de studio-container. De
tests weigeren te draaien tegen een andere database.

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
