-- Stap 5: broncontrole, kwaliteitscontrole en vrijgave voor conceptgeneratie.
--
-- Hergebruik: gegevens (laag 3), verwerking (nu ook de kwaliteitscontrole) en de meldingen uit
-- stap 4. Nieuw zijn alleen de beslissingen op projectniveau (rechten, websiteadres, openingsbeeld,
-- vrijgave) en een besluitenlog: wie besloot wat, wanneer en waarom.

-- Een gegeven uit de brochure kan gemotiveerd worden afgewezen (niet gebruiken).
ALTER TABLE gegeven DROP CONSTRAINT gegeven_status_check;
ALTER TABLE gegeven ADD CONSTRAINT gegeven_status_check CHECK (status IN ('overgenomen', 'goedgekeurd', 'afgewezen'));

-- De kwaliteitscontrole is een verwerking; de vingerafdruk legt vast op welke stand zij draaide.
ALTER TABLE verwerking DROP CONSTRAINT verwerking_soort_check;
ALTER TABLE verwerking ADD CONSTRAINT verwerking_soort_check CHECK (soort IN ('brochure-import', 'foto-indeling', 'kwaliteitscontrole'));
ALTER TABLE verwerking ADD COLUMN vingerafdruk text;

-- Beslissingen op projectniveau.
ALTER TABLE project ADD COLUMN rechten jsonb;
ALTER TABLE project ADD COLUMN conceptadres boolean NOT NULL DEFAULT false;
ALTER TABLE project ADD COLUMN openingsbeeld_id uuid REFERENCES bestand (id) ON DELETE SET NULL;
ALTER TABLE project ADD COLUMN vrijgave jsonb;
COMMENT ON COLUMN project.rechten IS 'Bevestiging publicatierechten foto''s en teksten: {bevestigd, toelichting, door, op}';
COMMENT ON COLUMN project.conceptadres IS 'Nog geen domein: het concept krijgt een tijdelijk adres <slug>.invalid';
COMMENT ON COLUMN project.vrijgave IS 'Vrijgave voor conceptgeneratie (geen publicatie): {door, op, motivering, vingerafdruk, controle} of vervallen';

-- ── Besluitenlog ────────────────────────────────────────────────────────────
CREATE TABLE besluit (
  id          bigserial PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  kantoor_id  uuid NOT NULL REFERENCES kantoor (id),
  onderwerp   text NOT NULL,
  handeling   text NOT NULL,
  waarde      jsonb,
  motivering  text,
  door        uuid REFERENCES gebruiker (id),
  op          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX besluit_project ON besluit (project_id, op);
ALTER TABLE besluit ENABLE ROW LEVEL SECURITY;
ALTER TABLE besluit FORCE ROW LEVEL SECURITY;
CREATE POLICY besluit_lezen ON besluit FOR SELECT TO studio_app USING (app.is_platformbeheer() OR kantoor_id IN (SELECT app.mijn_kantoren()));
CREATE POLICY besluit_toevoegen ON besluit FOR INSERT TO studio_app WITH CHECK (app.is_platformbeheer() AND door = app.huidige_gebruiker());
-- Het log wordt alleen aangevuld, nooit gewijzigd of verwijderd.
GRANT SELECT, INSERT ON besluit TO studio_app;
GRANT USAGE ON SEQUENCE besluit_id_seq TO studio_app;
CREATE TRIGGER besluit_kantoor BEFORE INSERT ON besluit FOR EACH ROW EXECUTE FUNCTION app.kantoor_volgt_project();

-- ── Vrijgave vervalt bij elke inhoudelijke wijziging ────────────────────────
-- Een vrijgegeven woning die daarna verandert, is niet meer vrijgegeven: terug naar de aanlevering.
CREATE FUNCTION app.vrijgave_vervalt_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'klaar_voor_productie' AND NEW.status = 'klaar_voor_productie'
     AND (NEW.naam, NEW.adres, NEW.postcode, NEW.plaats, NEW.woningtype, NEW.profiel, NEW.domein, NEW.rechten, NEW.conceptadres, NEW.openingsbeeld_id)
         IS DISTINCT FROM (OLD.naam, OLD.adres, OLD.postcode, OLD.plaats, OLD.woningtype, OLD.profiel, OLD.domein, OLD.rechten, OLD.conceptadres, OLD.openingsbeeld_id) THEN
    NEW.status := 'aanlevering_incompleet';
    NEW.vrijgave := coalesce(OLD.vrijgave, '{}'::jsonb) || jsonb_build_object('vervallen_op', now(), 'vervallen_door', 'wijziging van het project');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER project_vrijgave BEFORE UPDATE ON project FOR EACH ROW EXECUTE FUNCTION app.vrijgave_vervalt_project();

CREATE FUNCTION app.vrijgave_vervalt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid uuid := coalesce(NEW.project_id, OLD.project_id);
BEGIN
  IF pid IS NOT NULL THEN
    UPDATE project SET status = 'aanlevering_incompleet',
      vrijgave = coalesce(vrijgave, '{}'::jsonb) || jsonb_build_object('vervallen_op', now(), 'vervallen_door', 'wijziging van ' || TG_TABLE_NAME)
    WHERE id = pid AND status = 'klaar_voor_productie';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER gegeven_vrijgave AFTER INSERT OR UPDATE OR DELETE ON gegeven FOR EACH ROW EXECUTE FUNCTION app.vrijgave_vervalt();
CREATE TRIGGER bestand_vrijgave AFTER INSERT OR UPDATE OR DELETE ON bestand FOR EACH ROW EXECUTE FUNCTION app.vrijgave_vervalt();
