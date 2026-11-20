-- Terugdraaien van migratie 015 (verbeterpunten), zonder gegevensverlies.
--
-- Uitvoeren als de eigenaar van de database (niet als studio_app), in één transactie:
--   psql -v ON_ERROR_STOP=1 -1 -f db/terugdraaien/015_verbeterpunten.sql
--
-- 1. Elk verbeterpunt (ook de punten van na migratie 015, met status, reactie en afhandeling) wordt
--    teruggeschreven naar concept.verbeterpunten van zijn oorspronkelijke versie; telcontrole.
--    Een nieuwe toepassing van 015 neemt ze daarna weer volledig over (zelfde id en status).
-- 2. Daarna pas: trigger, functies, tabel en het bevriezen worden verwijderd en schema_migratie
--    wordt bijgewerkt. Besluitenlog en auditlog blijven ongewijzigd.

DO $$
DECLARE in_tabel int; teruggeschreven int;
BEGIN
  SELECT count(*) INTO in_tabel FROM verbeterpunt;
  UPDATE concept k SET verbeterpunten = coalesce((
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', v.id, 'onderdeel', v.onderdeel, 'tekst', v.tekst, 'door', v.ingediend_door, 'op', v.ingediend_op,
             'status', v.status, 'behandelaar', v.behandelaar, 'reactie', v.reactie, 'afgehandeld_door', v.afgehandeld_door,
             'afgehandeld_op', v.afgehandeld_op, 'verwerkt_in', v.verwerkt_in, 'herkomst', v.herkomst)) ORDER BY v.ingediend_op, v.id)
    FROM verbeterpunt v WHERE v.concept_id = k.id), '[]'::jsonb);
  SELECT coalesce(sum(jsonb_array_length(verbeterpunten)), 0) INTO teruggeschreven FROM concept;
  IF teruggeschreven <> in_tabel THEN
    RAISE EXCEPTION 'terugdraaien verbeterpunten: % in de tabel, % teruggeschreven', in_tabel, teruggeschreven;
  END IF;
  RAISE NOTICE 'verbeterpunten teruggeschreven naar concept.verbeterpunten: %', teruggeschreven;
END $$;

DROP TRIGGER concept_acceptatie ON concept;
DROP FUNCTION app.bewaak_acceptatie();
DROP FUNCTION app.verbeterpunten_indienen(uuid, jsonb);
DROP TABLE verbeterpunt;
DROP FUNCTION app.bewaak_verbeterpunt();
GRANT UPDATE (verbeterpunten) ON concept TO studio_app;
COMMENT ON COLUMN concept.verbeterpunten IS NULL;
DELETE FROM schema_migratie WHERE naam = '015_verbeterpunten.sql';
