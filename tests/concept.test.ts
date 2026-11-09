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
const snel = (d: object) => req('beheer', 'POST', `/api/projecten/${P}/snelle-beoordeling`, d);
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

  // Snelle beoordeling: zonder bronovername blokkeert de broncontrole; tegenstrijdigheden blokkeren het interne concept niet.
  let b = await st();
  const punt = (x: typeof b, code: string) => x.checklist.find((y: { code: string }) => y.code === code);
  assert.deepEqual([punt(b, 'bron').ok, punt(b, 'bron').verplicht], [false, true]);
  assert.equal(punt(b, 'tegenstrijdigheden').verplicht, false, 'inhoudelijke tegenstrijdigheid blokkeert het interne concept niet');
  const besluiten = async () => (await pool.query('SELECT count(*)::int AS n FROM besluit WHERE project_id = $1', [P])).rows[0].n;
  const n0 = await besluiten();
  assert.equal((await snel({ rechten: 'Toestemming Linde' })).statusCode, 400, 'zonder bevestiging van de overname');
  assert.equal((await snel({ overnemen: true })).statusCode, 400, 'rechten zonder toelichting');
  assert.equal(await besluiten(), n0, 'geweigerd: niets vastgelegd');
  const s1 = await snel({ overnemen: true, rechten: 'Toestemming Linde' });
  assert.equal(s1.statusCode, 200, s1.body);
  assert.deepEqual(s1.json().open, []);
  b = s1.json().beoordeling;
  assert.equal(b.vrijgave.vrijgegeven, true, 'in één handeling vrijgegeven');
  // Overnemen is geen verificatie: geen enkel gegeven is goedgekeurd.
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM gegeven WHERE project_id = $1 AND status = 'goedgekeurd'", [P])).rows[0].n, 0);
  const ov = b.besluiten.find((x: { onderwerp: string }) => x.onderwerp === 'bronovername');
  assert.equal(ov.handeling, 'overgenomen als uitgangspunt'); assert.ok(ov.door);
  assert.match(ov.waarde.sha256, /^[0-9a-f]{64}$/, 'bronversie vastgelegd'); assert.match(ov.waarde.betekenis, /geen inhoudelijke bevestiging/);
  assert.ok(ov.waarde.open_tegenstrijdigheden.includes('Kamers'));
  for (const code of ['gegevens', 'tegenstrijdigheden', 'terminologie', 'fotokwaliteit']) {
    assert.equal(punt(b, code).ok, false, `${code} staat nog open`); assert.equal(punt(b, code).verplicht, false, `${code} blokkeert niet`);
  }
  for (const o of ['bronovername', 'rechten', 'profiel', 'websiteadres', 'openingsbeeld', 'vrijgave']) assert.ok(b.besluiten.some((x: { onderwerp: string }) => x.onderwerp === o), `besluit ${o} in het log`);
  assert.ok(b.kwaliteit.resultaat.info.some((x: { tekst: string }) => /vastgelegd als feit 'Bijdrage VvE'/.test(x.tekst)), 'VvE-bedrag als informatie');
  assert.equal(b.kwaliteit.indeling.samenvatting.length, 4);

  // Concept v1.
  const g1 = await req('beheer', 'POST', `/api/projecten/${P}/concepten`);
  assert.equal(g1.statusCode, 202, g1.body);
  assert.equal((await req('b', 'POST', `/api/projecten/${P}/concepten`)).statusCode, 404, 'een ander kantoor kan niet genereren');
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
  assert.equal(v1.metingen.totaal.binnen_ambitie_machine, true, `machinetijd ${v1.metingen.totaal.machine_ms} ms`);
  // Drie afzonderlijke metingen; zonder geregistreerde interacties is de actieve tijd niet betrouwbaar en de ambitie niet vast te stellen.
  assert.equal(v1.metingen.versie, 2);
  assert.equal(v1.metingen.actief.totaal.betrouwbaar, false); assert.equal(v1.metingen.totaal.binnen_ambitie, null);
  assert.ok(v1.metingen.kalender.ms >= v1.metingen.conceptgeneratie.totaal_ms);
  // Uitgangspunten: bronovername en de open tegenstrijdigheid met de gebruikte waarde, als onbevestigd.
  assert.ok(v1.uitgangspunten.bronovername?.sha256);
  const kamers = v1.uitgangspunten.onzekerheden.find((o: { sleutel: string }) => o.sleutel === 'feit.kamers');
  assert.equal(kamers.soort, 'tegenstrijdigheid'); assert.equal(kamers.verificatie, 'onbevestigd'); assert.ok(kamers.gebruikte_waarde);
  const woning = JSON.parse(readFileSync(join(config.opslag, v1.map, 'aanlevering', 'woning.json'), 'utf8'));
  assert.equal(woning.feiten.find((f: { sleutel: string }) => f.sleutel === 'kamers').verificatie, 'onbevestigd', 'niet als opgelost gemarkeerd');
  assert.ok(v1.indeling.samenvatting.length === 4 && v1.indeling.meldingen.every((m: { actie: string }) => m.actie !== 'conceptgeneratie'));
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
  assert.equal((await req('a', 'PUT', `/api/concepten/${v1.id}/beoordeling`, { besluit: 'geaccepteerd' })).statusCode, 403, 'een makelaar beoordeelt geen concept');
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
  // Dashboard en projectdetail tonen het aantal versies (route dashboard → project → concepten).
  assert.equal((await req('beheer', 'GET', `/api/projecten/${P}`)).json().concepten, 2);
  assert.equal((await req('beheer', 'GET', '/api/projecten')).json().projecten.find((x: { id: string }) => x.id === P).concepten, 2);
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
