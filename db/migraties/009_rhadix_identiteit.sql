-- Aansluiting op de centrale Rhadix-identiteit (Datavalidatie als identity provider).
--
-- Gebruikers van Rhadix krijgen hier een gebruiker met extern_bron 'rhadix' en extern_id = het
-- subject (gebruikers-ID) uit het centrale token; zonder wachtwoord. Rol en kantoorlidmaatschap
-- volgen bij elk verzoek uit het token (api/src/rhadixsso.ts).
--
-- Een kantoor hoort bij precies één Rhadix-organisatie, gekoppeld op het organisatie-ID
-- (tenant_id), NOOIT op de naam: twee organisaties met dezelfde naam blijven gescheiden en een
-- naamswijziging verandert niets aan de koppeling. Platformbeheer legt de koppeling vast.

-- Organisaties die zich hebben aangemeld (ID en laatst bekende naam), zodat platformbeheer een
-- kantoor kan koppelen zonder het ID over te typen. Alleen informatief: de koppeling zelf staat op kantoor.
CREATE TABLE rhadix_organisatie (
  tenant_id     uuid PRIMARY KEY,
  naam          text NOT NULL,
  eerst_gezien  timestamptz NOT NULL DEFAULT now(),
  laatst_gezien timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE kantoor ADD COLUMN rhadix_tenant_id uuid UNIQUE;
ALTER TABLE gebruiker ADD COLUMN rhadix_tenant_id uuid;

ALTER TABLE rhadix_organisatie ENABLE ROW LEVEL SECURITY;
ALTER TABLE rhadix_organisatie FORCE ROW LEVEL SECURITY;
CREATE POLICY rhadix_organisatie_lezen ON rhadix_organisatie FOR SELECT TO studio_app USING (app.is_platformbeheer());
GRANT SELECT ON rhadix_organisatie TO studio_app;
