-- Stap 3: woningprojecten, en de kantoornaam gesplitst in een publieke merknaam en een
-- juridische naam. Bestaande kantoren behouden hun gegevens: de huidige naam wordt de merknaam.

ALTER TABLE kantoor RENAME COLUMN naam TO merknaam;
ALTER TABLE kantoor ADD COLUMN juridische_naam text CHECK (juridische_naam IS NULL OR length(trim(juridische_naam)) > 0);
COMMENT ON COLUMN kantoor.merknaam IS 'Publieke naam, zoals op de woningwebsites';
COMMENT ON COLUMN kantoor.juridische_naam IS 'Statutaire of handelsregisternaam, voor afspraken en facturatie';

-- ── Woningprojecten ─────────────────────────────────────────────────────────
-- Eén project = één woning bij precies één kantoor. De slug is ook de mapnaam in de
-- productie-instantie van de generator: nooit gelijk aan een referentiewoning of een
-- gereserveerd voorvoegsel (ontwerp A10).
CREATE TABLE project (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kantoor_id      uuid NOT NULL REFERENCES kantoor (id),
  slug            text NOT NULL UNIQUE
                  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80)
                  CHECK (slug NOT IN ('beusemkolkweg-16', 'landgoed-rhoderlanden', 'markt-27-wolvega', '_voorbeeld')
                         AND slug !~ '^(kalibratie|import|probe)-'),
  naam            text NOT NULL CHECK (length(trim(naam)) > 0),
  adres           text,
  postcode        text CHECK (postcode IS NULL OR postcode ~ '^[1-9][0-9]{3} [A-Z]{2}$'),
  plaats          text,
  woningtype      text CHECK (woningtype IN ('vrijstaand', 'twee-onder-een-kap', 'geschakeld', 'tussenwoning', 'hoekwoning',
                                             'appartement', 'maisonnette', 'boerderij', 'landgoed', 'overig')),
  profiel         text,
  ontwerpsysteem  text NOT NULL,
  domein          text CHECK (domein IS NULL OR domein ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  contactpersoon  text,
  status          text NOT NULL DEFAULT 'aanlevering_incompleet' CHECK (status IN (
                    'aanlevering_incompleet', 'klaar_voor_productie', 'in_productie', 'interne_review', 'ter_review',
                    'correctie', 'goedgekeurd', 'publicatiecontrole', 'live', 'onder_bod', 'verkocht', 'offline', 'archief')),
  aangemaakt_door uuid REFERENCES gebruiker (id),
  aangemaakt_op   timestamptz NOT NULL DEFAULT now(),
  gewijzigd_op    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_kantoor ON project (kantoor_id);
CREATE INDEX project_status ON project (status);

ALTER TABLE project ENABLE ROW LEVEL SECURITY;
ALTER TABLE project FORCE ROW LEVEL SECURITY;
CREATE POLICY project_lezen ON project FOR SELECT TO studio_app
  USING (app.is_platformbeheer() OR kantoor_id IN (SELECT app.mijn_kantoren()));
CREATE POLICY project_toevoegen ON project FOR INSERT TO studio_app WITH CHECK (app.is_platformbeheer());
CREATE POLICY project_wijzigen ON project FOR UPDATE TO studio_app
  USING (app.is_platformbeheer()) WITH CHECK (app.is_platformbeheer());
CREATE POLICY project_verwijderen ON project FOR DELETE TO studio_app USING (app.is_platformbeheer());

GRANT SELECT, INSERT, UPDATE, DELETE ON project TO studio_app;
