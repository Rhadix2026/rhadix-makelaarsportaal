// Stap 2: authenticatie (wachtwoord, sessie, uitloggen, blokkade, afscherming van routes).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { bouwApp } from '../api/src/server.ts';
import { migreer, pool } from '../api/src/db.ts';
import { controleerWachtwoord, hashWachtwoord, wisPogingen, COOKIE } from '../api/src/auth.ts';
import { login, maakGebruiker, maakKantoorDirect, WACHTWOORD } from './hulp.ts';

const app = bouwApp();
let kantoor = '';
before(async () => {
  await migreer();
  kantoor = await maakKantoorDirect('Kantoor Een', 'kantoor-een');
  await maakGebruiker('beheer@studio.test', { platform: true });
  await maakGebruiker('makelaar@studio.test', { kantoren: [[kantoor, 'makelaar']] });
  await maakGebruiker('uit@studio.test', { actief: false });
});
beforeEach(() => wisPogingen());
after(() => app.close());

const inloggen = (email: string, wachtwoord: string) => app.inject({ method: 'POST', url: '/api/inloggen', payload: { email, wachtwoord } });

test('wachtwoordhash: scrypt met zout, juist en onjuist wachtwoord', async () => {
  const a = await hashWachtwoord('geheim-wachtwoord'), b = await hashWachtwoord('geheim-wachtwoord');
  assert.match(a, /^scrypt\$32768\$8\$1\$/);
  assert.notEqual(a, b, 'elk wachtwoord krijgt een eigen zout');
  assert.equal(await controleerWachtwoord('geheim-wachtwoord', a), true);
  assert.equal(await controleerWachtwoord('ander-wachtwoord', a), false);
});

test('inloggen met juist wachtwoord geeft een HttpOnly-sessiecookie en de gebruiker', async () => {
  const r = await inloggen('Beheer@Studio.test', WACHTWOORD);
  assert.equal(r.statusCode, 200);
  const c = r.headers['set-cookie'] as string;
  assert.match(c, new RegExp(`^${COOKIE}=`));
  assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/);
  assert.equal(r.json().platformbeheer, true);
  const sessies = await pool.query('SELECT token_hash FROM sessie');
  const token = decodeURIComponent(c.split(';')[0].split('=')[1]);
  assert.ok(sessies.rows.every((s) => s.token_hash !== token), 'het token zelf staat niet in de database');
});

test('onjuist wachtwoord en onbekend adres geven dezelfde algemene melding', async () => {
  const a = await inloggen('beheer@studio.test', 'fout-wachtwoord');
  const b = await inloggen('bestaat-niet@studio.test', 'fout-wachtwoord');
  assert.equal(a.statusCode, 401); assert.equal(b.statusCode, 401);
  assert.equal(a.json().fout, b.json().fout);
  assert.equal(a.headers['set-cookie'], undefined);
});

test('een gedeactiveerde gebruiker kan niet inloggen', async () => {
  assert.equal((await inloggen('uit@studio.test', WACHTWOORD)).statusCode, 401);
});

test('na 5 mislukte pogingen wordt het adres tijdelijk geblokkeerd, ook voor het juiste wachtwoord', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await inloggen('makelaar@studio.test', 'fout')).statusCode, 401);
  assert.equal((await inloggen('makelaar@studio.test', WACHTWOORD)).statusCode, 429);
});

test('zonder sessie geven alle routes 401', async () => {
  for (const [method, url] of [['GET', '/api/ik'], ['GET', '/api/kantoren'], ['GET', `/api/kantoren/${kantoor}`], ['POST', '/api/kantoren'],
    ['PUT', `/api/kantoren/${kantoor}`], ['GET', '/api/status'], ['GET', '/api/catalogus/profielen']] as const) {
    const r = await app.inject({ method, url, payload: method === 'GET' ? undefined : {} });
    assert.equal(r.statusCode, 401, `${method} ${url}`);
  }
  assert.equal((await app.inject({ method: 'GET', url: '/api/ik', headers: { cookie: `${COOKIE}=verzonnen-token` } })).statusCode, 401);
});

test('uitloggen beëindigt de sessie', async () => {
  const cookie = await login(app, 'makelaar@studio.test');
  assert.equal((await app.inject({ method: 'GET', url: '/api/ik', headers: { cookie } })).statusCode, 200);
  await app.inject({ method: 'POST', url: '/api/uitloggen', headers: { cookie } });
  assert.equal((await app.inject({ method: 'GET', url: '/api/ik', headers: { cookie } })).statusCode, 401);
});

test('een verlopen sessie werkt niet meer', async () => {
  const cookie = await login(app, 'makelaar@studio.test');
  await pool.query("UPDATE sessie SET verloopt_op = now() - interval '1 minute'");
  assert.equal((await app.inject({ method: 'GET', url: '/api/ik', headers: { cookie } })).statusCode, 401);
});

test('een gebruiker die wordt gedeactiveerd verliest direct toegang', async () => {
  const id = await maakGebruiker('tijdelijk@studio.test');
  const cookie = await login(app, 'tijdelijk@studio.test');
  await pool.query('UPDATE gebruiker SET actief = false WHERE id = $1', [id]);
  assert.equal((await app.inject({ method: 'GET', url: '/api/ik', headers: { cookie } })).statusCode, 401);
});

test('wijzigende verzoeken van een vreemde herkomst worden geweigerd', async () => {
  const cookie = await login(app, 'beheer@studio.test');
  const r = await app.inject({ method: 'POST', url: '/api/kantoren', headers: { cookie, origin: 'https://kwaadaardig.example' }, payload: { naam: 'X' } });
  assert.equal(r.statusCode, 403);
});

test('voorbereid op SSO: een gebruiker met externe identiteit en zonder wachtwoord kan niet met een wachtwoord inloggen', async () => {
  await pool.query(`INSERT INTO gebruiker (email, naam, extern_bron, extern_id) VALUES ('sso@studio.test', 'sso', 'oidc-test', 'sub-123')`);
  assert.equal((await inloggen('sso@studio.test', 'wat-dan-ook')).statusCode, 401);
  await assert.rejects(pool.query(`INSERT INTO gebruiker (email, naam) VALUES ('niets@studio.test', 'niets')`), /check/i,
    'een gebruiker zonder wachtwoord én zonder externe identiteit kan niet bestaan');
});
