// Rollen binnen het kantoor (migratie 010): platformbeheer, kantoorbeheerder en makelaar, en de
// scheiding tussen kantoren. Getoetst via de API én rechtstreeks in de database (RLS en bewaking).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { bouwApp } from '../api/src/server.ts';
import { alsGebruiker, migreer, pool } from '../api/src/db.ts';
import { login, maakGebruiker, maakKantoorDirect } from './hulp.ts';

const app = bouwApp();
const c: Record<string, string> = {};
const id: Record<string, string> = {};
let A = '', B = '', PA = '', PB = '', CA = '';

before(async () => {
  await migreer();
  A = await maakKantoorDirect('Kantoor A', 'rol-a');
  B = await maakKantoorDirect('Kantoor B', 'rol-b');
  id.beheer = await maakGebruiker('beheer@rol.test', { platform: true });
  id.kb = await maakGebruiker('kb@rol.test', { kantoren: [[A, 'kantoorbeheerder']] });
  id.mk = await maakGebruiker('mk@rol.test', { kantoren: [[A, 'makelaar']] });
  id.mkB = await maakGebruiker('mkb@rol.test', { kantoren: [[B, 'makelaar']] });
  for (const [k, e] of [['beheer', 'beheer'], ['kb', 'kb'], ['mk', 'mk'], ['mkB', 'mkb']]) c[k] = await login(app, `${e}@rol.test`);
  const p = (k: string, s: string) => pool.query(`INSERT INTO project (kantoor_id, slug, naam, ontwerpsysteem) VALUES ($1, $2, $3, '1.0') RETURNING id`, [k, s, s]);
  PA = (await p(A, 'rol-a-woning')).rows[0].id;
  PB = (await p(B, 'rol-b-woning')).rows[0].id;
  // Een conceptversie (zoals de verwerker die vastlegt), om de beoordeling te toetsen.
  CA = (await pool.query(`INSERT INTO concept (project_id, kantoor_id, versie, map, invoer_vingerafdruk, build_vingerafdruk, ontwerpsysteem, profiel,
    generator_commit, bouw, metingen, voorbeeld_token, aangemaakt_door) VALUES ($1, $2, 1, 'x', 'x', 'x', '1.0', 'eenvoudig', 'x', '{}', '{}', $3, $4) RETURNING id`,
    [PA, A, randomBytes(24).toString('hex'), id.beheer])).rows[0].id;
});
after(() => app.close());

const req = (wie: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: c[wie], origin: 'http://127.0.0.1:5480' }, payload });

test('makelaar: woningproject aanmaken en wijzigen in het eigen kantoor, niet in een ander', async () => {
  const r = await req('mk', 'POST', '/api/projecten', { kantoor_id: A, naam: 'Makelaarwoning' });
  assert.equal(r.statusCode, 201, r.body);
  assert.equal((await req('mk', 'PUT', `/api/projecten/${r.json().id}`, { ...r.json(), plaats: 'Wolvega' })).statusCode, 200);
  assert.equal((await req('mk', 'POST', '/api/projecten', { kantoor_id: B, naam: 'Elders' })).statusCode, 400);
  assert.equal((await req('mkB', 'GET', `/api/projecten/${PA}`)).statusCode, 404);
});

test('makelaar: aanleveren, verwerken en beslissingen voor een eerste concept; ander kantoor niet', async () => {
  const pdf = Buffer.from('%PDF-1.4\n%test\n');
  const up = await app.inject({ method: 'POST', url: `/api/projecten/${PA}/bestanden?soort=brochure`, headers: { cookie: c.mk, origin: 'http://127.0.0.1:5480', 'content-type': 'application/pdf', 'x-bestandsnaam': 'brochure.pdf' }, payload: pdf });
  assert.notEqual(up.statusCode, 403, 'geen rechtenweigering voor de eigen woning');
  const anders = await app.inject({ method: 'POST', url: `/api/projecten/${PB}/bestanden?soort=brochure`, headers: { cookie: c.mk, origin: 'http://127.0.0.1:5480', 'content-type': 'application/pdf' }, payload: pdf });
  assert.equal(anders.statusCode, 404);
  // Tijdelijk conceptadres mag; het definitieve domein niet.
  assert.equal((await req('mk', 'PUT', `/api/projecten/${PA}/beslissingen/websiteadres`, { conceptadres: true })).statusCode, 200);
  assert.equal((await req('mk', 'PUT', `/api/projecten/${PA}/beslissingen/websiteadres`, { domein: 'voorbeeldweg1.nl' })).statusCode, 403);
  assert.equal((await req('mk', 'POST', `/api/projecten/${PA}/snelle-beoordeling`, { domein: 'voorbeeldweg1.nl' })).statusCode, 403);
  assert.equal((await req('mk', 'PUT', `/api/projecten/${PB}/beslissingen/websiteadres`, { conceptadres: true })).statusCode, 404);
  // Concept aanvragen: geen rechtenweigering (wel 'nog niet klaar' zonder vrijgave).
  assert.notEqual((await req('mk', 'POST', `/api/projecten/${PA}/concepten`)).statusCode, 403);
  assert.equal((await req('mk', 'POST', `/api/projecten/${PB}/concepten`)).statusCode, 404);
});

test('makelaar: een concept beoordelen of goedkeuren mag niet; de kantoorbeheerder wel', async () => {
  assert.equal((await req('mk', 'PUT', `/api/concepten/${CA}/beoordeling`, { besluit: 'geaccepteerd' })).statusCode, 403);
  assert.equal((await req('mkB', 'PUT', `/api/concepten/${CA}/beoordeling`, { besluit: 'geaccepteerd' })).statusCode, 404);
  const r = await req('kb', 'PUT', `/api/concepten/${CA}/beoordeling`, { besluit: 'geaccepteerd', motivering: 'Akkoord' });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, 'geaccepteerd');
});

test('kantoorbeheerder: definitief websiteadres en het eigen kantoor; korte naam, status en koppeling niet', async () => {
  assert.equal((await req('kb', 'PUT', `/api/projecten/${PA}/beslissingen/websiteadres`, { domein: 'rol-a-woning.nl' })).statusCode, 200);
  const k = await req('kb', 'PUT', `/api/kantoren/${A}`, { merknaam: 'Kantoor A', email: 'info@kantoor-a.test', slug: 'iets-anders', status: 'inactief' });
  assert.equal(k.statusCode, 200, k.body);
  assert.deepEqual([k.json().email, k.json().slug, k.json().status], ['info@kantoor-a.test', 'rol-a', 'actief']);
  assert.equal((await req('kb', 'PUT', `/api/kantoren/${A}/rhadix-organisatie`, { tenant_id: null })).statusCode, 403);
  assert.equal((await req('kb', 'PUT', `/api/kantoren/${B}`, { merknaam: 'X' })).statusCode, 404);
  assert.equal((await req('kb', 'POST', '/api/kantoren', { merknaam: 'Nieuw' })).statusCode, 403);
  assert.equal((await req('mk', 'PUT', `/api/kantoren/${A}`, { merknaam: 'X' })).statusCode, 403);
  assert.equal((await req('mk', 'POST', `/api/kantoren/${A}/huisstijl/voorstel`)).statusCode, 403);
  assert.equal((await req('kb', 'GET', '/api/status')).statusCode, 403);
});

test('database: makelaar schrijft alleen in het eigen kantoor, ook buiten de API om', async () => {
  const mk = (sql: string, v: unknown[] = []) => alsGebruiker(id.mk, (cl) => cl.query(sql, v));
  await assert.rejects(mk(`INSERT INTO gegeven (project_id, kantoor_id, sleutel, label, waarde, herkomst, status) VALUES ($1, $2, 'feit.x', 'X', '1', 'handmatig', 'goedgekeurd')`, [PB, B]), /row-level security|ander project/,
    'geweigerd: het project van een ander kantoor is voor de makelaar niet eens zichtbaar');
  await mk(`INSERT INTO gegeven (project_id, kantoor_id, sleutel, label, waarde, herkomst, status) VALUES ($1, $2, 'feit.x', 'X', '1', 'handmatig', 'goedgekeurd')`, [PA, A]);
  assert.equal((await mk(`UPDATE bestand SET vervallen = true WHERE kantoor_id = $1`, [B])).rowCount, 0);
  assert.equal((await mk('DELETE FROM project')).rowCount, 0, 'verwijderen blijft platformbeheer');
  await assert.rejects(mk(`INSERT INTO besluit (project_id, kantoor_id, door, onderwerp, handeling) VALUES ($1, $2, $3, 'concept v1', 'geaccepteerd')`, [PA, A, id.mk]), /row-level security/);
  assert.equal((await mk(`UPDATE concept SET status = 'geaccepteerd' WHERE id = $1`, [CA])).rowCount, 0);
});

test('database: definitieve publicatie is voor kantoren geblokkeerd, ook buiten de API om', async () => {
  for (const wie of [id.mk, id.kb]) {
    for (const status of ['live', 'publicatiecontrole', 'goedgekeurd'])
      await assert.rejects(alsGebruiker(wie, (cl) => cl.query('UPDATE project SET status = $2 WHERE id = $1', [PA, status])), /voorbehouden aan platformbeheer/);
  }
  await assert.rejects(alsGebruiker(id.mk, (cl) => cl.query("UPDATE project SET domein = 'stiekem.nl' WHERE id = $1", [PA])), /kantoorbeheerder/);
  await assert.rejects(alsGebruiker(id.kb, (cl) => cl.query("UPDATE kantoor SET slug = 'nieuw' WHERE id = $1", [A])), /platformbeheer/);
  await assert.rejects(alsGebruiker(id.kb, (cl) => cl.query("UPDATE kantoor SET status = 'inactief' WHERE id = $1", [A])), /platformbeheer/);
  // Platformbeheer behoudt de centrale controle.
  assert.equal((await alsGebruiker(id.beheer, (cl) => cl.query("UPDATE project SET status = 'publicatiecontrole' WHERE id = $1", [PB]))).rowCount, 1);
  await pool.query("UPDATE project SET status = 'aanlevering_incompleet' WHERE id = $1", [PB]);
});

test('ik-gegevens tonen per kantoor de rol (voor de interface)', async () => {
  const ik = (await req('mk', 'GET', '/api/ik')).json();
  assert.deepEqual(ik.kantoren.map((k: { naam: string; rol: string }) => [k.naam, k.rol]), [['Kantoor A', 'makelaar']]);
  assert.equal(ik.platformbeheer, false);
});

test('rechten per project voor de interface: gelijk aan wat de API afdwingt', async () => {
  assert.deepEqual((await req('mk', 'GET', `/api/projecten/${PA}/rechten`)).json(), { produceren: true, kantoorbeheer: false });
  assert.deepEqual((await req('kb', 'GET', `/api/projecten/${PA}/rechten`)).json(), { produceren: true, kantoorbeheer: true });
  assert.deepEqual((await req('beheer', 'GET', `/api/projecten/${PB}/rechten`)).json(), { produceren: true, kantoorbeheer: true });
  assert.equal((await req('mkB', 'GET', `/api/projecten/${PA}/rechten`)).statusCode, 404);
});

test('preview van een concept: alleen na aanmelding en voor het eigen kantoor (afgeschermd)', async () => {
  const { config } = await import('../api/src/config.ts');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const site = join(config.opslag, 'x', 'site');
  mkdirSync(site, { recursive: true });
  writeFileSync(join(site, 'index.html'), '<!doctype html><title>Concept</title><link rel="stylesheet" href="stijl.css">');
  writeFileSync(join(site, 'stijl.css'), 'body{}');
  const tok = (await pool.query('SELECT voorbeeld_token AS t FROM concept WHERE id = $1', [CA])).rows[0].t;
  const vorig = config.voorbeeldAfgeschermd;
  config.voorbeeldAfgeschermd = true;
  try {
    const haal = (pad: string, cookie?: string) => app.inject({ method: 'GET', url: `/api/voorbeeld/${tok}/${pad}`, headers: cookie ? { cookie } : {} });
    assert.equal((await haal('')).statusCode, 404, 'zonder aanmelding: niet gevonden, ook met het juiste token');
    assert.equal((await haal('stijl.css')).statusCode, 404);
    assert.equal((await haal('', c.mkB)).statusCode, 404, 'makelaar van een ander kantoor');
    const eigen = await haal('', c.mk);
    assert.equal(eigen.statusCode, 200);
    const sc = String(eigen.headers['set-cookie']);
    assert.match(sc, new RegExp(`^mp_voorbeeld=\\d+\\.[A-Za-z0-9_-]+; Path=/api/voorbeeld/${tok}/;`));
    assert.match(sc, /HttpOnly; Secure; SameSite=None/);
    // Binnen de sandbox: bestanden met alleen het previewcookie (geen inlogcookie).
    const pc = sc.split(';')[0];
    assert.equal((await haal('stijl.css', pc)).statusCode, 200);
    assert.equal((await haal('stijl.css', pc.replace(/.$/, (x) => (x === 'A' ? 'B' : 'A')))).statusCode, 404, 'gewijzigde handtekening');
    const [naam, waarde] = pc.split('='); const [, sig] = waarde.split('.');
    assert.equal((await haal('stijl.css', `${naam}=${Math.floor(Date.now() / 1000) - 10}.${sig}`)).statusCode, 404, 'verlopen');
    assert.equal((await haal('', c.beheer)).statusCode, 200, 'platformbeheer');
  } finally { config.voorbeeldAfgeschermd = vorig; }
});
