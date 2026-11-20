# Technisch ontwerp: verbeterpunten als eenvoudige takenworkflow (optie B)

**Status (20-11-2026):** ontwerp goedgekeurd en lokaal gebouwd (migratie 015, 142/142 tests). Niet op staging of test; uitrol pas na akkoord.
- Nog **geen** database- of codewijziging uitgevoerd en niets uitgerold.
- Geen koppeling met de centrale Rhadix-takenlijst.
- Het centrale autorisatiemodel en de licentiemodule worden niet gewijzigd.

---

## 1. Uitgangssituatie (vastgesteld)

| Onderdeel | Nu |
|---|---|
| Opslag | `concept.verbeterpunten` (jsonb-array per conceptversie): `{onderdeel, tekst, door, op}` |
| Indienen | `PUT /api/concepten/:id/beoordeling` met `besluit: 'verbeterpunten'` → concept `verbeterpunten`, project `correctie`, besluit `concept vN · verbeterpunten vastgelegd`, audit |
| Wie | alleen kantoorbeheerder en platformbeheer (API-preHandler, en in de database: `concept_wijzigen` en het besluit `concept v%` vereisen `is_kantoorbeheer`) |
| Status per punt | geen |
| Bestaande punten | **lokaal 1 concept / 0 punten; test 17 concepten / 0 punten; productie: het portaal draait niet in productie** |

---

## 2. Datamodel (migratie 015, concept)

**Eén nieuwe tabel. Dit is de enige bron voor verbeterpunten.** De jsonb-kolom wordt na de overname bevroren
(zie §6), zodat er geen dubbele opslag ontstaat.

```sql
CREATE TABLE verbeterpunt (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  kantoor_id         uuid NOT NULL REFERENCES kantoor (id),            -- volgt het project (bestaande trigger)
  concept_id         uuid NOT NULL REFERENCES concept (id),            -- oorspronkelijke conceptversie
  onderdeel          text NOT NULL DEFAULT 'algemeen' CHECK (length(onderdeel) BETWEEN 1 AND 60),
  tekst              text NOT NULL CHECK (length(tekst) BETWEEN 3 AND 1000),   -- omschrijving
  status             text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_BEHANDELING', 'KLAAR', 'GEANNULEERD')),
  ingediend_door     uuid NOT NULL REFERENCES gebruiker (id),
  ingediend_op       timestamptz NOT NULL DEFAULT now(),
  behandelaar        uuid REFERENCES gebruiker (id),                   -- wie het in behandeling nam
  reactie            text CHECK (reactie IS NULL OR length(reactie) <= 2000),   -- reactie van Rhadix
  afgehandeld_door   uuid REFERENCES gebruiker (id),
  afgehandeld_op     timestamptz,
  verwerkt_in        uuid REFERENCES concept (id),                     -- nieuwe versie met de aanpassing
  herkomst           text NOT NULL DEFAULT 'portaal' CHECK (herkomst IN ('portaal', 'overgenomen')),
  bijgewerkt_op      timestamptz NOT NULL DEFAULT now(),
  -- KLAAR alleen met de versie waarin het is verwerkt; GEANNULEERD alleen met motivering.
  CHECK (status <> 'KLAAR' OR verwerkt_in IS NOT NULL),
  CHECK (status <> 'GEANNULEERD' OR length(coalesce(reactie, '')) >= 3),
  CHECK ((status IN ('KLAAR', 'GEANNULEERD')) = (afgehandeld_op IS NOT NULL))
);
CREATE INDEX verbeterpunt_project ON verbeterpunt (project_id, status);
CREATE INDEX verbeterpunt_concept ON verbeterpunt (concept_id);
CREATE INDEX verbeterpunt_open    ON verbeterpunt (status) WHERE status IN ('OPEN', 'IN_BEHANDELING');
```

**Bewaking door een trigger** (`app.bewaak_verbeterpunt`, BEFORE INSERT/UPDATE):
- `concept_id` en `verwerkt_in` horen bij **hetzelfde project**, en `verwerkt_in` heeft een **hogere versie** dan
  `concept_id`.
- **Toegestane overgangen:**
  - OPEN → IN_BEHANDELING | KLAAR | GEANNULEERD;
  - IN_BEHANDELING → OPEN | KLAAR | GEANNULEERD.
  - KLAAR en GEANNULEERD zijn eindstatussen.
- **Vast na indienen:** omschrijving, onderdeel, indiener, datum, project en oorspronkelijke versie (bewaard zoals
  ingediend).
- Er wordt nooit verwijderd (geen DELETE-recht): een punt wordt gemotiveerd geannuleerd.

**Rechten** (dezelfde bouwstenen als de rest van het portaal):

| Handeling | Wie | Hoe |
|---|---|---|
| Lezen | eigen kantoor + platformbeheer | policy `kantoor_id IN app.mijn_kantoren() OR app.is_platformbeheer()` |
| Indienen | makelaar, kantoorbeheerder, platformbeheer van dat kantoor | functie `app.verbeterpunten_indienen(concept, punten jsonb)` (SECURITY DEFINER, controleert `app.mag_produceren`) |
| Status, reactie, verwerkt in | **alleen platformbeheer** | policy UPDATE `app.is_platformbeheer()`; kolomrechten alleen op status, behandelaar, reactie, afgehandeld_door/op, verwerkt_in, bijgewerkt_op |
| Verwijderen | niemand | geen DELETE-recht |

**Waarom indienen via een functie:**
- Indienen zet (zoals nu) het concept op `verbeterpunten` en het project op `correctie`.
- De bestaande regels laten dat alleen de kantoorbeheerder doen, en die regels verruim ik niet.
- De functie doet precies deze drie dingen en verder niets:
  1. punten toevoegen met de aanvrager als indiener;
  2. de conceptstatus van `te_beoordelen` naar `verbeterpunten`;
  3. de projectstatus van `interne_review` naar `correctie`.
- Het besluit gaat op een eigen onderwerp (`verbeterpunten vN`, zie §5). Daarmee valt het niet onder de
  kantoorbeheerregel voor de beoordeling `concept vN`.

---

## 3. API (bestaande routes waar mogelijk)

| Route | Recht | Doel |
|---|---|---|
| `GET /api/projecten/:id/verbeterpunten` | eigen kantoor / platform | alle punten van het woningproject, per versie, met status, reactie en "verwerkt in vN" |
| `POST /api/concepten/:id/verbeterpunten` `{punten:[{onderdeel,tekst}]}` | makelaar, kantoorbeheerder, platform | één of meer punten indienen (1–20 per keer) |
| `PATCH /api/verbeterpunten/:id` `{status, reactie?, verwerkt_in_versie?}` | alleen platform | in behandeling nemen, beantwoorden, afronden (versie kiezen) of gemotiveerd annuleren |
| `GET /api/verbeterpunten?status=open` | alleen platform | overzicht van alle open punten (OPEN + IN_BEHANDELING) over alle kantoren |
| `PUT /api/concepten/:id/beoordeling` (bestaand) | kantoorbeheerder / platform (ongewijzigd) | `geaccepteerd`: **geweigerd (409) zolang er OPEN of IN_BEHANDELING punten op die versie zijn**, met de lijst. `verbeterpunten`: blijft werken, maar gaat via dezelfde functie naar de nieuwe tabel (geen jsonb meer) |
| `GET /api/concepten/:id` (bestaand) | ongewijzigd | het veld `verbeterpunten` komt voortaan uit de tabel (zelfde vorm + status), zodat bestaande schermen blijven werken |

**Afdwingen op twee plekken:**
- **Server (API):** 403 of 409 met een begrijpelijke melding.
- **Database:** de policies, de trigger, en een trigger op `concept` die `status = 'geaccepteerd'` weigert zolang er
  open punten op die versie zijn.

---

## 4. Gebruikerservaring

**Makelaar en kantoorbeheerder (woningpagina, geen technisch scherm)**
- Het blok "4. Conceptwebsite" krijgt **Concept bekijken**. Dat opent een portaalpagina met de afgeschermde preview
  (de bestaande component `Voorbeeld`, iframe in een sandbox) en daarnaast het paneel **Verbeterpunten**.
  - De preview zelf blijft onaangeroerd: er wordt niets in de gegenereerde site geplaatst.
  - Op mobiel staat het paneel onder de preview.
- **Indienen:** een of meer regels (onderdeel + omschrijving), "Nog een punt", **Verbeterpunten indienen**. Daarna
  een bevestiging met het aantal en de versie.
- **Lijst per versie:**
  - status als badge: Open / In behandeling / Klaar (verwerkt in v3) / Geannuleerd;
  - de reactie van Rhadix;
  - datum en indiener.
  - Oudere versies blijven inklapbaar zichtbaar.
- **Accepteren (alleen de kantoorbeheerder, zoals nu):**
  - de knop is uitgeschakeld zolang er punten open of in behandeling staan;
  - eronder staat "Nog af te handelen:" met die punten;
  - geannuleerde en afgehandelde punten tellen niet mee.

**Rhadix (platformbeheer)**
- **Menu-item "Verbeterpunten"** met het aantal open punten: één lijst van alle kantoren, met filter op kantoor en
  status, oudste eerst, en een link naar het project.
- **Per woningproject:** het beheerblok "Keuzes makelaar" krijgt een sectie **Verbeterpunten**, ook in het bestaande
  conceptscherm.
- **Handelingen per punt:**
  - **In behandeling nemen**: zet de behandelaar;
  - **Beantwoorden**: alleen een reactie, de status blijft;
  - **Afronden**: kies "verwerkt in versie" uit de latere versies van dit project; verplicht;
  - **Annuleren**: motivering verplicht.
- **Nieuwe versie:** met de bestaande knop en generatie. Er wordt **niets** automatisch afgerond. De knop toont
  "n punten in behandeling".

---

## 5. Logboeken (bestaande blijven)

- **Besluitenlog:** het bestaande `besluit`, met een eigen onderwerp per versie: `verbeterpunten vN`.
  - Handelingen: `ingediend (n)`, `in behandeling`, `beantwoord`, `afgerond in vM`, `geannuleerd`.
  - In de waarde staan het punt-ID en de reactie of motivering.
  - Zichtbaar in de bestaande beoordeling en in het besluitenlog.
- **Auditlog:** het bestaande `auditregel` bij elke wijziging.
- De bestaande regels `concept vN · gegenereerd`, `· geaccepteerd` en `· verbeterpunten vastgelegd` blijven
  ongewijzigd.

---

## 6. Overname van bestaande verbeterpunten (veilig)

1. **Vooraf:** telling `sum(jsonb_array_length(concept.verbeterpunten))` en een vingerafdruk van alle concepten.
   - Nu: lokaal 0, test 0.
2. **In de migratie, in dezelfde transactie:** voor elk element van elke `concept.verbeterpunten` één rij
   `verbeterpunt` met:
   - `concept_id` = die versie;
   - onderdeel, tekst, `ingediend_door` = `door`, `ingediend_op` = `op`;
   - status OPEN, `herkomst` = 'overgenomen'.
   - **Controle in de migratie:** aantal overgenomen = aantal in jsonb, anders een EXCEPTION en de hele migratie
     rolt terug.
   - Elementen zonder geldige `door` (oud formaat) krijgen de beoordelaar van de versie, en anders de aanmaker.
     Dat wordt in de migratie-uitvoer gemeld.
3. **Bevriezen, niet wissen:**
   - `concept.verbeterpunten` blijft staan zoals het was (archief, terugvalmogelijkheid);
   - het UPDATE-recht van `studio_app` op die kolom wordt ingetrokken, zodat er nooit meer twee bronnen ontstaan;
   - de API leest alleen nog de tabel.
4. **Achteraf:** dezelfde telling en vingerafdruk. Conceptversies, projecten en besluiten zijn ongewijzigd; alleen
   `verbeterpunt` heeft nieuwe rijen.
5. **Later, alleen na akkoord:** een migratie die de bevroren kolom verwijdert, als die niet meer nodig is.

---

## 7. Gevolgen voor de beoordeling en vrijgave

**Ongewijzigd:**
- de fasen 1–4;
- de vrijgave voor conceptgeneratie (`magGenereren`, de vingerafdruk, de kwaliteitscontrole);
- het genereren en de voortgang;
- de conceptstatussen;
- de projectstatus `correctie`;
- "accepteren is geen publicatie".

**Nieuw:**
- **Accepteren:** kan alleen als er geen open punten of punten in behandeling op die versie zijn. Dit wordt
  afgedwongen in de API én in de database.
- **Nieuwe versie:** kan altijd, ook met open punten, zoals nu.
- **Status van de vorige versie:** die blijft `verbeterpunten`. De open punten blijven open tot Rhadix ze afrondt.

---

## 8. Tests (autorisatiematrix en werking)

| Scenario | Platform | Kantoorbeheerder | Makelaar | Ander kantoor |
|---|---|---|---|---|
| Punten lezen (project) | ✓ | ✓ eigen | ✓ eigen | 404 |
| Punten indienen (meerdere) | ✓ | ✓ | ✓ | 404 |
| In behandeling / beantwoorden / afronden / annuleren | ✓ | 403 | 403 | 404 |
| Overzicht alle kantoren | ✓ | 403 | 403 | — |
| Accepteren met open punt | 409 | 409 | 403 (zoals nu) | 404 |
| Accepteren na KLAAR of GEANNULEERD | ✓ | ✓ | 403 | 404 |

**Daarnaast:**
- **Database:**
  - rechtstreeks UPDATE of DELETE door makelaar en kantoorbeheerder geweigerd;
  - KLAAR zonder versie, annuleren zonder motivering, `verwerkt_in` van een ander project of een lagere versie, en
    een overgang vanuit een eindstatus worden allemaal geweigerd;
  - een concept op `geaccepteerd` met een open punt geweigerd.
- **Nieuwe versie:** genereren rondt niets af; alleen het daadwerkelijk afgeronde punt krijgt KLAAR met "verwerkt in v2".
- **Overname:** jsonb met 3 punten → 3 rijen `overgenomen`, aantallen gelijk, jsonb ongewijzigd, daarna niet meer te
  wijzigen; een mismatch rolt de migratie terug.
- **Logboeken:** elke handeling geeft één besluit en één auditregel; de bestaande regels zijn ongewijzigd.
- **Schermen:** indienen vanuit de preview, de lijst per versie, de uitgeschakelde accepteerknop met de lijst nog af
  te handelen, en het platformoverzicht. Mobiel zonder horizontaal scrollen.

---

## 9. Omvang en volgorde (na akkoord)

1. **Migratie 015:** tabel, policies, functie, triggers, overname, bevriezen. Plus de tests op databaseniveau.
2. **API:** de nieuwe routes, de aanpassing van `beoordeelConcept` en `leesConcept`, plus de API-tests.
3. **Interface:**
   - preview met paneel op de woningpagina;
   - lijst per versie;
   - accepteerblokkade;
   - platformoverzicht en de handelingen per punt.
4. **Lokaal:** de volledige route met de echte generator (indienen → in behandeling → nieuwe versie → afronden in v2
   → accepteren).
5. Rapport. Uitrol naar test pas na akkoord.

**Schatting:** één migratie, ±4 API-routes, 2–3 schermonderdelen. Geen andere applicaties.
