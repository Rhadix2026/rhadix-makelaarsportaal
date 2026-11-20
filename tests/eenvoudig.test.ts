// Stap 3A.1: vereenvoudigde aanlevering. Geen nieuwe API: de interface doet dezelfde drie verzoeken als
// het uitgebreide scherm. Deze test doorloopt die volgorde licht (zonder zware import; die dekt
// aanlevering.test.ts) en controleert de organisatiescheiding server-side.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bouwApp } from '../api/src/server.ts';
import { migreer, pool } from '../api/src/db.ts';
import { login, maakGebruiker, maakKantoorDirect } from './hulp.ts';

const app = bouwApp();
let A = '', B = '';
const c: Record<string, string> = {};

before(async () => {
  await migreer();
  A = await maakKantoorDirect('Eenvoudig A', 'eenvoudig-a');
  B = await maakKantoorDirect('Eenvoudig B', 'eenvoudig-b');
  await maakGebruiker('eenvoudig.a@studio.test', { kantoren: [[A, 'makelaar']] });
  await maakGebruiker('eenvoudig.b@studio.test', { kantoren: [[B, 'makelaar']] });
  c.a = await login(app, 'eenvoudig.a@studio.test');
  c.b = await login(app, 'eenvoudig.b@studio.test');
});
after(() => app.close());

const req = (wie: string, method: 'GET' | 'POST', url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: c[wie] }, payload });
const pdf = (wie: string, url: string) => app.inject({ method: 'POST', url, headers: { cookie: c[wie], 'content-type': 'application/pdf', 'x-bestandsnaam': 'brochure.pdf' },
  payload: Buffer.from('%PDF-1.4\n%eenvoudige test\n') });

test('vereenvoudigde volgorde: eigen kantoor + naam + profiel buitenplaats, daarna de brochure', async () => {
  const r = await req('a', 'POST', '/api/projecten', { kantoor_id: A, naam: 'Denekamperstraat 23B, Beuningen', profiel: 'buitenplaats' });
  assert.equal(r.statusCode, 201, r.body);
  const p = r.json();
  assert.equal(p.kantoor_id, A);
  assert.equal(p.profiel, 'buitenplaats');
  assert.equal(p.status, 'aanlevering_incompleet', 'bestaande beginstatus');
  assert.ok(p.ontwerpsysteem, 'huidig ontwerpsysteem automatisch');
  for (const veld of ['adres', 'postcode', 'plaats', 'woningtype', 'domein', 'contactpersoon']) assert.equal(p[veld] ?? null, null, `${veld} leeg: de import vult aan`);
  const u = await pdf('a', `/api/projecten/${p.id}/bestanden?soort=brochure`);
  assert.equal(u.statusCode, 201, u.body);
  const o = (await req('a', 'GET', `/api/projecten/${p.id}/aanlevering`)).json();
  assert.equal(o.bestanden.filter((b: { soort: string }) => b.soort === 'brochure').length, 1, 'brochure in hetzelfde project');
});

test('organisatiescheiding server-side: een makelaar van B kan niets bij kantoor A', async () => {
  assert.equal((await req('b', 'POST', '/api/projecten', { kantoor_id: A, naam: 'Inbreker', profiel: 'buitenplaats' })).statusCode, 400, 'geen project in een ander kantoor');
  const pa = (await req('a', 'POST', '/api/projecten', { kantoor_id: A, naam: 'Woning A2', profiel: 'buitenplaats' })).json();
  assert.equal((await pdf('b', `/api/projecten/${pa.id}/bestanden?soort=brochure`)).statusCode, 404, 'geen upload in een ander kantoor');
  assert.equal((await req('b', 'POST', `/api/projecten/${pa.id}/verwerkingen`, { soort: 'brochure-import' })).statusCode, 404, 'geen import in een ander kantoor');
  assert.equal((await req('b', 'GET', `/api/projecten/${pa.id}/aanlevering`)).statusCode, 404, 'geen inzage');
  const lijst = (await req('b', 'GET', '/api/projecten')).json();
  assert.ok(!lijst.projecten.some((x: { kantoor_id: string }) => x.kantoor_id === A), 'dashboard toont geen projecten van A');
  const kantoren = (await req('b', 'GET', '/api/kantoren')).json();
  assert.deepEqual(kantoren.map((k: { id: string }) => k.id), [B], 'alleen het eigen kantoor');
  const n = (await pool.query('SELECT count(*)::int AS n FROM project WHERE kantoor_id = $1', [A])).rows[0].n;
  assert.equal(n, 2);
});
