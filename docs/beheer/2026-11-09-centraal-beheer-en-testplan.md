# Centraal Rhadix-beheer en Makelaarsportaal: overzicht en testplan

**9 november 2026.**
- **Bron:** Datavalidatie `origin/staging` (`d485a7c`) en het Makelaarsportaal (`1ae95ae`, testomgeving). Alleen
  gelezen; er is niets gewijzigd.
- **Omgevingen:** Rhadix-beheer op `app-staging.rhadix.nl`, het portaal op `makelaarsportaal-test.rhadix.nl`.

**Legenda:** ✅ aantoonbaar werkend (getest) · 🔍 aanwezig, nog niet getest · ⚠️ tekortkoming of aandachtspunt.

## 1. Overzicht per onderdeel

### 1.1 Organisaties en type Makelaarskantoor

| Functie | Waar | Wie | Status |
|---|---|---|---|
| Organisatie aanmaken, met type Zorgorganisatie, RSO of **Makelaarskantoor** | Platform overzicht → Organisaties → "+ Organisatie toevoegen" | RHADIX_ADMIN | ✅ (MAKELAAR: backend-tests en jouw testorganisatie) |
| Makelaarskantoor nooit onder een RSO | API (422) en scherm (geen RSO-keuze) | — | ✅ (tests) |
| Organisatie-ID en type tonen in het detail | Organisaties → Detail | RHADIX_ADMIN | 🔍 (in het scherm nog niet door jou bekeken) |
| Organisatie (de)activeren: zet ook alle gebruikers op dezelfde status | Organisaties → Deactiveren | RHADIX_ADMIN | 🔍 |
| Organisatie verwijderen (met impactoverzicht) | Organisaties → Verwijderen | RHADIX_ADMIN | 🔍 (niet doen op de testorganisatie) |
| Naam, slug of type wijzigen na het aanmaken | — | — | ⚠️ Kan niet. Er is geen wijzigroute; type en slug liggen vast |

### 1.2 Gebruikers, uitnodigingen en wachtwoorden

| Functie | Waar | Wie | Status |
|---|---|---|---|
| Gebruiker aanmaken in een organisatie, **met wachtwoord** | Organisaties → Detail (platform); Organisatiebeheer (eigen organisatie) | RHADIX_ADMIN, ORG_ADMIN | ✅ (tests: licentiegrens en claim) |
| **Uitnodigen per e-mail** (gebruiker kiest zelf het wachtwoord) | — | — | ⚠️ **Niet aangesloten.** De e-mailtemplate en `set-password` bestaan, maar geen route maakt een uitnodigingstoken aan. Een beheerder kiest dus het eerste wachtwoord en moet dat zelf doorgeven |
| Wachtwoord vergeten (resetlink per e-mail) | Inlogscherm | iedereen | 🔍 (hangt af van de mailinstellingen op staging) |
| Wachtwoord resetten door een beheerder | Gebruikersrij → Resetten | RHADIX_ADMIN, ORG_ADMIN (eigen organisatie), RSO_ADMIN | 🔍 |
| Eigen wachtwoord wijzigen | Organisatiebeheer → Wachtwoord wijzigen | iedereen | 🔍 |
| Gebruiker (de)activeren of verwijderen | Gebruikersrij | RHADIX_ADMIN, ORG_ADMIN | 🔍 |
| Wachtwoordeisen | backend | — | ⚠️ Niet overal gelijk. Platform en RSO: volledige eis (12 tekens + hoofdletter, kleine letter, cijfer, teken). Organisatiebeheer: alleen ≥ 12 tekens. Het platformscherm toont "Min. 8 tekens" |

### 1.3 Rollen en autorisaties

| Rhadix-rol | In Rhadix | In het Makelaarsportaal | Status |
|---|---|---|---|
| RHADIX_ADMIN | alles, platformbreed | platformbeheer (alle kantoren) | ✅ (jij, admin) |
| ORG_ADMIN | gebruikers en apps van de eigen organisatie, licentie inzien | **kantoorbeheerder**: productie, kantoorgegevens, huisstijl, definitief domein, concepten beoordelen | ✅ (rene makelaar, meetrondes) |
| ORG_USER | gebruiken | **makelaar**: productie tot en met concept genereren; niet beoordelen, geen domein, geen kantoorbeheer | ✅ (tests) · 🔍 (in het scherm nog niet met een echt ORG_USER-account) |
| RSO_ADMIN | aangesloten organisaties beheren | geen toegang (melding) | ✅ (tests) |

**Afdwinging in het portaal:** in de interface, de API en de database (RLS en triggers). Er zijn 97 tests. ✅

**Rollen toekennen:**
- de ORG_ADMIN kan alleen ORG_USER en ORG_ADMIN toekennen;
- de laatste beheerder van een organisatie kan niet worden gedegradeerd. ✅ (Rhadix-tests)

### 1.4 Applicatietoewijzing

| Functie | Waar | Wie | Status |
|---|---|---|---|
| "Rhadix Makelaarsportaal" toewijzen aan een organisatie, optioneel meteen aan de bestaande gebruikers | Organisaties → Detail → Applicaties | RHADIX_ADMIN | ✅ (jouw testorganisatie) |
| Per gebruiker toewijzen of intrekken, binnen wat de organisatie heeft | Organisatiebeheer → gebruiker → Apps | ORG_ADMIN | 🔍 |
| Tegel "Rhadix Makelaarsportaal" in het Rhadix-portaal | Startscherm na inloggen | iedereen met de app | ✅ |
| Toegang tot het portaal **alleen** via de apps-claim (doorsnede van organisatie- en gebruikerstoewijzing) | — | — | ✅ (tests, geen rol-bypass) |

### 1.5 Licenties en gebruikerslimieten

| Functie | Waar | Wie | Status |
|---|---|---|---|
| Licentie per organisatie: geldig van/tot, maximum aantal actieve gebruikers, notities | Platform overzicht → Licenties | RHADIX_ADMIN | ✅ (tests: harde grens bij aanmaken en heractiveren) |
| Eigen licentie inzien | Organisatiebeheer | ORG_ADMIN | 🔍 |
| Verlopen licentie blokkeert nieuwe en heractiveerde gebruikers | backend | — | ✅ (tests) |
| Verlopen licentie en **toegang** van bestaande gebruikers | — | — | ⚠️ Bewuste keuze in Rhadix: bestaande gebruikers houden toegang. Het portaal kijkt **niet** naar de licentie; alleen de apps-claim telt. Een verlopen licentie stopt het gebruik van het portaal dus niet |

### 1.6 Logo's, woordmerken en organisatiekleuren

| Functie | Waar | Wie | Status |
|---|---|---|---|
| Huisstijl per organisatie: preset, primaire kleur, accentkleur, woordmerk, logo-upload; overerving van organisatie via RSO naar platform | Organisaties → Detail → Huisstijl | **alleen RHADIX_ADMIN** | ✅ (backend-test bij MAKELAAR) · 🔍 (scherm) |
| Huisstijl zelf beheren als organisatie | — | — | ⚠️ Kan niet. ORG_ADMIN heeft geen huisstijlroutes; Rhadix stelt de huisstijl voor het kantoor in |
| Doorwerking naar de **interface** van het portaal (kleuren, woordmerk, logo in de kopbalk) | via de login-claim | — | ✅ (tests) · 🔍 (met een echt logo en echte kleuren op staging) |
| **Kantoorhuisstijl voor de woningwebsites** (logo, merkkleur, detailkleur) | Portaal → Kantoren → kantoor → Logo en huisstijl | kantoorbeheerder | ✅ (rollen-tests) · ⚠️ Staat los van de Rhadix-huisstijl en wordt niet automatisch overgenomen |

### 1.7 Doorwerking van de organisatie-instellingen naar het Makelaarsportaal

| Wijziging in Rhadix | Effect in het portaal | Wanneer | Status |
|---|---|---|---|
| Nieuwe makelaarsorganisatie met de app | De organisatie verschijnt bij platformbeheer; **een kantoor aanmaken en koppelen op organisatie-ID is handwerk** | bij de eerste login | ✅ (jouw testorganisatie) |
| Rol van een gebruiker gewijzigd | Lidmaatschap en rol volgen | bij de volgende login (nieuw token) | ✅ (tests) |
| Gebruiker naar een andere organisatie | Het lidmaatschap verhuist mee | bij de volgende login | ✅ (tests) |
| Gebruiker of organisatie gedeactiveerd, of app ingetrokken | Geen nieuwe login meer | ⚠️ Een **al uitgegeven token blijft tot 60 min geldig** in het portaal. Het portaal is nog geen ontvanger van de centrale intrekking (B-16) | ✅ (tests: tokencontrole) |
| Huisstijl gewijzigd | Kopbalk past zich aan | bij de volgende login | 🔍 |
| Organisatienaam gewijzigd | De naam in de koppellijst van het portaal volgt; de **kantoornaam** in het portaal niet | — | ⚠️ In Rhadix is de naam niet te wijzigen (zie 1.1) |
| Token verlopen (60 min) | Het portaal geeft "niet ingelogd"; opnieuw inloggen bij Rhadix | elk uur | 🔍 (gebruiksgemak) |

## 2. Overige controles van vandaag

### 2.1 Databasewachtwoord van de testomgeving

**Uitkomst:** gecontroleerd zonder de waarde te lezen of te tonen, op vingerafdruk en met verbindingstests.

| Controle | Uitkomst |
|---|---|
| Het wachtwoord in `.env` gelijk aan dat in de draaiende API en verwerker | ja |
| Nieuwe databaseverbindingen (met `.env`, vanuit de API, vanuit de verwerker) | lukken |
| `.env` voor het laatst gewijzigd | 9-11 om 13:33 UTC (verwerkergrens, één regel) |
| Het wachtwoord in `.env` gelijk aan de reservekopieën `.env.voor-sso` (6-11) en `.env.voor-5g` | **ja** |
| De database accepteert de waarde van vóór 9-11 | **ja** |

**Conclusie:** het databasewachtwoord van **deze** server is niet gewijzigd. Mogelijk is een ander wachtwoord gewijzigd
(lokaal, of in Rhadix).

**Wijzigen** vergt drie stappen samen:
1. `ALTER ROLE studio PASSWORD …` in de database;
2. het nieuwe wachtwoord in `/srv/makelaarsportaal-test/.env`;
3. de API en de verwerker opnieuw starten.

Daarna de twee reservekopieën verwijderen, want die bevatten de oude waarde. Dit gebeurt alleen met akkoord.

### 2.2 Opgeschoonde tijdelijke bestanden

**Verwijderd:**
- de oude images `6183855`, `080ba65`, `a8aa1b1` en `d3beaa0` (app en web). Die zijn uit git opnieuw te bouwen;
- de volledige Docker-buildcache (27,3 GB).

**Behouden:**
- de actieve versie `1ae95ae`;
- de terugvalversie `cca63f7`, die werkt met de huidige database;
- het Postgres-image en alle volumes;
- de dumps vóór uitrol, de back-ups, het model, de meetbestanden en alle gegevens.

**Resultaat:**

| | Waarde |
|---|---|
| Schijf vóór | 52 GB (36 %) |
| Schijf na | **18 GB (13 %)** |
| Vrijgemaakt | **33 GiB** |
| Containers | ongewijzigd, gezond, niet herstart; `/api/gezond` 200 lokaal en via Cloudflare |

De volgende build op de server duurt langer, omdat de cache opnieuw wordt opgebouwd.

## 3. Testplan via de Rhadix-interface

**Uitvoering:** op Rhadix staging en het testportaal. Gebruik **eigen testadressen**; staging kan e-mails versturen.
Vink per stap af wat je ziet. Ruim een testgebruiker achteraf op via deactiveren. Verwijder geen organisaties.

### A. Organisatie en type (platformbeheer)
1. Platform overzicht → Organisaties → Rhadix testmakelaars → **Detail**. Controle: het type toont
   "makelaarskantoor" en het organisatie-ID is te kopiëren.
2. "+ Organisatie toevoegen" → type **Makelaarskantoor**. Controle: er is geen keuze "Valt onder RSO", en de
   placeholders gaan over een makelaardij. Annuleer, of maak "Testmakelaardij B" als je §F wilt doen.

### B. Gebruikers en wachtwoorden
3. Voeg aan Rhadix testmakelaars een gebruiker toe met **rol ORG_USER** (makelaar). Controle: lukt dit binnen de
   licentie?
4. Log in met die gebruiker → tegel Makelaarsportaal. Controle in het portaal:
   - je ziet "Rhadix testmakelaars" met de rol makelaar;
   - "Nieuw woningproject" is zichtbaar;
   - er is **geen** "Bewerken" bij het kantoor;
   - bij een concept staat **geen** "Verbeterpunten vastleggen".
5. Inlogscherm → **Wachtwoord vergeten** voor die gebruiker. Controle: komt de e-mail aan, en werkt de link?
6. Als ORG_ADMIN (rene makelaar): Organisatiebeheer → de testgebruiker → **Wachtwoord resetten**. Controle: de nieuwe
   inlog werkt en de oude niet.

### C. Rollen
7. Als ORG_ADMIN: zet de testgebruiker op **ORG_ADMIN**. Log de testgebruiker uit en weer in. Controle in het
   portaal: de rol is nu kantoorbeheerder ("Bewerken" bij het kantoor zichtbaar).
8. Probeer jezelf (de laatste ORG_ADMIN) te degraderen. Controle: dat wordt geweigerd, met uitleg.

### D. Applicatietoewijzing
9. Als ORG_ADMIN: trek bij de testgebruiker de app **Makelaarsportaal** in. Laat de gebruiker opnieuw inloggen.
   Controle: geen toegang tot het portaal ("geen toegang"), en de tegel is grijs.
   - **Let op:** een al geopend portaal blijft tot 60 minuten werken (zie 1.7). Noteer na hoeveel minuten de toegang
     vervalt.
10. Wijs de app weer toe en log opnieuw in. Controle: er is weer toegang.

### E. Licentie
11. Platform → Licenties → de licentie van Rhadix testmakelaars: zet **Max. gebruikers** op het huidige aantal
    actieve gebruikers. Probeer nog een gebruiker toe te voegen. Controle: geweigerd, met de melding "maximum bereikt".
    Zet de waarde daarna terug.
12. Als ORG_ADMIN: Organisatiebeheer → Licentie. Controle: alleen lezen, met correcte gegevens.

### F. Huisstijl
13. Platform → Organisaties → Rhadix testmakelaars → **Huisstijl**: stel een primaire kleur, een accentkleur en een
    woordmerk in en upload een logo. Opslaan.
14. Log in als kantoorbeheerder en open het portaal. Controle:
    - de kopbalk toont het woordmerk, het logo en de kleuren;
    - de preview van een concept is níet in die kleuren (dat is de kantoorhuisstijl voor websites, apart).
15. In het portaal: Kantoren → Rhadix testmakelaars → **Logo en huisstijl** (als kantoorbeheerder). Controle: je kunt
    het logo en de kleuren voor de woningwebsites instellen.

### G. Doorwerking en afscherming
16. (Optioneel, met "Testmakelaardij B" uit stap 2.) Wijs de app toe en maak een gebruiker. Log die in. Controle:
    - de melding "nog niet aan een kantoor gekoppeld";
    - als platformbeheer in het portaal: Kantoren → Nieuw kantoor → Rhadix-organisatie koppelen;
    - daarna ziet die gebruiker **alleen** het eigen (lege) kantoor, en niets van Rhadix testmakelaars.
17. Deactiveer de testgebruiker uit stap 3. Controle: inloggen bij Rhadix lukt niet meer. Noteer of een al geopend
    portaal binnen 60 minuten stopt.

## 4. Gesignaleerde tekortkomingen (ter beslissing, niets aangepast)

| # | Punt | Gevolg | Mogelijke oplossing |
|---|---|---|---|
| T1 | Uitnodigen per e-mail is niet aangesloten | De beheerder kiest het eerste wachtwoord en geeft het door | De aanwezige `send_invite` en `set-password` koppelen aan het aanmaken van een gebruiker (Rhadix) |
| T2 | Ongelijke wachtwoordeisen (organisatiebeheer alleen lengte; scherm "Min. 8") | Zwakkere wachtwoorden mogelijk via organisatiebeheer | Overal `validate_password_strength`, de tekst gelijktrekken (Rhadix) |
| T3 | Huisstijl alleen door RHADIX_ADMIN | Kantoren kunnen hun Rhadix-huisstijl niet zelf beheren | Bewuste keuze, of huisstijlroutes voor ORG_ADMIN (Rhadix) |
| T4 | Een verlopen licentie stopt het gebruik van het portaal niet | Gebruik na de einddatum blijft mogelijk | Licentiestatus in het token, of een controle in het portaal |
| T5 | Na deactiveren of intrekken blijft een token tot 60 min geldig | Vertraagde blokkade | Het portaal aansluiten op de centrale intrekking (B-16, als die in productie is) |
| T6 | Nieuwe organisatie: het kantoor koppelen is handwerk | Extra stap voor platformbeheer | Bewust (koppeling op ID); eventueel automatisch aanmaken bij type MAKELAAR |
| T7 | Naam en type van een organisatie zijn niet te wijzigen | Een tikfout is alleen te herstellen door opnieuw aan te maken | Wijzigroute in Rhadix |
| T8 | Het testdatabasewachtwoord is niet gewijzigd (zie 2.1) | De eerder getoonde waarde is nog geldig | Wijzigen in drie stappen, met akkoord |
