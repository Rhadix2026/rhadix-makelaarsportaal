# Gebruikers en rollen (optie A)

**Status (20-11-2026):** lokaal gebouwd en getest (132/132). Niet op test of productie; uitrol pas na akkoord.

## Uitgangspunt

Gebruikers, rollen, licenties en toegang tot applicaties worden **uitsluitend centraal** beheerd in het
Rhadix-platform (Datavalidatie).

Het portaal heeft:
- geen eigen gebruikersbeheer;
- geen dubbele rollenadministratie;
- geen schrijfroute voor gebruikers of lidmaatschappen.

Het centrale autorisatiemodel is niet gewijzigd.

## Wat er is toegevoegd

| Onderdeel | Wat |
|---|---|
| Menu | "Gebruikers en rollen" (op smalle schermen "Gebruikers"), voor platformbeheer en de kantoorbeheerder |
| Scherm `#/gebruikers` | alleen lezen; per kantoor de leden met rol, de soort aanmelding en "in het portaal sinds" |
| Platformbeheer | knop **Naar het centrale Rhadix-beheer ↗** (het vast ingestelde platformadres, nieuw tabblad, `noopener noreferrer`), de koppeling kantoor ↔ Rhadix-organisatie, de platformbeheerders, en een uitleg hoe een nieuwe gebruiker toegang krijgt |
| Kantoorbeheerder | alleen de leden van het eigen kantoor; de melding dat Rhadix wijzigingen verwerkt; geen link naar het centrale beheer en niets te wijzigen |
| Makelaar | geen menu-item; het scherm en de API weigeren (403) |
| API | `GET /api/toegang` (geen POST, PUT, PATCH of DELETE) |
| Database | migratie 014: functie `app.leden_van_kantoor(k)` (SECURITY DEFINER, alleen lezen). Geeft alleen rijen als de aanvrager kantoorbeheerder van dát kantoor is, of platformbeheer. Geen nieuwe tabel; de bestaande rijregels op `gebruiker` en `lidmaatschap` zijn ongewijzigd. |

## Waarom een functie in plaats van ruimere rijregels

De rijregels tonen een gewone gebruiker alleen zichzelf, en dat blijft zo. Een verruiming zou ook andere kolommen zichtbaar
maken (extern ID, wachtwoordhash bij noodtoegang). De functie geeft precies de velden van het overzicht:
naam, e-mail, rol, bron, actief en sinds.

## Hoe een nieuwe gebruiker toegang krijgt (centraal)

1. **Organisatie:** het makelaarskantoor bestaat in het Rhadix-platform als organisatie van type MAKELAAR, en is in het
   portaal bij Kantoren aan die organisatie gekoppeld (op organisatie-ID, nooit op naam).
2. **Applicatie voor de organisatie:** "Rhadix Makelaarsportaal" is aan de organisatie toegewezen (TenantApplication),
   binnen de licentie en het maximum aantal gebruikers.
3. **Gebruiker en rol:** de gebruiker wordt in die organisatie aangemaakt als ORG_ADMIN (wordt kantoorbeheerder) of
   ORG_USER (wordt makelaar). RHADIX_ADMIN wordt platformbeheer; RSO_ADMIN krijgt geen toegang.
4. **Applicatie voor de gebruiker:** een persoonlijke toewijzing (UserApplication). De apps-claim is de doorsnede van
   organisatie- en persoonlijke toewijzing, dus beide zijn nodig.
5. **Eerste aanmelding:** het portaal maakt de gebruiker automatisch aan. Kantoor en rol volgen bij elke aanmelding uit
   het token (een rol die in het portaal zou worden aangepast, wordt dus overschreven).

## Beperkingen die blijven

- **Wie zichtbaar is:** gebruikers verschijnen pas na hun eerste aanmelding. Iemand met toegang die nog nooit is
  ingelogd, staat niet in het overzicht.
- **Laatste aanmelding:** onbekend. Rhadix-aanmeldingen maken geen sessie in het portaal, daarom "in het portaal sinds".
- **Kantoorbeheerder:** kan geen gebruikers of rollen aanmaken of wijzigen, en heeft geen link naar het centrale beheer.
- **Licentiestatus en maximum:** niet zichtbaar in het portaal (dat vraagt optie B, met een koppeling met Datavalidatie).

## Aanvraagmogelijkheid voor de kantoorbeheerder (onderzocht, niet gebouwd)

| Variant | Hoe | Afweging |
|---|---|---|
| 1. E-mail | knop "Wijziging aanvragen" opent een vooraf ingevuld e-mailbericht naar een vast Rhadix-adres (instelling) | eenvoudigst, geen opslag. Vraagt een vastgesteld supportadres; geen status of historie |
| 2. Aanvraag in het portaal | formulier (toevoegen / rol wijzigen / verwijderen, naam, e-mail, toelichting) → opslag als aanvraag + melding aan Rhadix; Rhadix zet de status op verwerkt na het centrale beheer | volgbaar en controleerbaar; een kleine tabel en een melding. Het blijft een verzoek, geen gebruikersadministratie |
| 3. Centraal zelf beheren | de organisatiebeheerder beheert eigen gebruikers in het Rhadix-platform (bestaat al) | bewust nog niet: nu geen zelfstandig beheer |

**Advies:** variant 2 als vervolg, met variant 1 als tijdelijke tussenstap zodra er een vast supportadres is.

## Tests

`tests/toegang.test.ts`:
- platformbeheer ziet alles;
- een kantoorbeheerder ziet alleen het eigen kantoor (ook bij een gemengd lidmaatschap);
- een makelaar krijgt 403; zonder aanmelding 401;
- er is geen schrijfroute;
- de functie geeft niets buiten de rol;
- de bestaande rijregels zijn ongewijzigd;
- de kantoorbeheerder kan niet schrijven.

`tests/status.test.ts` is bijgewerkt met de nieuwe migratie.
