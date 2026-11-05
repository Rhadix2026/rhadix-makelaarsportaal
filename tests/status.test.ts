// Stap 1: de API, de database en de productie-instantie van de generator.
// Vereist een draaiende studio-database (npm run db:start).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { bouwApp } from '../api/src/server.ts';
import { migreer, pool } from '../api/src/db.ts';
import { VERWACHTE_COMMIT } from '../api/src/generator.ts';

const app = bouwApp();
after(() => app.close());

test('migraties zijn idempotent', async () => {
  await migreer();
  assert.deepEqual(await migreer(), [], 'tweede keer migreren past niets meer toe');
  const r = await pool.query("SELECT waarde FROM systeem WHERE sleutel = 'opgezet_op'");
  assert.equal(r.rowCount, 1);
});

test('statusroute geeft studio, database en generator', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/status' });
  assert.equal(r.statusCode, 200);
  const s = r.json();
  assert.equal(s.studio.omgeving, 'lokaal');
  assert.match(s.studio.adres, /^127\.0\.0\.1:/);
  assert.equal(s.database.verbonden, true);
  assert.match(s.database.versie, /^16\./);
  assert.ok(s.database.migraties.includes('001_basis.sql'));
});

test('productie-instantie staat op de vastgezette commit en is ongewijzigd', async () => {
  const s = (await app.inject({ method: 'GET', url: '/api/status' })).json();
  const g = s.generator;
  assert.equal(g.gevonden, true);
  assert.equal(g.commit, VERWACHTE_COMMIT);
  assert.equal(g.commit_verwacht, true);
  assert.equal(g.werkmap_schoon, true);
  assert.equal(g.versie, '0.4.0');
  assert.equal(g.node, '24.22.0');
});

test('generatorgegevens komen uit de bestaande modules, niet uit een kopie', async () => {
  const g = (await app.inject({ method: 'GET', url: '/api/status' })).json().generator;
  assert.equal(g.ontwerpsysteem.standaard, '1.0');
  assert.deepEqual(g.ontwerpsysteem.versies.map((v: { versie: string }) => v.versie), ['0', '1.0']);
  assert.equal(g.ontwerpsysteem.versies.find((v: { versie: string }) => v.versie === '1.0').status, 'vastgesteld');
  assert.deepEqual(g.profielen, ['buitenplaats', 'landgoed', 'stads']);
  for (const o of ['importeer', 'controleer-aanlevering', 'aanleveren', 'classificeer', 'bouw', 'kwaliteit', 'status', 'tijd', 'meting'])
    assert.ok(g.opdrachten.includes(o), `mp ${o} gevonden`);
  assert.equal(g.beeldclassificatie.beschikbaar, true, 'SigLIP lokaal beschikbaar');
  assert.equal(g.chromium.beschikbaar, true, 'Chromium voor bouw en keuring beschikbaar');
});

test('onbekende routes geven 404', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/bestaat-niet' });
  assert.equal(r.statusCode, 404);
});
