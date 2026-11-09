-- Conceptgeneratie door kantoorgebruikers (herstel op migratie 010).
--
-- De verwerker legt een gegenereerd concept vast onder de gebruiker die het aanvroeg (rol studio_app,
-- app.gebruiker = aangevraagd_door), net als elke andere verwerking. In 010 bleven daarbij drie regels
-- op 'alleen platformbeheer' staan, waardoor een makelaar of kantoorbeheerder geen concept kon laten maken:
--   1. de INSERT-policy van concept (uit 007);
--   2. de statusbewaking van project: 'interne_review' (concept staat klaar) ontbrak in de toegestane statussen;
--   3. de besluitpolicy: 'concept vN – gegenereerd' viel onder de beoordeling (alleen kantoorbeheerder).
-- Beoordelen (accepteren, verbeterpunten) blijft voorbehouden aan de kantoorbeheerder; publicatiestatussen
-- blijven voorbehouden aan platformbeheer.

-- 1. Een concept vastleggen: alleen in het eigen kantoor, alleen op eigen naam.
DROP POLICY concept_toevoegen ON concept;
CREATE POLICY concept_toevoegen ON concept FOR INSERT TO studio_app
  WITH CHECK (app.mag_produceren(kantoor_id) AND aangemaakt_door = app.huidige_gebruiker());

-- 2. Statusbewaking: 'interne_review' (gezet bij het vastleggen van een concept) mag het kantoor ook.
CREATE OR REPLACE FUNCTION app.bewaak_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'studio_app' OR app.is_platformbeheer() THEN RETURN NEW; END IF;
  IF NEW.domein IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.domein IS DISTINCT FROM OLD.domein)
     AND NOT app.is_kantoorbeheer(NEW.kantoor_id) THEN
    RAISE EXCEPTION 'het definitieve websiteadres is voorbehouden aan de kantoorbeheerder' USING ERRCODE = '42501';
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.status <> 'aanlevering_incompleet')
     OR (TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NOT (
       NEW.status IN ('aanlevering_incompleet', 'klaar_voor_productie', 'interne_review')
       OR (NEW.status = 'correctie' AND app.is_kantoorbeheer(NEW.kantoor_id)))) THEN
    RAISE EXCEPTION 'deze status is voorbehouden aan platformbeheer' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- 3. Besluitenlog: het vastleggen van een gegenereerde versie mag iedereen van het kantoor; de
--    beoordeling van een concept (elke andere handeling op 'concept vN') blijft bij de kantoorbeheerder.
DROP POLICY besluit_toevoegen ON besluit;
CREATE POLICY besluit_toevoegen ON besluit FOR INSERT TO studio_app WITH CHECK (
  door = app.huidige_gebruiker() AND app.mag_produceren(kantoor_id)
  AND (onderwerp NOT LIKE 'concept v%' OR handeling = 'gegenereerd' OR app.is_kantoorbeheer(kantoor_id)));
