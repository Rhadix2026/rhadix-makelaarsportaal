-- Na stap 6: snelle beoordeling (bronovername), fase-afhankelijke meldingen en tijdregistratie.

-- ── Interacties: voor de actieve gebruikerstijd ──
-- Eén regel per interactiemoment (de studio stuurt hoogstens één per 30 s zolang er gewerkt wordt).
-- Actieve tijd = som van de tussenpozen tot de inactiviteitsgrens; langere pauzes tellen niet mee.
CREATE TABLE activiteit (
  id          bigserial PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  kantoor_id  uuid NOT NULL REFERENCES kantoor (id),
  gebruiker   uuid NOT NULL REFERENCES gebruiker (id),
  scherm      text NOT NULL CHECK (scherm IN ('project', 'aanlevering', 'beoordeling', 'concept')),
  op          timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE activiteit IS 'Interactiemomenten per gebruiker en woningproject, alleen voor de meting van de actieve gebruikerstijd';
CREATE INDEX activiteit_project ON activiteit (project_id, gebruiker, op);
ALTER TABLE activiteit ENABLE ROW LEVEL SECURITY;
ALTER TABLE activiteit FORCE ROW LEVEL SECURITY;
CREATE POLICY activiteit_lezen ON activiteit FOR SELECT TO studio_app USING (app.is_platformbeheer() OR gebruiker = app.huidige_gebruiker());
CREATE POLICY activiteit_toevoegen ON activiteit FOR INSERT TO studio_app
  WITH CHECK (gebruiker = app.huidige_gebruiker() AND (app.is_platformbeheer() OR kantoor_id IN (SELECT app.mijn_kantoren())));
GRANT SELECT, INSERT ON activiteit TO studio_app;
GRANT USAGE ON SEQUENCE activiteit_id_seq TO studio_app;
CREATE TRIGGER activiteit_kantoor BEFORE INSERT ON activiteit FOR EACH ROW EXECUTE FUNCTION app.kantoor_volgt_project();

-- ── Uitgangspunten van een conceptversie ──
-- Waarop het concept rust: bronovername (wie, wanneer, welke bronversie) en de open onzekerheden
-- (gebruikte waarde, alternatieven, bron). Vastgelegd bij het genereren; daarna onveranderlijk.
ALTER TABLE concept ADD COLUMN uitgangspunten jsonb;
COMMENT ON COLUMN concept.uitgangspunten IS 'Bronovername en open onzekerheden op het moment van genereren (leeg bij versies van vóór migratie 008)';
