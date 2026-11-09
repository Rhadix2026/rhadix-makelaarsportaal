-- Rollen binnen het kantoor: makelaarskantoren werken zelfstandig in hun eigen kantoor.
--
--   platformbeheer    alles, op alle kantoren (ongewijzigd)
--   kantoorbeheerder  productiewerk in het eigen kantoor, plus: kantoorgegevens en huisstijl van
--                     het eigen kantoor, het definitieve websiteadres en de beoordeling van concepten
--   makelaar          productiewerk in het eigen kantoor (projecten, aanlevering, verwerking,
--                     gegevens, beslissingen voor een eerste concept, concept genereren)
--
-- De scheiding tussen kantoren blijft: alles hangt aan app.mijn_kantoren() (lidmaatschap, bij de
-- Rhadix-login afgeleid van het organisatie-ID). Publicatie bestaat niet en blijft hier ook voor
-- kantoren onmogelijk: de statussen na de conceptfase zijn voorbehouden aan platformbeheer.
-- Systeemprocessen (verwerker, migraties) draaien niet onder studio_app en vallen hier buiten.

CREATE FUNCTION app.mag_produceren(k uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT app.is_platformbeheer() OR k IN (SELECT app.mijn_kantoren()) $$;

CREATE FUNCTION app.is_kantoorbeheer(k uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT app.is_platformbeheer() OR EXISTS (
      SELECT 1 FROM lidmaatschap l JOIN gebruiker g ON g.id = l.gebruiker_id
      WHERE l.gebruiker_id = app.huidige_gebruiker() AND g.actief AND l.kantoor_id = k AND l.rol = 'kantoorbeheerder') $$;

GRANT EXECUTE ON FUNCTION app.mag_produceren(uuid), app.is_kantoorbeheer(uuid) TO studio_app;

-- ── Woningprojecten: aanmaken en wijzigen in het eigen kantoor; verwijderen blijft platform ──
DROP POLICY project_toevoegen ON project;
DROP POLICY project_wijzigen ON project;
CREATE POLICY project_toevoegen ON project FOR INSERT TO studio_app WITH CHECK (app.mag_produceren(kantoor_id));
CREATE POLICY project_wijzigen ON project FOR UPDATE TO studio_app
  USING (app.mag_produceren(kantoor_id)) WITH CHECK (app.mag_produceren(kantoor_id));

-- Bewaking per kolom (RLS werkt per rij): het definitieve domein alleen door de kantoorbeheerder;
-- statussen voorbij de conceptfase (publicatie e.d.) alleen door platformbeheer.
CREATE FUNCTION app.bewaak_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'studio_app' OR app.is_platformbeheer() THEN RETURN NEW; END IF;
  IF NEW.domein IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.domein IS DISTINCT FROM OLD.domein)
     AND NOT app.is_kantoorbeheer(NEW.kantoor_id) THEN
    RAISE EXCEPTION 'het definitieve websiteadres is voorbehouden aan de kantoorbeheerder' USING ERRCODE = '42501';
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.status <> 'aanlevering_incompleet')
     OR (TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NOT (
       NEW.status IN ('aanlevering_incompleet', 'klaar_voor_productie')
       OR (NEW.status = 'correctie' AND app.is_kantoorbeheer(NEW.kantoor_id)))) THEN
    RAISE EXCEPTION 'deze status is voorbehouden aan platformbeheer' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER project_bewaking BEFORE INSERT OR UPDATE ON project FOR EACH ROW EXECUTE FUNCTION app.bewaak_project();

-- ── Aanlevering: bestanden, verwerkingen, gegevens, momentopnamen in het eigen kantoor ──
-- Verwijderen blijft platform; uit de aanlevering halen is een wijziging (vervallen = true).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bestand', 'verwerking', 'gegeven', 'aanlevering'] LOOP
    EXECUTE format('DROP POLICY %I ON %I', t || '_toevoegen', t);
    EXECUTE format('DROP POLICY %I ON %I', t || '_wijzigen', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO studio_app WITH CHECK (app.mag_produceren(kantoor_id))', t || '_toevoegen', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO studio_app USING (app.mag_produceren(kantoor_id)) WITH CHECK (app.mag_produceren(kantoor_id))', t || '_wijzigen', t);
  END LOOP;
END $$;

-- ── Besluitenlog: iedereen van het kantoor; de beoordeling van een concept alleen de kantoorbeheerder ──
DROP POLICY besluit_toevoegen ON besluit;
CREATE POLICY besluit_toevoegen ON besluit FOR INSERT TO studio_app WITH CHECK (
  door = app.huidige_gebruiker() AND app.mag_produceren(kantoor_id)
  AND (onderwerp NOT LIKE 'concept v%' OR app.is_kantoorbeheer(kantoor_id)));

-- ── Concepten: genereren gebeurt door de verwerker; beoordelen alleen de kantoorbeheerder ──
DROP POLICY concept_wijzigen ON concept;
CREATE POLICY concept_wijzigen ON concept FOR UPDATE TO studio_app
  USING (app.is_kantoorbeheer(kantoor_id)) WITH CHECK (app.is_kantoorbeheer(kantoor_id));

-- ── Kantoor: de kantoorbeheerder wijzigt het eigen kantoor; aanmaken en verwijderen blijft platform ──
DROP POLICY kantoor_wijzigen ON kantoor;
CREATE POLICY kantoor_wijzigen ON kantoor FOR UPDATE TO studio_app
  USING (app.is_kantoorbeheer(id)) WITH CHECK (app.is_kantoorbeheer(id));

-- Korte naam (mapnamen), status en de Rhadix-koppeling blijven bij platformbeheer.
CREATE FUNCTION app.bewaak_kantoor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'studio_app' OR app.is_platformbeheer() THEN RETURN NEW; END IF;
  IF NEW.slug IS DISTINCT FROM OLD.slug OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.rhadix_tenant_id IS DISTINCT FROM OLD.rhadix_tenant_id THEN
    RAISE EXCEPTION 'korte naam, status en Rhadix-koppeling zijn voorbehouden aan platformbeheer' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER kantoor_bewaking BEFORE UPDATE ON kantoor FOR EACH ROW EXECUTE FUNCTION app.bewaak_kantoor();
