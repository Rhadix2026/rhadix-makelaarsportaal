// Stap 6: conceptgeneratie en preview met de bestaande generator (automatische compositie, mp bouw)
// en de kwaliteitscontrole van Design System 1.0 (mp kwaliteit). Markt 27 als praktijkvoorbeeld.
// Bouwt echt (±1–2 minuten). Niets wordt gepubliceerd; de productie-instantie blijft ongewijzigd.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { bouwApp } from '../api/src/server.ts';
import { migreer, pool } from '../api/src/db.ts';
import { wekVerwerker } from '../api/src/aanlevering.ts';
import { config } from '../api/src/config.ts';
import { login, maakGebruiker, maakKantoorDirect } from './hulp.ts';

const BROCHURE = join(homedir(), 'Backups', 'ai-storytelling-nulmeting-2026-11-05', 'brochures', 'markt-27-wolvega-brochure.pdf');
const app = bouwApp();
let A = '', B = '', P = '';
const c: Record<string, string> = {};

before(async () => {
  await migreer();
  A = await maakKantoorDirect('Linde Makelaars', 'linde-makelaars');
  B = await maakKantoorDirect('Kantoor B', 'kantoor-b');
  await pool.query("UPDATE kantoor SET merkkleur = '#04158A', detailkleur = '#F02B89', telefoon = '0561 000000', email = 'info@linde.invalid' WHERE id = $1", [A]);
  await maakGebruiker('beheer@studio.test', { platform: true });
  await maakGebruiker('a@studio.test', { kantoren: [[A, 'makelaar']] });
  await maakGebruiker('b@studio.test', { kantoren: [[B, 'makelaar']] });
  for (const e of ['beheer', 'a', 'b']) c[e] = await login(app, `${e}@studio.test`);
});
after(() => app.close());

const req = (wie: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => app.inject({ method, url, headers: { cookie: c[wie] }, payload });
const st = async () => (await req('beheer', 'GET', `/api/projecten/${P}/beoordeling`)).json();
const beslis = (o: string, d: object) => req('beheer', 'PUT', `/api/projecten/${P}/beslissingen/${o}`, d);
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

test('Markt 27: vrijgave met alleen de verplichte punten, concept v1, preview, verbeterpunten, v2', { skip: !existsSync(BROCHURE) && 'brochure niet lokaal', timeout: 600_000 }, async () => {
  P = (await req('beheer', 'POST', '/api/projecten', { kantoor_id: A, naam: 'Markt 27' })).json().id;
  await app.inject({ method: 'POST', url: `/api/projecten/${P}/bestanden?soort=brochure`, headers: { cookie: c.beheer, 'content-type': 'application/pdf' }, payload: readFileSync(BROCHURE) });
  await req('beheer', 'POST', `/api/projecten/${P}/verwerkingen`, { soort: 'brochure-import' });
  await wekVerwerker();

  // Besluit 1: de VvE-bijdrage als feit met bron, niet automatisch publiceren.
  const a = (await req('beheer', 'GET', `/api/projecten/${P}/aanlevering`)).json();
  const vve = a.gegevens.find((g: { sleutel: string }) => g.sleutel === 'feit.vve_bijdrage');
  assert.equal(vve.vastgelegd.waarde, 158); assert.equal(vve.vastgelegd.eenheid, '€ per maand'); assert.equal(vve.vastgelegd.publiceren, false);
  assert.match(vve.vastgelegd.bron, /brochure p\. 2 \(Omschrijving: .*€ 158 per maand/);

  // Geen concept zonder vrijgave.
  assert.equal((await req('beheer', 'POST', `/api/projecten/${P}/concepten`)).statusCode, 409);

  // Besluit 2: alleen de verplichte punten. Gegevens niet allemaal beoordeeld, terminologie open: blokkeert niet.
  assert.equal((await req('beheer', 'PUT', `/api/projecten/${P}/gegevens/feit.kamers`, { actie: 'goedkeuren', bevestigd: true, motivering: 'Kenmerkentabel aangehouden' })).statusCode, 200);
  await beslis('rechten', { bevestigd: true, motivering: 'Toestemming Linde' });
  await beslis('profiel', { profiel: 'stads' });
  await beslis('websiteadres', { conceptadres: true });
  await beslis('openingsbeeld', { bestand_id: (await st()).beslissingen.openingsbeeld_voorstel });
  await req('beheer', 'POST', `/api/projecten/${P}/kwaliteitscontrole`);
  let b = await st();
  assert.equal(b.klaar, true, JSON.stringify(b.checklist.filter((x: { ok: boolean; verplicht: boolean }) => !x.ok && x.verplicht)));
  for (const code of ['gegevens', 'terminologie', 'fotokwaliteit']) {
    const x = b.checklist.find((y: { code: string }) => y.code === code);
    assert.equal(x.ok, false, `${code} staat nog open`); assert.equal(x.verplicht, false, `${code} blokkeert niet`);
  }
  assert.ok(b.kwaliteit.resultaat.info.some((x: { tekst: string }) => /vastgelegd als feit 'Bijdrage VvE'/.test(x.tekst)), 'VvE-bedrag als informatie');
  assert.equal((await beslis('vrijgave', { motivering: 'Verplichte punten afgerond' })).statusCode, 200);

  // Concept v1.
  const g1 = await req('beheer', 'POST', `/api/projecten/${P}/concepten`);
  assert.equal(g1.statusCode, 202, g1.body);
  assert.equal((await req('a', 'POST', `/api/projecten/${P}/concepten`)).statusCode, 403);
  await wekVerwerker();
  let lijst = (await req('beheer', 'GET', `/api/projecten/${P}/concepten`)).json();
  assert.equal(lijst.generatie.status, 'klaar', lijst.generatie.fout);
  assert.equal(lijst.concepten.length, 1);
  const v1 = (await req('beheer', 'GET', `/api/concepten/${lijst.concepten[0].id}`)).json();
  assert.equal(v1.versie, 1); assert.equal(v1.status, 'te_beoordelen');
  assert.equal(v1.ontwerpsysteem, '1.0'); assert.equal(v1.profiel, 'stads');
  assert.equal(v1.bouw.rapport.modus, 'automatisch', 'bestaande automatische compositie');
  assert.ok(v1.bouw.onderdelen.includes('hero') || v1.bouw.onderdelen.some((x: string) => x.startsWith('hero')));
  assert.ok(v1.kwaliteit && Array.isArray(v1.kwaliteit.blokkerend) && v1.kwaliteit.meetwaarden.some((m: { criterium: string }) => /toegankelijkheid/.test(m.criterium)));
  assert.ok(v1.metingen.totaal.machine_ms > 0 && v1.metingen.conceptgeneratie.stappen.bouw > 0);
  assert.equal(v1.metingen.totaal.binnen_ambitie, true, `machinetijd ${v1.metingen.totaal.machine_ms} ms`);
  const site1 = join(config.opslag, v1.map, 'site', 'index.html');
  const html = readFileSync(site1, 'utf8');
  assert.match(html, /Markt 27/); assert.match(html, /linde-makelaars-markt-27\.invalid/);
  assert.doesNotMatch(readFileSync(join(config.opslag, v1.map, 'woning', b.project.slug, 'manifest.json'), 'utf8'), /vve_bijdrage/, 'financieel feit niet in het manifest');
  assert.equal((await pool.query('SELECT status FROM project WHERE id = $1', [P])).rows[0].status, 'interne_review');

  // Preview: via het token, zonder sessie, afgeschermd; ander kantoor ziet het concept niet.
  const pv = await app.inject({ method: 'GET', url: `/api/voorbeeld/${v1.voorbeeld_token}/` });
  assert.equal(pv.statusCode, 200); assert.match(String(pv.headers['content-type']), /text\/html/);
  assert.match(String(pv.headers['content-security-policy']), /sandbox allow-scripts/); assert.equal(pv.headers['referrer-policy'], 'no-referrer');
  const img = html.match(/src="(img\/[^"?]+)/)![1];
  assert.equal((await app.inject({ method: 'GET', url: `/api/voorbeeld/${v1.voorbeeld_token}/${img}` })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: `/api/voorbeeld/${v1.voorbeeld_token}/..%2F..%2Faanlevering%2Fwoning.json` })).statusCode, 404, 'niet buiten de site');
  assert.notEqual((await app.inject({ method: 'GET', url: `/api/voorbeeld/${v1.voorbeeld_token}/../../aanlevering/woning.json` })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: `/api/voorbeeld/${'x'.repeat(43)}/` })).statusCode, 404);
  assert.equal((await req('b', 'GET', `/api/concepten/${v1.id}`)).statusCode, 404);
  assert.equal((await req('a', 'GET', `/api/concepten/${v1.id}`)).statusCode, 200);

  // Verbeterpunten, daarna een nieuwe versie zonder de vorige te overschrijven.
  assert.equal((await req('beheer', 'PUT', `/api/concepten/${v1.id}/beoordeling`, { besluit: 'verbeterpunten', verbeterpunten: [] })).statusCode, 400);
  const vb = await req('beheer', 'PUT', `/api/concepten/${v1.id}/beoordeling`, { besluit: 'verbeterpunten', verbeterpunten: [{ onderdeel: 'foto\'s', tekst: 'Originele foto\'s opvragen' }] });
  assert.equal(vb.json().status, 'verbeterpunten');
  assert.equal((await pool.query('SELECT status FROM project WHERE id = $1', [P])).rows[0].status, 'correctie');
  const hash1 = sha(site1);
  assert.equal((await req('beheer', 'POST', `/api/projecten/${P}/concepten`)).statusCode, 202);
  await wekVerwerker();
  lijst = (await req('beheer', 'GET', `/api/projecten/${P}/concepten`)).json();
  assert.deepEqual(lijst.concepten.map((x: { versie: number }) => x.versie), [2, 1]);
  assert.equal(sha(site1), hash1, 'v1 is niet overschreven');
  const v2 = lijst.concepten[0];
  assert.notEqual(v2.voorbeeld_token, v1.voorbeeld_token);
  assert.equal((await req('beheer', 'PUT', `/api/concepten/${v2.id}/beoordeling`, { besluit: 'geaccepteerd', motivering: 'Eerste concept akkoord' })).json().status, 'geaccepteerd');
  // De inhoud van een versie ligt vast in de database (alleen de beoordeling mag worden bijgewerkt).
  const { alsGebruiker } = await import('../api/src/db.ts');
  const id = (await pool.query("SELECT id FROM gebruiker WHERE email = 'beheer@studio.test'")).rows[0].id;
  await assert.rejects(alsGebruiker(id, (cl) => cl.query("UPDATE concept SET map = 'x' WHERE id = $1", [v2.id])), /permission denied/);
  await assert.rejects(alsGebruiker(id, (cl) => cl.query('DELETE FROM concept WHERE id = $1', [v2.id])), /permission denied/);
  b = await st();
  assert.ok(b.besluiten.some((x: { onderwerp: string; handeling: string }) => x.onderwerp === 'concept v1' && x.handeling === 'verbeterpunten vastgelegd'));
  assert.ok(b.besluiten.some((x: { onderwerp: string; handeling: string }) => x.onderwerp === 'concept v2' && x.handeling === 'geaccepteerd'));

  // De productie-instantie is niet gewijzigd en er staat geen woning van de studio in.
  assert.equal(execFileSync('git', ['-C', config.generator, 'status', '--porcelain'], { encoding: 'utf8' }), '');
  assert.ok(!readdirSync(join(config.generator, 'woningen')).some((x) => x.startsWith('linde')));
  assert.ok(!existsSync(join(config.generator, 'uitvoer', b.project.slug)));
  for (const sub of ['.cache', 'metingen']) assert.ok(!readdirSync(join(config.generator, sub)).some((f) => f.startsWith(b.project.slug)), `geen runbestanden in ${sub}`);
  assert.ok(readdirSync(join(config.opslag, v1.map, 'generator-log')).length > 0, 'runbestanden bij het concept bewaard');
});
