// Migratie 016 (gezien) en terugdraaien: alleen de bekeken-tijdstippen verdwijnen; verbeterpunten, concepten,
// projecten, besluiten en audit blijven ongewijzigd. Een migratie die faalt, laat niets achter.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migreer, pool } from '../api/src/db.ts';
import { ROOT } from '../api/src/config.ts';
import { maakGebruiker } from './hulp.ts';

const TERUG = readFileSync(join(ROOT, 'db', 'terugdraaien', '016_gezien.sql'), 'utf8');
async function terugdraaien() {
  const x = await pool.connect();
  try { await x.query('BEGIN'); await x.query(TERUG); await x.query('COMMIT'); } catch (e) { await x.query('ROLLBACK'); throw e; } finally { x.release(); }
}
const bestaat = async () => (await pool.query("SELECT to_regclass('public.gezien') IS NOT NULL AS b")).rows[0].b as boolean;
const toegepast = async () => (await pool.query("SELECT 1 FROM schema_migratie WHERE naam = '016_gezien.sql'")).rowCount === 1;
const vinger = async () => (await pool.query(`SELECT md5(string_agg(t, '|' ORDER BY t)) AS v FROM (
  SELECT 'v' || id || status || coalesce(reactie, '') || bijgewerkt_op AS t FROM verbeterpunt UNION ALL SELECT 'c' || id || status FROM concept
  UNION ALL SELECT 'p' || id || status FROM project UNION ALL SELECT 'b' || id FROM besluit UNION ALL SELECT 'a' || count(*) FROM auditregel) x`)).rows[0].v as string;
let G = '';
before(async () => { await migreer(); G = await maakGebruiker('g@studio.test', { platform: true }); });

test('terugdraaien en opnieuw migreren: alleen de tijdstippen, de rest ongewijzigd', async () => {
  await pool.query(`INSERT INTO gezien (gebruiker_id, onderwerp) VALUES ($1, 'verbeterpunten')`, [G]);
  const voor = await vinger();
  await terugdraaien();
  assert.equal(await bestaat(), false); assert.equal(await toegepast(), false);
  assert.equal(await vinger(), voor);
  assert.deepEqual(await migreer(), ['016_gezien.sql']);
  assert.equal(await bestaat(), true); assert.equal(await vinger(), voor);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM gezien')).rows[0].n, 0, 'tijdstippen weg: alles telt weer als nieuw (gedocumenteerd)');
});

test('een migratie die faalt, laat niets achter', async () => {
  await terugdraaien();
  await pool.query('CREATE TABLE gezien (x int)');               // botsing: migratie 016 faalt
  await assert.rejects(migreer());
  assert.equal(await toegepast(), false);
  assert.deepEqual((await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'gezien'`)).rows.map((r) => r.column_name), ['x'], 'niets half aangemaakt');
  await pool.query('DROP TABLE gezien');
  assert.deepEqual(await migreer(), ['016_gezien.sql']);
});
