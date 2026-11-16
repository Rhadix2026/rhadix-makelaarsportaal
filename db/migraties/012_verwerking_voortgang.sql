-- Voortgang van een lopende verwerking (brochure-import, foto-indeling): actieve fase, tellingen
-- en een geschat percentage, bijgewerkt door de verwerker (systeemverbinding). Valt onder de
-- bestaande RLS van verwerking: lezen alleen voor platformbeheer en het eigen kantoor.
ALTER TABLE verwerking ADD COLUMN voortgang jsonb;
COMMENT ON COLUMN verwerking.voortgang IS 'Lopende voortgang: { fase, fase_nr, fasen, stap, klaar, totaal, percentage, bijgewerkt }; zie api/src/voortgang.ts';
