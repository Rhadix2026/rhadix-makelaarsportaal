-- Stap 6: conceptgeneratie en preview, plus het besluit over financiële gegevens.

-- Financiële gegevens (bijvoorbeeld de VvE-bijdrage) worden vastgelegd als feit met bron, maar niet
-- automatisch gepubliceerd: de makelaar beslist later welke er op de website komen.
ALTER TABLE gegeven ADD COLUMN publiceren boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN gegeven.publiceren IS 'false = vastgelegd met bron, maar niet automatisch op de website (bijvoorbeeld financiële gegevens)';

ALTER TABLE verwerking DROP CONSTRAINT verwerking_soort_check;
ALTER TABLE verwerking ADD CONSTRAINT verwerking_soort_check
  CHECK (soort IN ('brochure-import', 'foto-indeling', 'kwaliteitscontrole', 'conceptgeneratie'));

-- ── Conceptversies: nooit overschreven; elke generatie is een nieuwe versie ──
CREATE TABLE concept (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  kantoor_id           uuid NOT NULL REFERENCES kantoor (id),
  versie               int NOT NULL,
  verwerking_id        uuid REFERENCES verwerking (id) ON DELETE SET NULL,
  status               text NOT NULL DEFAULT 'te_beoordelen' CHECK (status IN ('te_beoordelen', 'geaccepteerd', 'verbeterpunten')),
  map                  text NOT NULL,
  invoer_vingerafdruk  text NOT NULL,
  build_vingerafdruk   text NOT NULL,
  ontwerpsysteem       text NOT NULL,
  profiel              text NOT NULL,
  generator_commit     text NOT NULL,
  bouw                 jsonb NOT NULL,
  kwaliteit            jsonb,
  metingen             jsonb NOT NULL,
  voorbeeld_token      text NOT NULL UNIQUE CHECK (length(voorbeeld_token) >= 40),
  verbeterpunten       jsonb NOT NULL DEFAULT '[]',
  beoordeeld_door      uuid REFERENCES gebruiker (id),
  beoordeeld_op        timestamptz,
  motivering           text,
  aangemaakt_door      uuid NOT NULL REFERENCES gebruiker (id),
  aangemaakt_op        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, versie)
);
COMMENT ON TABLE concept IS 'Lokaal gegenereerd concept (geen publicatie). Elke generatie is een nieuwe, onveranderlijke versie; alleen de beoordeling wordt aangevuld';

ALTER TABLE concept ENABLE ROW LEVEL SECURITY;
ALTER TABLE concept FORCE ROW LEVEL SECURITY;
CREATE POLICY concept_lezen ON concept FOR SELECT TO studio_app USING (app.is_platformbeheer() OR kantoor_id IN (SELECT app.mijn_kantoren()));
CREATE POLICY concept_toevoegen ON concept FOR INSERT TO studio_app WITH CHECK (app.is_platformbeheer());
CREATE POLICY concept_wijzigen ON concept FOR UPDATE TO studio_app USING (app.is_platformbeheer()) WITH CHECK (app.is_platformbeheer());
-- Geen DELETE: conceptversies worden nooit verwijderd of overschreven.
GRANT SELECT, INSERT ON concept TO studio_app;
-- Alleen de beoordeling mag worden bijgewerkt; de inhoud van een versie ligt vast.
GRANT UPDATE (status, verbeterpunten, beoordeeld_door, beoordeeld_op, motivering) ON concept TO studio_app;
CREATE TRIGGER concept_kantoor BEFORE INSERT OR UPDATE ON concept FOR EACH ROW EXECUTE FUNCTION app.kantoor_volgt_project();
