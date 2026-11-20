-- Wanneer heeft een gebruiker de aandachtspunten voor het laatst bekeken (inlogmelding en aandachtspaneel;
-- ontwerp docs/VOORSTEL-AANDACHTSPANEEL.md). Eén tijdstip per gebruiker en onderwerp; geen kopie van
-- verbeterpunten, geen tweede takenadministratie.
--
-- Het tijdstip wordt ALLEEN gezet als de gebruiker de verbeterpunten bewust opent (Bekijk verbeterpunten /
-- de lijst Verbeterpunten). Het dashboard openen of een melding wegklikken ('Later') zet niets. Bekijken
-- verandert nooit de status van een verbeterpunt: open blijft open.
-- Terugdraaien: db/terugdraaien/016_gezien.sql.

CREATE TABLE gezien (
  gebruiker_id uuid NOT NULL REFERENCES gebruiker (id) ON DELETE CASCADE,
  onderwerp    text NOT NULL CHECK (onderwerp IN ('verbeterpunten')),   -- later: andere workflowacties
  gezien_op    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gebruiker_id, onderwerp)
);
COMMENT ON TABLE gezien IS 'Per gebruiker en onderwerp: wanneer de aandachtspunten voor het laatst bewust zijn bekeken';

ALTER TABLE gezien ENABLE ROW LEVEL SECURITY;
ALTER TABLE gezien FORCE ROW LEVEL SECURITY;
-- Alleen de eigen rij: lezen, vastleggen en bijwerken. Ook platformbeheer ziet niet wanneer een ander keek.
CREATE POLICY gezien_eigen ON gezien FOR ALL TO studio_app
  USING (gebruiker_id = app.huidige_gebruiker()) WITH CHECK (gebruiker_id = app.huidige_gebruiker());
GRANT SELECT, INSERT, UPDATE (gezien_op) ON gezien TO studio_app;
