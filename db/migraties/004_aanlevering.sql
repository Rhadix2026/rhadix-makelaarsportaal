-- Stap 4: aanlevering (brochure en losse foto's), brochure-import, vastgelegde gegevens en de
-- kantoorhuisstijl (logo, merk- en detailkleur).
--
-- Drie lagen, strikt gescheiden:
--   1. brongegevens       bestand: de aangeleverde bestanden, ongewijzigd (sha256), plus de beelden
--                         die de import uit de brochure haalt (herkomst 'brochure', met pagina).
--   2. geëxtraheerd       verwerking.rapport: het importrapport van de generator, per import
--                         onveranderlijk bewaard (zonder vraagprijs).
--   3. vastgelegd         gegeven: wat wij vastleggen. Status 'overgenomen' = automatisch aangevuld
--                         uit de brochure, nog niet goedgekeurd; 'goedgekeurd' = door ons bevestigd of
--                         handmatig ingevoerd. Een goedgekeurde waarde wordt nooit automatisch vervangen.

-- ── Bestanden ───────────────────────────────────────────────────────────────
CREATE TABLE bestand (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kantoor_id     uuid NOT NULL REFERENCES kantoor (id),
  project_id     uuid REFERENCES project (id) ON DELETE CASCADE,
  soort          text NOT NULL CHECK (soort IN ('brochure', 'foto', 'plattegrond', 'logo')),
  herkomst       text NOT NULL CHECK (herkomst IN ('upload', 'brochure')),
  verwerking_id  uuid,
  originele_naam text NOT NULL,
  mime           text NOT NULL,
  grootte        bigint NOT NULL CHECK (grootte > 0),
  sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  breedte        int,
  hoogte         int,
  dhash          text,
  pagina         int,
  hoofdstuk      text,
  opslag         text NOT NULL,
  dubbel_van     uuid REFERENCES bestand (id) ON DELETE SET NULL,
  dubbel_reden   text,
  classificatie  jsonb,
  vervallen      boolean NOT NULL DEFAULT false,
  geupload_door  uuid REFERENCES gebruiker (id),
  geupload_op    timestamptz NOT NULL DEFAULT now(),
  CHECK ((soort = 'logo') = (project_id IS NULL) OR (soort = 'logo' AND herkomst = 'brochure'))
);
COMMENT ON COLUMN bestand.vervallen IS 'Beeld uit een eerdere import dat door een nieuwe import is vervangen; blijft bewaard';
COMMENT ON COLUMN bestand.dubbel_van IS 'Zelfde beeld (dHash) als een ander bestand van betere kwaliteit; wordt niet gebruikt';
CREATE INDEX bestand_project ON bestand (project_id);
CREATE INDEX bestand_kantoor ON bestand (kantoor_id);
-- Hetzelfde bestand twee keer uploaden in één project levert geen tweede rij op.
CREATE UNIQUE INDEX bestand_uniek_upload ON bestand (project_id, sha256) WHERE herkomst = 'upload' AND project_id IS NOT NULL;

-- ── Verwerkingen (taakwachtrij: één tegelijk) ───────────────────────────────
CREATE TABLE verwerking (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  kantoor_id       uuid NOT NULL REFERENCES kantoor (id),
  soort            text NOT NULL CHECK (soort IN ('brochure-import', 'foto-indeling')),
  volgnummer       int NOT NULL,
  bestand_id       uuid REFERENCES bestand (id),
  status           text NOT NULL DEFAULT 'wachtrij' CHECK (status IN ('wachtrij', 'bezig', 'klaar', 'mislukt')),
  aangevraagd_door uuid NOT NULL REFERENCES gebruiker (id),
  aangevraagd_op   timestamptz NOT NULL DEFAULT now(),
  gestart_op       timestamptz,
  klaar_op         timestamptz,
  duur_ms          int,
  stappen          jsonb,
  rapport          jsonb,
  controle         jsonb,
  generator_commit text,
  fout             text,
  UNIQUE (project_id, volgnummer)
);
CREATE INDEX verwerking_wachtrij ON verwerking (aangevraagd_op) WHERE status IN ('wachtrij', 'bezig');
ALTER TABLE bestand ADD CONSTRAINT bestand_verwerking FOREIGN KEY (verwerking_id) REFERENCES verwerking (id) ON DELETE SET NULL;

-- ── Vastgelegde gegevens ────────────────────────────────────────────────────
CREATE TABLE gegeven (
  project_id       uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  kantoor_id       uuid NOT NULL REFERENCES kantoor (id),
  sleutel          text NOT NULL CHECK (sleutel ~ '^[a-z][a-z0-9_:.-]*$'),
  label            text NOT NULL,
  waarde           jsonb NOT NULL,
  eenheid          text,
  herkomst         text NOT NULL CHECK (herkomst IN ('brochure', 'handmatig')),
  status           text NOT NULL CHECK (status IN ('overgenomen', 'goedgekeurd')),
  verwerking_id    uuid REFERENCES verwerking (id) ON DELETE SET NULL,
  bron             text,
  gewijzigd_door   uuid REFERENCES gebruiker (id),
  gewijzigd_op     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, sleutel),
  CHECK (herkomst = 'brochure' OR status = 'goedgekeurd')
);
COMMENT ON TABLE gegeven IS 'Laag 3: door ons vastgelegde woninggegevens. Handmatig = altijd goedgekeurd';

-- ── Opgeslagen aanleveringen (momentopname, zonder website te genereren) ────
CREATE TABLE aanlevering (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  kantoor_id     uuid NOT NULL REFERENCES kantoor (id),
  versie         int NOT NULL,
  verwerking_id  uuid REFERENCES verwerking (id) ON DELETE SET NULL,
  inhoud         jsonb NOT NULL,
  opgeslagen_door uuid NOT NULL REFERENCES gebruiker (id),
  opgeslagen_op  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, versie)
);

-- ── Kantoorhuisstijl ────────────────────────────────────────────────────────
ALTER TABLE kantoor ADD COLUMN logo_id uuid REFERENCES bestand (id) ON DELETE SET NULL;
ALTER TABLE kantoor ADD COLUMN detailkleur text CHECK (detailkleur ~ '^#[0-9A-F]{6}$');
ALTER TABLE kantoor ADD COLUMN huisstijl_herkomst text CHECK (huisstijl_herkomst IN ('handmatig', 'logo'));
ALTER TABLE kantoor ADD COLUMN huisstijl_voorstel jsonb;
COMMENT ON COLUMN kantoor.huisstijl_voorstel IS 'Kleuren afgeleid uit het logo (generator: logoKleuren/huisstijlVoorstel); pas na bevestiging in merkkleur/detailkleur';

-- ── Gegevensscheiding: lezen = platform of eigen kantoor; schrijven = platform ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bestand', 'verwerking', 'gegeven', 'aanlevering'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO studio_app USING (app.is_platformbeheer() OR kantoor_id IN (SELECT app.mijn_kantoren()))', t || '_lezen', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO studio_app WITH CHECK (app.is_platformbeheer())', t || '_toevoegen', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO studio_app USING (app.is_platformbeheer()) WITH CHECK (app.is_platformbeheer())', t || '_wijzigen', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE TO studio_app USING (app.is_platformbeheer())', t || '_verwijderen', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO studio_app', t);
  END LOOP;
END $$;

-- Het kantoor van een bestand, verwerking, gegeven of aanlevering is altijd dat van het project.
CREATE FUNCTION app.kantoor_volgt_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NEW.kantoor_id IS DISTINCT FROM (SELECT kantoor_id FROM project WHERE id = NEW.project_id) THEN
    RAISE EXCEPTION 'kantoor_id hoort bij een ander project' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bestand_kantoor BEFORE INSERT OR UPDATE ON bestand FOR EACH ROW EXECUTE FUNCTION app.kantoor_volgt_project();
CREATE TRIGGER verwerking_kantoor BEFORE INSERT OR UPDATE ON verwerking FOR EACH ROW EXECUTE FUNCTION app.kantoor_volgt_project();
CREATE TRIGGER gegeven_kantoor BEFORE INSERT OR UPDATE ON gegeven FOR EACH ROW EXECUTE FUNCTION app.kantoor_volgt_project();
CREATE TRIGGER aanlevering_kantoor BEFORE INSERT OR UPDATE ON aanlevering FOR EACH ROW EXECUTE FUNCTION app.kantoor_volgt_project();
