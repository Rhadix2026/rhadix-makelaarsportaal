# Analyse: databasegebruiker met beperkte rechten voor het Makelaarsportaal

**9 november 2026.** Alleen analyse; er is niets gewijzigd. Dit geldt voor de testomgeving en straks voor productie.

## 1. Huidige situatie

| | `studio` | `studio_app` |
|---|---|---|
| Inloggen | ja (wachtwoord, `scram-sha-256` via het interne netwerk) | nee (`NOLOGIN`) |
| Rechten | **superuser**, BYPASSRLS, CREATEROLE en CREATEDB. Aangemaakt door het Postgres-image (`POSTGRES_USER`) | geen bijzondere rechten; gebonden aan RLS |
| Eigenaar van | alle tabellen, het schema `app`, de 5 `SECURITY DEFINER`-functies | — |
| Gebruikt door | **API en verwerker** (alle verbindingen), migraties, back-up (`pg_dump`), hersteltest | alle gebruikersverzoeken, via `SET LOCAL ROLE studio_app` in `alsGebruiker()` |

**Waarom het nu werkt zoals het werkt:**
- **Gebruikersverzoeken** lopen al onder de beperkte rol `studio_app` en zijn begrensd door RLS (11 tabellen met
  `FORCE ROW LEVEL SECURITY`) en de bewakingstriggers. Die scheiding is goed.
- **Systeemwerk** loopt bewust zonder RLS via de systeemverbinding (`pool.query`, ±22 plekken). Het gaat om:
  - inloggen en sessies;
  - het aanmaken van Rhadix-gebruikers (SSO);
  - de verwerkingswachtrij en het vastleggen van importresultaten;
  - de migraties.

  Dat systeemwerk draait nu als **superuser**.
- **De `SECURITY DEFINER`-functies** (`app.is_platformbeheer()`, `app.mijn_kantoren()` en dergelijke) draaien als hun
  eigenaar. Omdat de tabellen `FORCE ROW LEVEL SECURITY` hebben, werken ze alleen doordat die eigenaar RLS mag omzeilen.
  Nu is dat de superuser.

## 2. Risico van de huidige opzet

**Wat het risico beperkt:**
- de database is alleen bereikbaar via het interne Docker-netwerk (geen open poort);
- alle queries zijn geparametriseerd;
- het wachtwoord is net vervangen.

**Wat een superuser extra mogelijk maakt,** als de API of de verwerker ooit wordt misbruikt (bijvoorbeeld via een fout
in een afhankelijkheid):
- opdrachten uitvoeren in de databasecontainer (`COPY … PROGRAM`);
- bestanden lezen en schrijven;
- rollen aanmaken of wijzigen;
- `ALTER SYSTEM`;
- RLS volledig uitschakelen.

**Beoordeling:** het risico is laag zolang alleen de test draait. Vóór productie, met echte kantoren en woningdata, is
het wél aan te raden om de rechten te beperken (*defence in depth*).

## 3. Voorstel (niet uitgevoerd)

Drie rollen in plaats van één:

| Rol | Inloggen | Rechten | Gebruikt door |
|---|---|---|---|
| `studio` (bestaand) | ja, alleen lokaal in de container | superuser, blijft **eigenaar** | alleen beheer: migraties bij een uitrol, back-up, hersteltest. Niet meer door de draaiende API of verwerker |
| `studio_systeem` (nieuw) | ja, via het interne netwerk | **geen** superuser, geen DDL, geen CREATEROLE; wel **BYPASSRLS** voor het systeemwerk; `SELECT/INSERT/UPDATE/DELETE` op de tabellen en `USAGE` op de sequences; lid van `studio_app` (voor `SET ROLE`) | API en verwerker |
| `studio_app` (bestaand) | nee | ongewijzigd | gebruikersverzoeken, via `SET LOCAL ROLE` |

**Wat er moet gebeuren:**
1. **Een migratie (012):**
   - `CREATE ROLE studio_systeem LOGIN NOSUPERUSER BYPASSRLS NOCREATEROLE NOCREATEDB`;
   - `GRANT studio_app TO studio_systeem`;
   - DML-rechten op alle tabellen en sequences in `public` en `app`, plus `EXECUTE` op de functies;
   - `ALTER DEFAULT PRIVILEGES`, zodat nieuwe tabellen uit latere migraties ook meegaan.
   - De `SECURITY DEFINER`-functies blijven eigendom van `studio`; ze blijven dus werken.
2. **Configuratie:**
   - een tweede verbinding: `STUDIO_DB_URL` (systeemrol, voor de API en de verwerker) en `STUDIO_DB_MIGRATIE_URL`
     (eigenaar, alleen voor `migreer()`);
   - in `compose.yml` een eigen geheim `MP_DB_SYSTEEM_WACHTWOORD`;
   - migraties draaien bij een uitrol als aparte stap met de eigenaarsverbinding, of bij de start, maar alleen met
     de migratie-URL.
3. **Controle in de code:** de bewakingstriggers kijken naar `current_user = 'studio_app'`. Dat blijft gelijk, want
   gebruikersverzoeken draaien nog steeds als `studio_app`.
4. **Back-up en hersteltest** blijven `studio` lokaal gebruiken. Daar verandert niets.
5. **Tests:**
   - de volledige testsuite draaien met de systeemrol;
   - een extra test dat de systeemrol geen DDL kan uitvoeren, geen `COPY … PROGRAM` en geen rollen kan beheren;
   - een test dat de RLS-scheiding ongewijzigd is.

**Omvang en volgorde:**
- ±½–1 dag, inclusief tests, uitrol op test en controle;
- volgorde: eerst test, daarna in de productie-inrichting meenemen;
- **advies:** uitvoeren **vóór de livegang van productie**. Op test is het niet dringend.

## 4. Aanvullende bevinding

**Wat:** het Postgres-image vertrouwt verbindingen **binnen de databasecontainer zelf** zonder wachtwoord
(`trust` voor `local` en `127.0.0.1` in `pg_hba.conf`). Verbindingen via het netwerk (API, verwerker) vragen wel een
wachtwoord (`scram-sha-256`).

**Gevolgen:**
- dit is de gebruikelijke standaard van het image, en die vertrouwensplek is alleen bereikbaar voor wie al in de
  container zit;
- de back-up en hersteltest leunen hierop;
- **wachtwoordcontroles moeten altijd via het netwerk** (zoals bij de rotatie van 9-11), niet via `127.0.0.1` in de
  container. Dat geeft anders een vals "geldig".
