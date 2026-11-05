// Stap 2: gegevensscheiding tussen kantoren, getoetst via de API én rechtstreeks in de database (RLS).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bouwApp } from '../api/src/server.ts';
import { alsGebruiker, migreer, pool } from '../api/src/db.ts';
import { login, maakGebruiker, maakKantoorDirect } from './hulp.ts';

const app = bouwApp();
let A = '', B = '', beheer = '', makelaarA = '', zonderKantoor = '';
const c: Record<string, string> = {};

before(async () => {
  await migreer();
  A = await maakKantoorDirect('Kantoor A', 'kantoor-a');
  B = await maakKantoorDirect('Kantoor B', 'kantoor-b');
  beheer = await maakGebruiker('beheer@studio.test', { platform: true });
  makelaarA = await maakGebruiker('a@studio.test', { kantoren: [[A, 'makelaar']] });
  await maakGebruiker('b@studio.test', { kantoren: [[B, 'kantoorbeheerder']] });
  zonderKantoor = await maakGebruiker('los@studio.test');
  for (const e of ['beheer', 'a', 'b', 'los']) c[e] = await login(app, `${e}@studio.test`);
});
after(() => app.close());

const get = (wie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie: c[wie] } });
const namen = async (wie: string) => (await get(wie, '/api/kantoren')).json().map((k: { naam: string }) => k.naam);

test('platformbeheer ziet alle kantoren', async () => {
  assert.deepEqual(await namen('beheer'), ['Kantoor A', 'Kantoor B']);
});

test('een makelaar ziet alleen het eigen kantoor', async () => {
  assert.deepEqual(await namen('a'), ['Kantoor A']);
  assert.deepEqual(await namen('b'), ['Kantoor B']);
});

test('een gebruiker zonder kantoor ziet niets', async () => {
  assert.deepEqual(await namen('los'), []);
});

test('een ander kantoor opvragen geeft 404 (bestaan wordt niet verraden)', async () => {
  assert.equal((await get('a', `/api/kantoren/${B}`)).statusCode, 404);
  assert.equal((await get('a', `/api/kantoren/${A}`)).statusCode, 200);
  assert.equal((await get('beheer', `/api/kantoren/${B}`)).statusCode, 200);
});

test('een makelaar kan geen kantoor aanmaken of wijzigen, ook niet het eigen kantoor', async () => {
  const nieuw = await app.inject({ method: 'POST', url: '/api/kantoren', headers: { cookie: c.a }, payload: { naam: 'Eigen kantoor' } });
  assert.equal(nieuw.statusCode, 403);
  const eigen = await app.inject({ method: 'PUT', url: `/api/kantoren/${A}`, headers: { cookie: c.a }, payload: { naam: 'Gewijzigd' } });
  assert.equal(eigen.statusCode, 403);
  const ander = await app.inject({ method: 'PUT', url: `/api/kantoren/${B}`, headers: { cookie: c.b }, payload: { naam: 'Gewijzigd' } });
  assert.equal(ander.statusCode, 403, 'ook een kantoorbeheerder wijzigt in de eerste fase niets');
  assert.deepEqual(await namen('beheer'), ['Kantoor A', 'Kantoor B'], 'niets veranderd');
});

test('alleen platformbeheer ziet de systeempagina', async () => {
  assert.equal((await get('a', '/api/status')).statusCode, 403);
  assert.equal((await get('beheer', '/api/status')).statusCode, 200);
});

test('de lijst met kantoorleden toont een makelaar alleen zichzelf', async () => {
  const k = (await get('a', `/api/kantoren/${A}`)).json();
  assert.deepEqual(k.leden.map((l: { email: string }) => l.email), ['a@studio.test']);
});

// ── Rechtstreeks in de database: de scheiding hangt niet af van de API ──────
test('RLS: onder studio_app ziet een makelaar alleen het eigen kantoor, ook met een vrije query', async () => {
  const r = await alsGebruiker(makelaarA, (cl) => cl.query('SELECT naam FROM kantoor ORDER BY naam'));
  assert.deepEqual(r.rows.map((x) => x.naam), ['Kantoor A']);
  const via = await alsGebruiker(makelaarA, (cl) => cl.query('SELECT naam FROM kantoor WHERE id = $1', [B]));
  assert.equal(via.rowCount, 0);
});

test('RLS: zonder ingelogde gebruiker ziet studio_app niets', async () => {
  const cl = await pool.connect();
  try {
    await cl.query('BEGIN'); await cl.query('SET LOCAL ROLE studio_app');
    assert.equal((await cl.query('SELECT * FROM kantoor')).rowCount, 0);
    assert.equal((await cl.query('SELECT * FROM gebruiker')).rowCount, 0);
    await cl.query('ROLLBACK');
  } finally { cl.release(); }
});

test('RLS: een makelaar kan in de database niet schrijven (insert, update, delete)', async () => {
  await assert.rejects(alsGebruiker(makelaarA, (cl) => cl.query("INSERT INTO kantoor (naam, slug) VALUES ('X', 'x')")), /row-level security/);
  const upd = await alsGebruiker(makelaarA, (cl) => cl.query("UPDATE kantoor SET naam = 'X' WHERE id = $1", [A]));
  assert.equal(upd.rowCount, 0);
  const del = await alsGebruiker(makelaarA, (cl) => cl.query('DELETE FROM kantoor WHERE id = $1', [A]));
  assert.equal(del.rowCount, 0);
  await assert.rejects(alsGebruiker(makelaarA, (cl) => cl.query("INSERT INTO lidmaatschap (gebruiker_id, kantoor_id, rol) VALUES ($1, $2, 'makelaar')", [makelaarA, B])), /row-level security/,
    'zichzelf toegang geven tot een ander kantoor kan niet');
});

test('RLS: gebruikers zien elkaars gegevens niet, sessies zijn onbereikbaar', async () => {
  const r = await alsGebruiker(makelaarA, (cl) => cl.query('SELECT email FROM gebruiker'));
  assert.deepEqual(r.rows.map((x) => x.email), ['a@studio.test']);
  await assert.rejects(alsGebruiker(makelaarA, (cl) => cl.query('SELECT * FROM sessie')), /permission denied/);
});

test('RLS: alleen platformbeheer leest de audit', async () => {
  await pool.query(`INSERT INTO auditregel (gebruiker_id, actie, tabel) VALUES ($1, 'test', 'kantoor')`, [beheer]);
  assert.equal((await alsGebruiker(zonderKantoor, (cl) => cl.query('SELECT * FROM auditregel'))).rowCount, 0);
  assert.equal((await alsGebruiker(makelaarA, (cl) => cl.query('SELECT * FROM auditregel'))).rowCount, 0);
  assert.ok((await alsGebruiker(beheer, (cl) => cl.query('SELECT * FROM auditregel'))).rowCount! >= 1);
});

test('RLS: platformbeheer ziet alles via dezelfde rol', async () => {
  const r = await alsGebruiker(beheer, (cl) => cl.query('SELECT naam FROM kantoor ORDER BY naam'));
  assert.deepEqual(r.rows.map((x) => x.naam), ['Kantoor A', 'Kantoor B']);
});
