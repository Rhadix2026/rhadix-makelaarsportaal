// Stap 1: de API, de database en de productie-instantie van de generator (systeembeheer).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bouwApp } from '../api/src/server.ts';
import { migreer, pool } from '../api/src/db.ts';
import { VERWACHTE_COMMIT } from '../api/src/generator.ts';
import { login, maakGebruiker } from './hulp.ts';

const app = bouwApp();
let cookie = '';
before(async () => {
  await migreer();
  await maakGebruiker('beheer@studio.test', { platform: true });
  cookie = await login(app, 'beheer@studio.test');
});
after(() => app.close());

const status = async () => (await app.inject({ method: 'GET', url: '/api/status', headers: { cookie } })).json();

test('migraties zijn idempotent', async () => {
  assert.deepEqual(await migreer(), [], 'tweede keer migreren past niets meer toe');
  const r = await pool.query("SELECT waarde FROM systeem WHERE sleutel = 'opgezet_op'");
  assert.equal(r.rowCount, 1);
});

test('statusroute geeft studio, database en generator', async () => {
  const s = await status();
  assert.equal(s.studio.omgeving, 'lokaal');
  assert.match(s.studio.adres, /^127\.0\.0\.1:/);
  assert.equal(s.database.verbonden, true);
  assert.match(s.database.versie, /^16\./);
  assert.deepEqual(s.database.migraties, ['001_basis.sql', '002_gebruikers_kantoren.sql', '003_woningprojecten.sql', '004_aanlevering.sql', '005_besluiten.sql', '006_beoordeling_vrijgave.sql', '007_concepten.sql', '008_overname_tijd.sql', '009_rhadix_identiteit.sql', '010_rollen_kantoor.sql']);
});

test('productie-instantie staat op de vastgezette commit en is ongewijzigd', async () => {
  const g = (await status()).generator;
  assert.equal(g.gevonden, true);
  assert.equal(g.commit, VERWACHTE_COMMIT);
  assert.equal(g.commit_verwacht, true);
  assert.equal(g.werkmap_schoon, true);
  assert.equal(g.versie, '0.4.0');
  assert.equal(g.node, '24.22.0');
});

test('generatorgegevens komen uit de bestaande modules, niet uit een kopie', async () => {
  const g = (await status()).generator;
  assert.equal(g.ontwerpsysteem.standaard, '1.0');
  assert.deepEqual(g.ontwerpsysteem.versies.map((v: { versie: string }) => v.versie), ['0', '1.0']);
  assert.equal(g.ontwerpsysteem.versies.find((v: { versie: string }) => v.versie === '1.0').status, 'vastgesteld');
  assert.deepEqual(g.profielen, ['buitenplaats', 'landgoed', 'stads']);
  for (const o of ['importeer', 'controleer-aanlevering', 'aanleveren', 'classificeer', 'bouw', 'kwaliteit', 'status', 'tijd', 'meting'])
    assert.ok(g.opdrachten.includes(o), `mp ${o} gevonden`);
  assert.equal(g.beeldclassificatie.beschikbaar, true, 'SigLIP lokaal beschikbaar');
  assert.equal(g.chromium.beschikbaar, true, 'Chromium voor bouw en keuring beschikbaar');
});

test('onbekende routes geven 404 (na inloggen)', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/bestaat-niet', headers: { cookie } });
  assert.equal(r.statusCode, 404);
});

test('gezondheidscontrole zonder sessie, zonder details; rol en omgeving in de status', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/gezond' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { ok: true });
  const s = await status();
  assert.equal(s.studio.omgeving, 'lokaal'); assert.equal(s.studio.rol, 'alles');
  // Andere routes blijven achter de login; een vreemde herkomst mag niets wijzigen.
  assert.equal((await app.inject({ method: 'GET', url: '/api/projecten' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/uitloggen', headers: { cookie, origin: 'https://elders.invalid' } })).statusCode, 403);
});
