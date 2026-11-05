-- Verbeteringen stap 4: een tegenstrijdigheid of terminologische afwijking in de brochure wordt
-- alleen opgelost met een expliciet, gemotiveerd besluit. Dat besluit wordt bij het gegeven bewaard.
ALTER TABLE gegeven ADD COLUMN besluit jsonb;
COMMENT ON COLUMN gegeven.besluit IS 'Expliciet besluit over een tegenstrijdigheid: {soort, keuze, motivering, bronnen, door, op}';
