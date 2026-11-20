// Migratie 015 (verbeterpunten) en het terugdraaien daarvan, zonder gegevensverlies:
//   1. terugdraaien → oude toestand (jsonb-registratie, schrijfbaar), schema_migratie zonder 015;
//   2. bestaande punten in jsonb (oud formaat, ook zonder geldige indiener) → migratie neemt ze over met
//      telcontrole; concepten, projecten, besluiten en audit ongewijzigd; archief bevroren;
//   3. nieuwe punten en afhandeling → terugdraaien schrijft ALLES terug (met status) → opnieuw migreren
//      geeft exact dezelfde punten (zelfde id, status, reactie, verwerkt in);
//   4. een migratie die halverwege faalt, laat niets achter (transactie).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bouwApp } from '../api/src/server.ts';
import { migreer, pool } from '../api/src/db.ts';
import { ROOT } from '../api/src/config.ts';
import { login, maakGebruiker, maakKantoorDirect } from './hulp.ts';

const TERUG = readFileSync(join(ROOT, 'db', 'terugdraaien', '015_verbeterpunten.sql'), 'utf8');
const app = bouwApp();
let A = '', P = '', K1 = '', K2 = '', BEHEER = '', MKA = '';
const c: Record<string, string> = {};

async function terugdraaien() {
  const x = await pool.connect();
  try { await x.query('BEGIN'); await x.query(TERUG); await x.query('COMMIT'); }
  catch (e) { await x.query('ROLLBACK'); throw e; } finally { x.release(); }
}
const bestaat = async () => (await pool.query("SELECT to_regclass('public.verbeterpunt') IS NOT NULL AS b")).rows[0].b as boolean;
const toegepast = async () => (await pool.query("SELECT 1 FROM schema_migratie WHERE naam = '015_verbeterpunten.sql'")).rowCount === 1;
// Vingerafdruk van alles behalve de verbeterpunten zelf.
const vinger = async () => (await pool.query(`SELECT md5(string_agg(t, '|' ORDER BY t)) AS v FROM (
  SELECT 'c' || id || versie || status || coalesce(motivering, '') || coalesce(beoordeeld_op::text, '') AS t FROM concept
  UNION ALL SELECT 'p' || id || naam || status FROM project
  UNION ALL SELECT 'b' || id || onderwerp || handeling FROM besluit
  UNION ALL SELECT 'a' || count(*) FROM auditregel) x`)).rows[0].v as string;

before(async () => {
  await migreer();
  A = await maakKantoorDirect('Kantoor A', 'kantoor-a');
  BEHEER = await maakGebruiker('beheer@studio.test', { platform: true });
  MKA = await maakGebruiker('mka@studio.test', { kantoren: [[A, 'makelaar']] });
  c.beheer = await login(app, 'beheer@studio.test'); c.mka = await login(app, 'mka@studio.test');
  P = (await req('mka', 'POST', '/api/projecten', { kantoor_id: A, naam: 'Woning' })).json().id;
  await pool.query("UPDATE project SET status = 'interne_review' WHERE id = $1", [P]);
  const maak = async (v: number) => (await pool.query(`INSERT INTO concept (project_id, kantoor_id, versie, map, invoer_vingerafdruk, build_vingerafdruk, ontwerpsysteem, profiel,
      generator_commit, bouw, metingen, voorbeeld_token, aangemaakt_door, beoordeeld_door)
    VALUES ($1, $2, $3, 'x', 'x', 'x', '1.0', 'buitenplaats', 'x', '{}', '{}', $4, $5, $5) RETURNING id`, [P, A, v, randomBytes(32).toString('base64url'), BEHEER])).rows[0].id as string;
  K1 = await maak(1); K2 = await maak(2);
});
after(() => app.close());
const req = (wie: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => app.inject({ method, url, headers: { cookie: c[wie] }, payload });

test('terugdraaien zonder punten: oude toestand, schrijfbare jsonb-registratie', async () => {
  assert.equal(await bestaat(), true); assert.equal(await toegepast(), true);
  await terugdraaien();
  assert.equal(await bestaat(), false); assert.equal(await toegepast(), false);
  // Oude toestand: de jsonb-kolom is weer schrijfbaar voor studio_app (zoals vóór 015).
  const r = await pool.query(`SELECT has_column_privilege('studio_app', 'concept', 'verbeterpunten', 'UPDATE') AS u`);
  assert.equal(r.rows[0].u, true);
});

test('overname: bestaande jsonb-punten (oud formaat) → tabel, telcontrole, rest ongewijzigd, archief bevroren', async () => {
  const oud = [
    { onderdeel: 'openingsbeeld', tekst: 'Andere openingsfoto', door: MKA, op: '2026-11-18T10:00:00Z' },
    { onderdeel: 'teksten', tekst: 'Kop aanvullen', door: BEHEER, op: '2026-11-18T10:01:00Z' },
    { onderdeel: 'algemeen', tekst: 'Oud punt zonder geldige indiener', door: 'onbekend', op: '2026-11-18T10:02:00Z' },
  ];
  await pool.query('UPDATE concept SET verbeterpunten = $2 WHERE id = $1', [K1, JSON.stringify(oud)]);
  const voor = await vinger();
  assert.deepEqual(await migreer(), ['015_verbeterpunten.sql']);
  const rijen = (await pool.query('SELECT onderdeel, tekst, status, herkomst, ingediend_door, concept_id FROM verbeterpunt ORDER BY ingediend_op')).rows;
  assert.equal(rijen.length, 3, 'alle punten overgenomen');
  assert.ok(rijen.every((r) => r.status === 'OPEN' && r.herkomst === 'overgenomen' && r.concept_id === K1));
  assert.deepEqual(rijen.map((r) => r.ingediend_door), [MKA, BEHEER, BEHEER], 'zonder geldige indiener: de beoordelaar van de versie');
  assert.equal(await vinger(), voor, 'concepten, projecten, besluiten en audit ongewijzigd');
  assert.equal((await pool.query('SELECT jsonb_array_length(verbeterpunten) AS n FROM concept WHERE id = $1', [K1])).rows[0].n, 3, 'archief blijft staan');
  assert.equal((await pool.query(`SELECT has_column_privilege('studio_app', 'concept', 'verbeterpunten', 'UPDATE') AS u`)).rows[0].u, false, 'archief bevroren');
  // De API toont de overgenomen punten.
  assert.equal((await req('mka', 'GET', `/api/projecten/${P}/verbeterpunten`)).json().length, 3);
});

test('heen en terug zonder verlies: nieuwe punten en afhandeling overleven terugdraaien en opnieuw migreren', async () => {
  assert.equal((await req('mka', 'POST', `/api/concepten/${K1}/verbeterpunten`, { punten: [{ onderdeel: 'mobiel', tekst: 'Menu loopt over op mobiel' }] })).statusCode, 201);
  const lijst = (await req('beheer', 'GET', `/api/projecten/${P}/verbeterpunten`)).json() as { id: string; tekst: string }[];
  const menu = lijst.find((p) => p.tekst.startsWith('Menu'))!, foto = lijst.find((p) => p.tekst.startsWith('Andere'))!, kop = lijst.find((p) => p.tekst.startsWith('Kop'))!;
  await req('beheer', 'PATCH', `/api/verbeterpunten/${menu.id}`, { status: 'IN_BEHANDELING' });
  await req('beheer', 'PATCH', `/api/verbeterpunten/${foto.id}`, { status: 'KLAAR', verwerkt_in_versie: 2, reactie: 'Voorgevel als openingsfoto.' });
  await req('beheer', 'PATCH', `/api/verbeterpunten/${kop.id}`, { status: 'GEANNULEERD', reactie: 'Kop staat zo in de brochure.' });
  const staat = async () => (await pool.query(`SELECT id, concept_id, onderdeel, tekst, status, ingediend_door, ingediend_op, behandelaar, reactie,
      afgehandeld_door, afgehandeld_op, verwerkt_in, herkomst FROM verbeterpunt ORDER BY id`)).rows;
  const voor = await staat(); const vingerVoor = await vinger();
  assert.equal(voor.length, 4);

  await terugdraaien();
  assert.equal(await bestaat(), false);
  const terug = (await pool.query('SELECT verbeterpunten FROM concept WHERE id = $1', [K1])).rows[0].verbeterpunten as { id: string; status: string; verwerkt_in?: string }[];
  assert.equal(terug.length, 4, 'alles teruggeschreven, ook het nieuwe punt');
  assert.equal(terug.find((x) => x.id === foto.id)!.verwerkt_in, K2, 'met status en verwerkt in');

  assert.deepEqual(await migreer(), ['015_verbeterpunten.sql']);
  assert.deepEqual(await staat(), voor, 'na opnieuw migreren exact dezelfde punten');
  assert.equal(await vinger(), vingerVoor, 'overige gegevens ongewijzigd');
});

test('een migratie die faalt, laat niets achter (transactie)', async () => {
  await terugdraaien();
  const archief = (await pool.query('SELECT verbeterpunten FROM concept WHERE id = $1', [K1])).rows[0].verbeterpunten;
  // Een ongeldig element (KLAAR zonder versie) laat de overname falen.
  await pool.query(`UPDATE concept SET verbeterpunten = verbeterpunten || '[{"onderdeel":"x","tekst":"ongeldig element","status":"KLAAR"}]'::jsonb WHERE id = $1`, [K2]);
  await assert.rejects(migreer());
  assert.equal(await bestaat(), false, 'geen halve tabel'); assert.equal(await toegepast(), false);
  assert.deepEqual((await pool.query('SELECT verbeterpunten FROM concept WHERE id = $1', [K1])).rows[0].verbeterpunten, archief, 'archief onaangetast');
  // Herstel en opnieuw: lukt.
  await pool.query(`UPDATE concept SET verbeterpunten = '[]' WHERE id = $1`, [K2]);
  assert.deepEqual(await migreer(), ['015_verbeterpunten.sql']);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM verbeterpunt')).rows[0].n, 4);
});
