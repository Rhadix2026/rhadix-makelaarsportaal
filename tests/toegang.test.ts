// Gebruikers en rollen (optie A): alleen-lezen overzicht. Platformbeheer ziet alle kantoren en de
// verwijzing naar het centrale Rhadix-beheer; een kantoorbeheerder alleen de leden van het eigen kantoor;
// een makelaar niets. Er bestaat geen schrijfroute en de database-functie lekt niets buiten de rol.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bouwApp } from '../api/src/server.ts';
import { alsGebruiker, migreer, pool } from '../api/src/db.ts';
import { login, maakGebruiker, maakKantoorDirect } from './hulp.ts';

const app = bouwApp();
let A = '', B = '';
const id: Record<string, string> = {};
const c: Record<string, string> = {};

before(async () => {
  await migreer();
  A = await maakKantoorDirect('Kantoor A', 'kantoor-a');
  B = await maakKantoorDirect('Kantoor B', 'kantoor-b');
  id.beheer = await maakGebruiker('beheer@studio.test', { platform: true });
  id.kba = await maakGebruiker('kba@studio.test', { kantoren: [[A, 'kantoorbeheerder']] });
  id.mka = await maakGebruiker('mka@studio.test', { kantoren: [[A, 'makelaar']] });
  id.kbb = await maakGebruiker('kbb@studio.test', { kantoren: [[B, 'kantoorbeheerder']] });
  // Beheerder van A en makelaar bij B: ziet alleen A.
  id.gemengd = await maakGebruiker('gemengd@studio.test', { kantoren: [[A, 'kantoorbeheerder'], [B, 'makelaar']] });
  for (const e of ['beheer', 'kba', 'mka', 'kbb', 'gemengd']) c[e] = await login(app, `${e}@studio.test`);
});
after(() => app.close());

const toegang = (wie: string) => app.inject({ method: 'GET', url: '/api/toegang', headers: { cookie: c[wie] } });
const emails = (k: { leden: { email: string }[] }) => k.leden.map((l) => l.email).sort();

test('platformbeheer: alle kantoren met leden en rol, de platformbeheerders en de verwijzing naar het centrale beheer', async () => {
  const r = await toegang('beheer');
  assert.equal(r.statusCode, 200);
  const d = r.json();
  assert.equal(d.rol, 'platformbeheer');
  assert.equal(d.centraal_beheer, 'https://platform.rhadix.invalid/', 'alleen het ingestelde platformadres');
  assert.deepEqual(d.kantoren.map((k: { merknaam: string }) => k.merknaam), ['Kantoor A', 'Kantoor B']);
  const a = d.kantoren[0];
  assert.deepEqual(emails(a), ['gemengd@studio.test', 'kba@studio.test', 'mka@studio.test']);
  assert.equal(a.leden.find((l: { email: string }) => l.email === 'mka@studio.test').rol, 'makelaar');
  assert.equal(a.leden.find((l: { email: string }) => l.email === 'kba@studio.test').rol, 'kantoorbeheerder');
  assert.ok('rhadix_organisatie' in a, 'koppeling zichtbaar voor platformbeheer');
  assert.deepEqual(d.platformbeheerders.map((l: { email: string }) => l.email), ['beheer@studio.test']);
  assert.equal(a.leden[0].bron, 'lokaal');
  assert.ok(!('wachtwoord_hash' in a.leden[0]) && !('extern_id' in a.leden[0]), 'alleen de velden van het overzicht');
});

test('kantoorbeheerder: uitsluitend het eigen kantoor, zonder centrale verwijzing, koppeling of platformbeheerders', async () => {
  const d = (await toegang('kba')).json();
  assert.equal(d.rol, 'kantoorbeheerder');
  assert.equal(d.centraal_beheer, null);
  assert.deepEqual(d.kantoren.map((k: { merknaam: string }) => k.merknaam), ['Kantoor A']);
  assert.deepEqual(emails(d.kantoren[0]), ['gemengd@studio.test', 'kba@studio.test', 'mka@studio.test'], 'alle leden van het eigen kantoor');
  assert.ok(!('rhadix_organisatie' in d.kantoren[0]) && !('platformbeheerders' in d));
  const b = (await toegang('kbb')).json();
  assert.deepEqual(b.kantoren.map((k: { merknaam: string }) => k.merknaam), ['Kantoor B']);
  assert.deepEqual(emails(b.kantoren[0]), ['gemengd@studio.test', 'kbb@studio.test'], 'B ziet A niet');
  const g = (await toegang('gemengd')).json();
  assert.deepEqual(g.kantoren.map((k: { merknaam: string }) => k.merknaam), ['Kantoor A'], 'makelaar bij B: B niet zichtbaar');
});

test('makelaar: geen toegang tot gebruikers en rollen; zonder aanmelding 401', async () => {
  assert.equal((await toegang('mka')).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/api/toegang' })).statusCode, 401);
});

test('geen schrijfroute: alleen lezen', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const)
    assert.equal((await app.inject({ method, url: '/api/toegang', headers: { cookie: c.beheer }, payload: {} })).statusCode, 404, method);
});

test('database: de functie geeft buiten de rol niets prijs; de rijregels op gebruiker en lidmaatschap zijn ongewijzigd', async () => {
  const leden = (wie: string, k: string) => alsGebruiker(id[wie], async (x) => (await x.query('SELECT email FROM app.leden_van_kantoor($1)', [k])).rowCount);
  assert.equal(await leden('mka', A), 0, 'makelaar: niets');
  assert.equal(await leden('kba', B), 0, 'kantoorbeheerder van een ander kantoor: niets');
  assert.equal(await leden('kba', A), 3);
  assert.equal(await leden('beheer', B), 2);
  // Bestaande regels: een makelaar ziet rechtstreeks alleen zichzelf.
  const direct = await alsGebruiker(id.mka, async (x) => ({
    g: (await x.query('SELECT email FROM gebruiker')).rows.map((r) => r.email),
    l: (await x.query('SELECT gebruiker_id FROM lidmaatschap')).rowCount,
  }));
  assert.deepEqual(direct, { g: ['mka@studio.test'], l: 1 });
  // Ook via het bestaande kantoorscherm geen collega's voor de makelaar.
  const k = (await app.inject({ method: 'GET', url: `/api/kantoren/${A}`, headers: { cookie: c.mka } })).json();
  assert.deepEqual(k.leden.map((l: { email: string }) => l.email), ['mka@studio.test']);
  // Schrijven blijft onmogelijk voor de kantoorbeheerder (bestaande regel lidmaatschap_beheer).
  await assert.rejects(alsGebruiker(id.kba, (x) => x.query("UPDATE lidmaatschap SET rol = 'kantoorbeheerder' WHERE gebruiker_id = $1", [id.mka]))
    .then((r) => { if (!r.rowCount) throw new Error('geen rij gewijzigd'); }));
  assert.equal((await pool.query('SELECT rol FROM lidmaatschap WHERE gebruiker_id = $1', [id.mka])).rows[0].rol, 'makelaar');
});
