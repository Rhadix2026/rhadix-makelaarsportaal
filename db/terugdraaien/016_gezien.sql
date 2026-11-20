-- Terugdraaien van migratie 016 (gezien). Uitvoeren als eigenaar van de database, in één transactie:
--   psql -v ON_ERROR_STOP=1 -1 -f db/terugdraaien/016_gezien.sql
-- Verwijdert alleen de bekeken-tijdstippen. Verbeterpunten, projecten, concepten, besluiten en audit blijven
-- ongewijzigd; na opnieuw migreren telt alles wat open is weer als nieuw (er is dan nog niets bekeken).
DROP TABLE gezien;
DELETE FROM schema_migratie WHERE naam = '016_gezien.sql';
