// Stap 2: basisfunctionaliteit van het kantorenbeheer (aanmaken, wijzigen, controle, audit).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bouwApp } from '../api/src/server.ts';
import { migreer, pool } from '../api/src/db.ts';
import { maakSlug, valideerKantoor } from '../api/src/kantoren.ts';
import { login, maakGebruiker } from './hulp.ts';

const app = bouwApp();
let cookie = '';
before(async () => {
  await migreer();
  await maakGebruiker('beheer@studio.test', { platform: true });
  cookie = await login(app, 'beheer@studio.test');
});
after(() => app.close());

const verstuur = (method: 'POST' | 'PUT', url: string, payload: object) => app.inject({ method, url, headers: { cookie }, payload });
const PROFIELEN = ['buitenplaats', 'landgoed', 'stads'];

test('slug uit de naam: kleine letters, zonder accenten, & wordt "en"', () => {
  assert.equal(maakSlug('Morskieft Makelaardij & Taxaties'), 'morskieft-makelaardij-en-taxaties');
  assert.equal(maakSlug('  Café  Één  '), 'cafe-een');
});

test('invoercontrole: verplichte naam, geldige e-mail, website, telefoon, kleur en profiel', () => {
  const v = valideerKantoor({ merknaam: '', email: 'geen-adres', website: 'kantoor.nl', telefoon: 'bel me', merkkleur: 'blauw', standaard_profiel: 'onbekend' }, PROFIELEN);
  assert.equal(v.ok, false);
  if (!v.ok) assert.deepEqual(Object.keys(v.fouten).sort(), ['email', 'merkkleur', 'merknaam', 'slug', 'standaard_profiel', 'telefoon', 'website']);
  const goed = valideerKantoor({ merknaam: ' Voorbeeld Makelaardij ', juridische_naam: ' Voorbeeld Makelaardij B.V. ', email: 'info@voorbeeld.nl', website: 'https://www.voorbeeld.nl',
    telefoon: '+31 (0)12 345 67 89', merkkleur: '#1a2847', standaard_profiel: 'landgoed', adresregels: ['Straat 1', ' ', '1234 AB Plaats'] }, PROFIELEN);
  assert.equal(goed.ok, true);
  if (goed.ok) {
    assert.equal(goed.kantoor.merknaam, 'Voorbeeld Makelaardij');
    assert.equal(goed.kantoor.juridische_naam, 'Voorbeeld Makelaardij B.V.');
    assert.equal(goed.kantoor.slug, 'voorbeeld-makelaardij');
    assert.equal(goed.kantoor.merkkleur, '#1A2847');
    assert.deepEqual(goed.kantoor.adresregels, ['Straat 1', '1234 AB Plaats']);
  }
});

test('platformbeheer maakt een kantoor aan; dat staat in de lijst en in de audit', async () => {
  const r = await verstuur('POST', '/api/kantoren', { merknaam: 'Voorbeeld Makelaardij', juridische_naam: 'Voorbeeld Makelaardij B.V.', email: 'info@voorbeeld.invalid', standaard_profiel: 'buitenplaats' });
  assert.equal(r.statusCode, 201);
  const k = r.json();
  assert.equal(k.slug, 'voorbeeld-makelaardij');
  assert.equal(k.status, 'actief');
  const lijst = (await app.inject({ method: 'GET', url: '/api/kantoren', headers: { cookie } })).json();
  assert.deepEqual(lijst.map((x: { merknaam: string; gebruikers: number }) => [x.merknaam, x.gebruikers]), [['Voorbeeld Makelaardij', 0]]);
  const a = await pool.query("SELECT actie, nieuw FROM auditregel WHERE tabel = 'kantoor' AND rij_id = $1", [k.id]);
  assert.equal(a.rows[0].actie, 'aanmaken');
  assert.equal(a.rows[0].nieuw.merknaam, 'Voorbeeld Makelaardij');
  assert.equal(a.rows[0].nieuw.juridische_naam, 'Voorbeeld Makelaardij B.V.');
});

test('ongeldige invoer geeft 400 met de fouten per veld; niets opgeslagen', async () => {
  const voor = (await pool.query('SELECT count(*)::int AS n FROM kantoor')).rows[0].n;
  const r = await verstuur('POST', '/api/kantoren', { merknaam: 'Fout', email: 'geen-adres', standaard_profiel: 'onbekend' });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(Object.keys(r.json().fouten).sort(), ['email', 'standaard_profiel']);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM kantoor')).rows[0].n, voor);
});

test('een korte naam (slug) die al bestaat geeft 409', async () => {
  const r = await verstuur('POST', '/api/kantoren', { merknaam: 'Voorbeeld Makelaardij' });
  assert.equal(r.statusCode, 409);
  assert.ok(r.json().fouten.slug);
});

test('wijzigen: gegevens bijgewerkt, oude en nieuwe waarde in de audit', async () => {
  const k = (await app.inject({ method: 'GET', url: '/api/kantoren', headers: { cookie } })).json()[0];
  const r = await verstuur('PUT', `/api/kantoren/${k.id}`, { ...k, telefoon: '012 345 67 89', merkkleur: '#04158a', status: 'inactief' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().telefoon, '012 345 67 89');
  assert.equal(r.json().merkkleur, '#04158A');
  assert.equal(r.json().status, 'inactief');
  const a = (await pool.query("SELECT oud, nieuw FROM auditregel WHERE actie = 'wijzigen' AND rij_id = $1", [k.id])).rows[0];
  assert.equal(a.oud.telefoon, null);
  assert.equal(a.nieuw.telefoon, '012 345 67 89');
});

test('een onbekend of ongeldig kantoor-id geeft 404', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/kantoren/00000000-0000-0000-0000-000000000000', headers: { cookie } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/api/kantoren/geen-uuid', headers: { cookie } })).statusCode, 404);
  assert.equal((await verstuur('PUT', '/api/kantoren/00000000-0000-0000-0000-000000000000', { merknaam: 'X' })).statusCode, 404);
});

test('de profielkeuze komt uit de generator', async () => {
  const r = (await app.inject({ method: 'GET', url: '/api/catalogus/profielen', headers: { cookie } })).json();
  assert.deepEqual(r.profielen, PROFIELEN);
  assert.ok(r.details.every((d: { omschrijving: string }) => d.omschrijving.length > 10), 'elk profiel heeft een omschrijving');
});
