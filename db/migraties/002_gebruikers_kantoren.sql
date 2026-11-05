-- Stap 2: gebruikers, makelaarskantoren, lidmaatschappen, sessies en audit.
--
-- Gegevensscheiding zit in de database zelf (Row Level Security). De API voert elke
-- gebruikersvraag uit onder de rol studio_app (geen eigenaar, geen superuser), met de
-- ingelogde gebruiker in de transactie-instelling app.gebruiker. Zonder die instelling ziet
-- studio_app niets. Platformbeheer ziet alle kantoren; andere gebruikers alleen de kantoren
-- waarvan ze lid zijn. Alleen platformbeheer wijzigt kantoren en lidmaatschappen (eerste fase).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studio_app') THEN
    CREATE ROLE studio_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA app;

-- ── Gebruikers ──────────────────────────────────────────────────────────────
-- Voorbereid op SSO: een gebruiker heeft een wachtwoord (methode 'wachtwoord') of later een
-- externe identiteit (extern_bron + extern_id, bijvoorbeeld een OIDC-subject).
CREATE TABLE gebruiker (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,
  naam            text NOT NULL,
  wachtwoord_hash text,
  extern_bron     text,
  extern_id       text,
  platformrol     text CHECK (platformrol IN ('platformbeheer')),
  actief          boolean NOT NULL DEFAULT true,
  aangemaakt_op   timestamptz NOT NULL DEFAULT now(),
  CHECK (wachtwoord_hash IS NOT NULL OR extern_id IS NOT NULL),
  CHECK ((extern_bron IS NULL) = (extern_id IS NULL))
);
CREATE UNIQUE INDEX gebruiker_email ON gebruiker (lower(email));
CREATE UNIQUE INDEX gebruiker_extern ON gebruiker (extern_bron, extern_id) WHERE extern_id IS NOT NULL;

-- ── Makelaarskantoren ───────────────────────────────────────────────────────
CREATE TABLE kantoor (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  naam              text NOT NULL CHECK (length(trim(naam)) > 0),
  slug              text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  telefoon          text,
  email             text,
  website           text,
  adresregels       text[] NOT NULL DEFAULT '{}',
  standaard_profiel text,
  merkkleur         text CHECK (merkkleur ~ '^#[0-9A-Fa-f]{6}$'),
  status            text NOT NULL DEFAULT 'actief' CHECK (status IN ('actief', 'inactief')),
  aangemaakt_op     timestamptz NOT NULL DEFAULT now(),
  gewijzigd_op      timestamptz NOT NULL DEFAULT now()
);

-- ── Lidmaatschap: welke gebruiker hoort bij welk kantoor, met welke rol ──────
CREATE TABLE lidmaatschap (
  gebruiker_id  uuid NOT NULL REFERENCES gebruiker (id) ON DELETE CASCADE,
  kantoor_id    uuid NOT NULL REFERENCES kantoor (id) ON DELETE CASCADE,
  rol           text NOT NULL CHECK (rol IN ('makelaar', 'kantoorbeheerder')),
  aangemaakt_op timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gebruiker_id, kantoor_id)
);

-- ── Sessies (alleen de hash van het token staat in de database) ─────────────
CREATE TABLE sessie (
  token_hash    text PRIMARY KEY,
  gebruiker_id  uuid NOT NULL REFERENCES gebruiker (id) ON DELETE CASCADE,
  methode       text NOT NULL DEFAULT 'wachtwoord',
  aangemaakt_op timestamptz NOT NULL DEFAULT now(),
  verloopt_op   timestamptz NOT NULL
);
CREATE INDEX sessie_gebruiker ON sessie (gebruiker_id);

-- ── Audit: elke wijziging, met wie, wat, oud en nieuw ───────────────────────
CREATE TABLE auditregel (
  id            bigserial PRIMARY KEY,
  gebruiker_id  uuid REFERENCES gebruiker (id),
  actie         text NOT NULL,
  tabel         text NOT NULL,
  rij_id        text,
  oud           jsonb,
  nieuw         jsonb,
  tijd          timestamptz NOT NULL DEFAULT now()
);

-- ── Hulpfuncties voor de beleidsregels ──────────────────────────────────────
-- SECURITY DEFINER: lezen gebruiker en lidmaatschap zonder zelf door RLS te worden beperkt.
CREATE FUNCTION app.huidige_gebruiker() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.gebruiker', true), '')::uuid $$;

CREATE FUNCTION app.is_platformbeheer() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM gebruiker
                   WHERE id = app.huidige_gebruiker() AND actief AND platformrol = 'platformbeheer') $$;

CREATE FUNCTION app.mijn_kantoren() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT l.kantoor_id FROM lidmaatschap l JOIN gebruiker g ON g.id = l.gebruiker_id
    WHERE l.gebruiker_id = app.huidige_gebruiker() AND g.actief $$;

-- ── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE kantoor ENABLE ROW LEVEL SECURITY;
ALTER TABLE kantoor FORCE ROW LEVEL SECURITY;
CREATE POLICY kantoor_lezen ON kantoor FOR SELECT TO studio_app
  USING (app.is_platformbeheer() OR id IN (SELECT app.mijn_kantoren()));
CREATE POLICY kantoor_toevoegen ON kantoor FOR INSERT TO studio_app WITH CHECK (app.is_platformbeheer());
CREATE POLICY kantoor_wijzigen ON kantoor FOR UPDATE TO studio_app
  USING (app.is_platformbeheer()) WITH CHECK (app.is_platformbeheer());
CREATE POLICY kantoor_verwijderen ON kantoor FOR DELETE TO studio_app USING (app.is_platformbeheer());

ALTER TABLE lidmaatschap ENABLE ROW LEVEL SECURITY;
ALTER TABLE lidmaatschap FORCE ROW LEVEL SECURITY;
CREATE POLICY lidmaatschap_lezen ON lidmaatschap FOR SELECT TO studio_app
  USING (app.is_platformbeheer() OR gebruiker_id = app.huidige_gebruiker());
CREATE POLICY lidmaatschap_beheer ON lidmaatschap FOR ALL TO studio_app
  USING (app.is_platformbeheer()) WITH CHECK (app.is_platformbeheer());

ALTER TABLE gebruiker ENABLE ROW LEVEL SECURITY;
ALTER TABLE gebruiker FORCE ROW LEVEL SECURITY;
CREATE POLICY gebruiker_lezen ON gebruiker FOR SELECT TO studio_app
  USING (app.is_platformbeheer() OR id = app.huidige_gebruiker());
CREATE POLICY gebruiker_beheer ON gebruiker FOR ALL TO studio_app
  USING (app.is_platformbeheer()) WITH CHECK (app.is_platformbeheer());

ALTER TABLE auditregel ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditregel FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_schrijven ON auditregel FOR INSERT TO studio_app
  WITH CHECK (gebruiker_id = app.huidige_gebruiker());
CREATE POLICY audit_lezen ON auditregel FOR SELECT TO studio_app USING (app.is_platformbeheer());

-- Sessies: alleen via de systeemverbinding (inloggen), nooit onder studio_app.
ALTER TABLE sessie ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessie FORCE ROW LEVEL SECURITY;

-- ── Rechten voor studio_app ─────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public, app TO studio_app;
GRANT EXECUTE ON FUNCTION app.huidige_gebruiker(), app.is_platformbeheer(), app.mijn_kantoren() TO studio_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON kantoor, lidmaatschap, gebruiker TO studio_app;
GRANT SELECT, INSERT ON auditregel TO studio_app;
GRANT USAGE ON SEQUENCE auditregel_id_seq TO studio_app;
