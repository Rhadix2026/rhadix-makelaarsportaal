-- Verbeterpunten als eenvoudige takenworkflow (ontwerp: docs/ONTWERP-VERBETERPUNTEN-WORKFLOW.md).
--
-- De tabel `verbeterpunt` wordt de ENIGE actieve registratie. De bestaande punten in
-- concept.verbeterpunten (jsonb) worden in deze transactie overgenomen, met een telcontrole; de kolom
-- blijft daarna ongewijzigd staan als archief en wordt bevroren (geen schrijfrecht meer), zodat er
-- nooit twee bronnen zijn. Terugdraaien: db/terugdraaien/015_verbeterpunten.sql (schrijft alles terug).
--
-- Rechten (bestaande bouwstenen):
--   lezen        eigen kantoor en platformbeheer
--   indienen     makelaar, kantoorbeheerder, platformbeheer: alleen via app.verbeterpunten_indienen()
--   behandelen   alleen platformbeheer (status, behandelaar, reactie, afhandeling, verwerkt in)
--   verwijderen  niemand: een punt wordt gemotiveerd geannuleerd
-- Een nieuwe conceptversie rondt niets af: alleen platformbeheer zet een punt op KLAAR, met de versie.

CREATE TABLE verbeterpunt (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  kantoor_id         uuid NOT NULL REFERENCES kantoor (id),
  concept_id         uuid NOT NULL REFERENCES concept (id),
  onderdeel          text NOT NULL DEFAULT 'algemeen' CHECK (length(onderdeel) BETWEEN 1 AND 60),
  tekst              text NOT NULL CHECK (length(tekst) BETWEEN 3 AND 1000),
  status             text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_BEHANDELING', 'KLAAR', 'GEANNULEERD')),
  ingediend_door     uuid NOT NULL REFERENCES gebruiker (id),
  ingediend_op       timestamptz NOT NULL DEFAULT now(),
  behandelaar        uuid REFERENCES gebruiker (id),
  reactie            text CHECK (reactie IS NULL OR length(reactie) <= 2000),
  afgehandeld_door   uuid REFERENCES gebruiker (id),
  afgehandeld_op     timestamptz,
  verwerkt_in        uuid REFERENCES concept (id),
  herkomst           text NOT NULL DEFAULT 'portaal' CHECK (herkomst IN ('portaal', 'overgenomen')),
  bijgewerkt_op      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verbeterpunt_klaar_met_versie CHECK (status <> 'KLAAR' OR verwerkt_in IS NOT NULL),
  CONSTRAINT verbeterpunt_klaar_met_toelichting CHECK (status <> 'KLAAR' OR length(coalesce(reactie, '')) >= 3),
  CONSTRAINT verbeterpunt_annuleren_gemotiveerd CHECK (status <> 'GEANNULEERD' OR length(coalesce(reactie, '')) >= 3),
  CONSTRAINT verbeterpunt_afgehandeld CHECK ((status IN ('KLAAR', 'GEANNULEERD')) = (afgehandeld_op IS NOT NULL AND afgehandeld_door IS NOT NULL))
);
COMMENT ON TABLE verbeterpunt IS 'Verbeterpunten op een conceptversie: de enige actieve registratie (concept.verbeterpunten is een bevroren archief)';
CREATE INDEX verbeterpunt_project ON verbeterpunt (project_id, status);
CREATE INDEX verbeterpunt_concept ON verbeterpunt (concept_id);
CREATE INDEX verbeterpunt_open ON verbeterpunt (status) WHERE status IN ('OPEN', 'IN_BEHANDELING');

CREATE TRIGGER verbeterpunt_kantoor BEFORE INSERT OR UPDATE ON verbeterpunt FOR EACH ROW EXECUTE FUNCTION app.kantoor_volgt_project();

-- Bewaking: versies van hetzelfde project, verwerkt in een latere versie, alleen toegestane overgangen,
-- en wat bij het indienen is vastgelegd blijft ongewijzigd.
CREATE FUNCTION app.bewaak_verbeterpunt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_oorspr int; v_verwerkt int;
BEGIN
  SELECT versie INTO v_oorspr FROM concept WHERE id = NEW.concept_id AND project_id = NEW.project_id;
  IF v_oorspr IS NULL THEN RAISE EXCEPTION 'conceptversie hoort niet bij dit woningproject' USING ERRCODE = '23514'; END IF;
  IF NEW.verwerkt_in IS NOT NULL THEN
    SELECT versie INTO v_verwerkt FROM concept WHERE id = NEW.verwerkt_in AND project_id = NEW.project_id;
    IF v_verwerkt IS NULL THEN RAISE EXCEPTION 'verwerkt in: conceptversie hoort niet bij dit woningproject' USING ERRCODE = '23514'; END IF;
    IF v_verwerkt <= v_oorspr THEN RAISE EXCEPTION 'verwerkt in: kies een latere conceptversie dan v%', v_oorspr USING ERRCODE = '23514'; END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.project_id, NEW.concept_id, NEW.onderdeel, NEW.tekst, NEW.ingediend_door, NEW.ingediend_op, NEW.herkomst)
       IS DISTINCT FROM (OLD.project_id, OLD.concept_id, OLD.onderdeel, OLD.tekst, OLD.ingediend_door, OLD.ingediend_op, OLD.herkomst) THEN
      RAISE EXCEPTION 'een ingediend verbeterpunt wordt niet gewijzigd' USING ERRCODE = '42501';
    END IF;
    IF OLD.status IN ('KLAAR', 'GEANNULEERD') AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'een afgehandeld verbeterpunt is definitief' USING ERRCODE = '23514';
    END IF;
    NEW.bijgewerkt_op := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER verbeterpunt_bewaak BEFORE INSERT OR UPDATE ON verbeterpunt FOR EACH ROW EXECUTE FUNCTION app.bewaak_verbeterpunt();

ALTER TABLE verbeterpunt ENABLE ROW LEVEL SECURITY;
ALTER TABLE verbeterpunt FORCE ROW LEVEL SECURITY;
CREATE POLICY verbeterpunt_lezen ON verbeterpunt FOR SELECT TO studio_app
  USING (app.is_platformbeheer() OR kantoor_id IN (SELECT app.mijn_kantoren()));
CREATE POLICY verbeterpunt_behandelen ON verbeterpunt FOR UPDATE TO studio_app
  USING (app.is_platformbeheer()) WITH CHECK (app.is_platformbeheer());
-- Geen INSERT-recht (indienen alleen via de functie) en geen DELETE.
GRANT SELECT ON verbeterpunt TO studio_app;
GRANT UPDATE (status, behandelaar, reactie, afgehandeld_door, afgehandeld_op, verwerkt_in) ON verbeterpunt TO studio_app;

-- Indienen: één of meer punten op een conceptversie, door iedereen die in het kantoor mag werken.
-- Doet precies wat het indienen van verbeterpunten altijd deed (concept 'verbeterpunten', project
-- 'correctie'), zonder de bestaande regels voor concept en project te verruimen.
CREATE FUNCTION app.verbeterpunten_indienen(c uuid, punten jsonb) RETURNS SETOF uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k record; p jsonb; nieuw uuid; ik uuid := app.huidige_gebruiker();
BEGIN
  SELECT id, project_id, kantoor_id INTO k FROM concept WHERE id = c;
  IF k.id IS NULL OR ik IS NULL OR NOT app.mag_produceren(k.kantoor_id) THEN
    RAISE EXCEPTION 'geen rechten voor deze conceptversie' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(punten) <> 'array' OR jsonb_array_length(punten) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'geef 1 tot 20 verbeterpunten op' USING ERRCODE = '22023';
  END IF;
  FOR p IN SELECT * FROM jsonb_array_elements(punten) LOOP
    INSERT INTO verbeterpunt (project_id, kantoor_id, concept_id, onderdeel, tekst, ingediend_door)
      VALUES (k.project_id, k.kantoor_id, k.id, coalesce(nullif(left(trim(p->>'onderdeel'), 60), ''), 'algemeen'), trim(p->>'tekst'), ik)
      RETURNING id INTO nieuw;
    RETURN NEXT nieuw;
  END LOOP;
  UPDATE concept SET status = 'verbeterpunten' WHERE id = k.id AND status = 'te_beoordelen';
  UPDATE project SET status = 'correctie', gewijzigd_op = now() WHERE id = k.project_id AND status = 'interne_review';
END $$;
REVOKE ALL ON FUNCTION app.verbeterpunten_indienen(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.verbeterpunten_indienen(uuid, jsonb) TO studio_app;

-- Definitieve acceptatie: niet zolang er op die versie punten OPEN of IN_BEHANDELING zijn.
CREATE FUNCTION app.bewaak_acceptatie() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'geaccepteerd' AND OLD.status IS DISTINCT FROM 'geaccepteerd'
     AND EXISTS (SELECT 1 FROM verbeterpunt WHERE concept_id = NEW.id AND status IN ('OPEN', 'IN_BEHANDELING')) THEN
    RAISE EXCEPTION 'er staan nog verbeterpunten open op deze conceptversie' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER concept_acceptatie BEFORE UPDATE OF status ON concept FOR EACH ROW EXECUTE FUNCTION app.bewaak_acceptatie();

-- ── Overname van de bestaande punten (jsonb → tabel), met telcontrole ──────────
-- Een element uit een eerdere terugdraaiing draagt zijn status en afhandeling mee; een oud element
-- (onderdeel, tekst, door, op) wordt OPEN. Zonder geldige indiener: de beoordelaar van de versie,
-- anders de aanmaker.
DO $$
DECLARE verwacht int; overgenomen int;
BEGIN
  SELECT coalesce(sum(jsonb_array_length(verbeterpunten)), 0) INTO verwacht FROM concept;
  INSERT INTO verbeterpunt (id, project_id, kantoor_id, concept_id, onderdeel, tekst, status, ingediend_door, ingediend_op,
                            behandelaar, reactie, afgehandeld_door, afgehandeld_op, verwerkt_in, herkomst)
  SELECT coalesce((e->>'id')::uuid, gen_random_uuid()), k.project_id, k.kantoor_id, k.id,
         coalesce(nullif(left(e->>'onderdeel', 60), ''), 'algemeen'),
         CASE WHEN length(coalesce(e->>'tekst', '')) >= 3 THEN left(e->>'tekst', 1000) ELSE coalesce(e->>'tekst', '') || ' (overgenomen)' END,
         coalesce(e->>'status', 'OPEN'),
         coalesce((SELECT g.id FROM gebruiker g WHERE g.id::text = e->>'door'), k.beoordeeld_door, k.aangemaakt_door),
         coalesce((e->>'op')::timestamptz, k.beoordeeld_op, k.aangemaakt_op),
         (e->>'behandelaar')::uuid, e->>'reactie', (e->>'afgehandeld_door')::uuid, (e->>'afgehandeld_op')::timestamptz,
         (e->>'verwerkt_in')::uuid, coalesce(e->>'herkomst', 'overgenomen')
  FROM concept k, jsonb_array_elements(k.verbeterpunten) e;
  GET DIAGNOSTICS overgenomen = ROW_COUNT;
  IF overgenomen <> verwacht THEN
    RAISE EXCEPTION 'overname verbeterpunten: % verwacht, % overgenomen', verwacht, overgenomen;
  END IF;
  RAISE NOTICE 'verbeterpunten overgenomen: %', overgenomen;
END $$;

-- Bevriezen: concept.verbeterpunten blijft als archief staan, maar wordt nooit meer geschreven.
REVOKE UPDATE (verbeterpunten) ON concept FROM studio_app;
COMMENT ON COLUMN concept.verbeterpunten IS 'Bevroren archief (migratie 015); de actieve registratie is de tabel verbeterpunt';
