// Stap 3: woningprojecten (aanmaken, standaardwaarden van het kantoor, bewerken, filteren,
// status) en de gegevensscheiding per kantoor.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bouwApp } from '../api/src/server.ts';
import { alsGebruiker, migreer, pool } from '../api/src/db.ts';
import { normaliseerPostcode, valideerProject } from '../api/src/projecten.ts';
import { login, maakGebruiker, maakKantoorDirect } from './hulp.ts';

const app = bouwApp();
let A = '', B = '', makelaarA = '';
const c: Record<string, string> = {};
const PROFIELEN = ['buitenplaats', 'landgoed', 'stads'];

before(async () => {
  await migreer();
  A = await maakKantoorDirect('Kantoor A', 'kantoor-a');
  B = await maakKantoorDirect('Kantoor B', 'kantoor-b');
  await pool.query("UPDATE kantoor SET standaard_profiel = 'landgoed' WHERE id = $1", [A]);
  await maakGebruiker('beheer@studio.test', { platform: true });
  makelaarA = await maakGebruiker('a@studio.test', { kantoren: [[A, 'makelaar']] });
  for (const e of ['beheer', 'a']) c[e] = await login(app, `${e}@studio.test`);
});
after(() => app.close());

const req = (wie: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: c[wie] }, payload });
const maak = async (data: object) => {
  const r = await req('beheer', 'POST', '/api/projecten', data);
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

test('postcode wordt genormaliseerd naar 1234 AB', () => {
  assert.equal(normaliseerPostcode('1234ab'), '1234 AB');
  assert.equal(normaliseerPostcode(' 1234  AB '), '1234 AB');
  assert.equal(normaliseerPostcode('0123 AB'), null);
});

test('invoercontrole: kantoor, naam, postcode, woningtype, profiel, domein en gereserveerde namen', () => {
  const v = valideerProject({ naam: '', postcode: 'abc', woningtype: 'kasteel', profiel: 'onbekend', domein: 'geen domein', slug: 'markt-27-wolvega' }, PROFIELEN);
  assert.equal(v.ok, false);
  if (!v.ok) assert.deepEqual(Object.keys(v.fouten).sort(), ['domein', 'kantoor_id', 'naam', 'postcode', 'profiel', 'slug', 'woningtype']);
  for (const s of ['beusemkolkweg-16', 'landgoed-rhoderlanden', 'kalibratie-x', 'import-x']) {
    const r = valideerProject({ kantoor_id: A || '00000000-0000-0000-0000-000000000000', naam: 'X', slug: s }, PROFIELEN);
    assert.equal(r.ok, false, `${s} is gereserveerd`);
  }
  const goed = valideerProject({ kantoor_id: '00000000-0000-0000-0000-000000000001', naam: 'Voorbeeldweg 1', domein: 'https://www.Voorbeeldweg1.nl/' }, PROFIELEN);
  assert.equal(goed.ok, true);
  if (goed.ok) assert.equal(goed.project.domein, 'www.voorbeeldweg1.nl');
});

test('nieuw project: gekoppeld aan het kantoor, slug uit kantoor + naam, ontwerpsysteem uit de generator, status aanlevering incompleet', async () => {
  const p = await maak({ kantoor_id: A, naam: 'Voorbeeldweg 1', adres: 'Voorbeeldweg 1', postcode: '1234ab', plaats: 'Voorbeeldstad', woningtype: 'vrijstaand' });
  assert.equal(p.kantoor_id, A);
  assert.equal(p.kantoor, 'Kantoor A');
  assert.equal(p.slug, 'kantoor-a-voorbeeldweg-1');
  assert.equal(p.postcode, '1234 AB');
  assert.equal(p.ontwerpsysteem, '1.0');
  assert.equal(p.status, 'aanlevering_incompleet');
  const a = await pool.query("SELECT actie FROM auditregel WHERE tabel = 'project' AND rij_id = $1", [p.id]);
  assert.deepEqual(a.rows.map((r) => r.actie), ['aanmaken']);
});

test('kantoorinstellingen zijn standaardwaarden: overgenomen bij aanmaken, nooit teruggeschreven', async () => {
  const p = await maak({ kantoor_id: A, naam: 'Profielwoning' });
  assert.equal(p.profiel, 'landgoed', 'standaardprofiel van het kantoor overgenomen');
  const w = await req('beheer', 'PUT', `/api/projecten/${p.id}`, { ...p, profiel: 'stads' });
  assert.equal(w.json().profiel, 'stads');
  const k = (await pool.query('SELECT standaard_profiel FROM kantoor WHERE id = $1', [A])).rows[0];
  assert.equal(k.standaard_profiel, 'landgoed', 'het kantoor is niet gewijzigd door de woning');
  await pool.query("UPDATE kantoor SET standaard_profiel = 'buitenplaats' WHERE id = $1", [A]);
  const opnieuw = (await req('beheer', 'GET', `/api/projecten/${p.id}`)).json();
  assert.equal(opnieuw.profiel, 'stads', 'een latere kantoorwijziging verandert bestaande projecten niet');
  await pool.query("UPDATE kantoor SET standaard_profiel = 'landgoed' WHERE id = $1", [A]);
});

test('bewerken: basisgegevens bijgewerkt, slug en ontwerpsysteem blijven vast, audit met oud en nieuw', async () => {
  const p = await maak({ kantoor_id: A, naam: 'Bewerkwoning' });
  const r = await req('beheer', 'PUT', `/api/projecten/${p.id}`, { ...p, naam: 'Bewerkwoning 2', slug: 'andere-slug', plaats: 'Nieuwplaats', domein: 'bewerkwoning.nl' });
  assert.equal(r.statusCode, 200);
  const n = r.json();
  assert.equal(n.naam, 'Bewerkwoning 2'); assert.equal(n.plaats, 'Nieuwplaats'); assert.equal(n.domein, 'bewerkwoning.nl');
  assert.equal(n.slug, p.slug, 'slug ligt vast');
  assert.equal(n.ontwerpsysteem, '1.0');
  const a = (await pool.query("SELECT oud, nieuw FROM auditregel WHERE actie = 'wijzigen' AND rij_id = $1", [p.id])).rows[0];
  assert.equal(a.oud.naam, 'Bewerkwoning'); assert.equal(a.nieuw.naam, 'Bewerkwoning 2');
});

test('kantoor wijzigen kan alleen zolang de aanlevering niet begonnen is', async () => {
  const p = await maak({ kantoor_id: A, naam: 'Verhuiswoning' });
  const r = await req('beheer', 'PUT', `/api/projecten/${p.id}`, { ...p, kantoor_id: B });
  assert.equal(r.statusCode, 200); assert.equal(r.json().kantoor_id, B);
  await pool.query("UPDATE project SET status = 'klaar_voor_productie' WHERE id = $1", [p.id]);
  const vast = await req('beheer', 'PUT', `/api/projecten/${p.id}`, { ...p, kantoor_id: A });
  assert.equal(vast.statusCode, 409);
});

test('geen project bij een inactief kantoor', async () => {
  const C = await maakKantoorDirect('Kantoor C', 'kantoor-c');
  await pool.query("UPDATE kantoor SET status = 'inactief' WHERE id = $1", [C]);
  const r = await req('beheer', 'POST', '/api/projecten', { kantoor_id: C, naam: 'X' });
  assert.equal(r.statusCode, 400); assert.ok(r.json().fouten.kantoor_id);
});

test('dubbele korte naam geeft 409; een gereserveerde naam wordt ook in de database geweigerd', async () => {
  await maak({ kantoor_id: A, naam: 'Dubbel', slug: 'dubbel-1' });
  assert.equal((await req('beheer', 'POST', '/api/projecten', { kantoor_id: A, naam: 'Dubbel', slug: 'dubbel-1' })).statusCode, 409);
  await assert.rejects(pool.query(`INSERT INTO project (kantoor_id, slug, naam, ontwerpsysteem) VALUES ($1, 'markt-27-wolvega', 'X', '1.0')`, [A]), /check/i);
  await assert.rejects(pool.query(`INSERT INTO project (kantoor_id, slug, naam, ontwerpsysteem) VALUES ($1, 'kalibratie-x', 'X', '1.0')`, [A]), /check/i);
});

test('overzicht filteren op kantoor, status en zoekterm; telling per status', async () => {
  await maak({ kantoor_id: B, naam: 'Woning bij B', plaats: 'Bestad' });
  const alle = (await req('beheer', 'GET', '/api/projecten')).json();
  assert.ok(alle.projecten.length >= 6);
  const opB = (await req('beheer', 'GET', `/api/projecten?kantoor=${B}`)).json().projecten;
  assert.ok(opB.length >= 1 && opB.every((p: { kantoor_id: string }) => p.kantoor_id === B));
  const klaar = (await req('beheer', 'GET', '/api/projecten?status=klaar_voor_productie')).json().projecten;
  assert.ok(klaar.length === 1 && klaar[0].status === 'klaar_voor_productie');
  const zoek = (await req('beheer', 'GET', '/api/projecten?zoek=bestad')).json().projecten;
  assert.deepEqual(zoek.map((p: { naam: string }) => p.naam), ['Woning bij B']);
  assert.equal((await req('beheer', 'GET', '/api/projecten?zoek=%25')).json().projecten.length, 0, 'jokertekens worden letterlijk gezocht');
  const t = (await req('beheer', 'GET', '/api/projecten')).json().telling;
  assert.equal(t.klaar_voor_productie, 1);
});

// ── Gegevensscheiding ──────────────────────────────────────────────────────
test('een makelaar ziet alleen projecten van het eigen kantoor, ook in de telling', async () => {
  const lijst = (await req('a', 'GET', '/api/projecten')).json();
  assert.ok(lijst.projecten.length >= 1);
  assert.ok(lijst.projecten.every((p: { kantoor_id: string }) => p.kantoor_id === A));
  const totaalA = (await pool.query('SELECT count(*)::int AS n FROM project WHERE kantoor_id = $1', [A])).rows[0].n;
  assert.equal(Object.values(lijst.telling as Record<string, number>).reduce((x, y) => x + y, 0), totaalA);
  assert.equal((await req('a', 'GET', `/api/projecten?kantoor=${B}`)).json().projecten.length, 0, 'filter op ander kantoor geeft niets');
});

test('een project van een ander kantoor opvragen geeft 404; een makelaar kan niet aanmaken of wijzigen', async () => {
  const vanB = (await pool.query('SELECT id FROM project WHERE kantoor_id = $1 LIMIT 1', [B])).rows[0].id;
  assert.equal((await req('a', 'GET', `/api/projecten/${vanB}`)).statusCode, 404);
  assert.equal((await req('a', 'POST', '/api/projecten', { kantoor_id: A, naam: 'Eigen woning' })).statusCode, 403);
  const vanA = (await pool.query('SELECT * FROM project WHERE kantoor_id = $1 LIMIT 1', [A])).rows[0];
  assert.equal((await req('a', 'PUT', `/api/projecten/${vanA.id}`, { ...vanA, naam: 'Gewijzigd' })).statusCode, 403);
});

test('RLS: ook met een vrije query ziet een makelaar alleen projecten van het eigen kantoor en kan niet schrijven', async () => {
  const r = await alsGebruiker(makelaarA, (cl) => cl.query('SELECT DISTINCT kantoor_id FROM project'));
  assert.deepEqual(r.rows.map((x) => x.kantoor_id), [A]);
  await assert.rejects(alsGebruiker(makelaarA, (cl) => cl.query(`INSERT INTO project (kantoor_id, slug, naam, ontwerpsysteem) VALUES ($1, 'stiekem', 'X', '1.0')`, [A])), /row-level security/);
  assert.equal((await alsGebruiker(makelaarA, (cl) => cl.query("UPDATE project SET naam = 'X'"))).rowCount, 0);
  assert.equal((await alsGebruiker(makelaarA, (cl) => cl.query('DELETE FROM project'))).rowCount, 0);
});

test('zonder sessie geven de projectroutes 401', async () => {
  for (const [method, url] of [['GET', '/api/projecten'], ['GET', '/api/catalogus/project'], ['POST', '/api/projecten']] as const)
    assert.equal((await app.inject({ method, url, payload: method === 'POST' ? {} : undefined })).statusCode, 401);
});

test('catalogus: woningtypen, statussen in procesvolgorde, profielen met omschrijving uit de generator', async () => {
  const k = (await req('beheer', 'GET', '/api/catalogus/project')).json();
  assert.equal(k.statussen[0].waarde, 'aanlevering_incompleet');
  assert.equal(k.statussen.length, 13);
  assert.deepEqual(k.profielen.map((p: { naam: string }) => p.naam), PROFIELEN);
  assert.equal(k.ontwerpsysteem, '1.0');
});
