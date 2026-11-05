// Stap 5: broncontrole, kwaliteitscontrole en vrijgave voor conceptgeneratie, met Markt 27 als
// praktijkvoorbeeld. Er wordt niets gegenereerd of gepubliceerd.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
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

const req = (wie: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: c[wie] }, payload });
const st = async () => (await req('beheer', 'GET', `/api/projecten/${P}/beoordeling`)).json();
const beslis = (onderwerp: string, data: object, wie = 'beheer') => req(wie, 'PUT', `/api/projecten/${P}/beslissingen/${onderwerp}`, data);
const gegeven = (s: string, data: object) => req('beheer', 'PUT', `/api/projecten/${P}/gegevens/${s}`, data);
const punt = (b: { checklist: { code: string; ok: boolean }[] }, code: string) => b.checklist.find((x) => x.code === code)!.ok;

test('Markt 27: van aanlevering via broncontrole en kwaliteitscontrole naar vrijgave', { skip: !existsSync(BROCHURE) && 'brochure niet lokaal' }, async () => {
  P = (await req('beheer', 'POST', '/api/projecten', { kantoor_id: A, naam: 'Markt 27' })).json().id;
  // Vóór de import: fase 1 open, de rest wacht.
  let b = await st();
  assert.deepEqual(b.fasen.map((f: { status: string }) => f.status), ['open', 'wacht', 'wacht', 'wacht']);
  await app.inject({ method: 'POST', url: `/api/projecten/${P}/bestanden?soort=brochure`, headers: { cookie: c.beheer, 'content-type': 'application/pdf' }, payload: readFileSync(BROCHURE) });
  await req('beheer', 'POST', `/api/projecten/${P}/verwerkingen`, { soort: 'brochure-import' });
  await wekVerwerker();

  // Broncontrole: overzicht van de stand.
  b = await st();
  assert.equal(b.fasen[0].status, 'gereed');
  assert.equal(b.fasen[1].status, 'open');
  assert.equal(b.broncontrole.telling.overgenomen, 22);
  assert.equal(b.broncontrole.telling.tegenstrijdig, 2);
  assert.equal(b.broncontrole.telling.opgelost, 0);
  assert.equal(b.klaar, false);
  const v0 = await beslis('vrijgave', {});
  assert.equal(v0.statusCode, 409); assert.ok(v0.json().open.length >= 5, 'vrijgave geweigerd met de openstaande punten');

  // Kwaliteitscontrole vóór de beslissingen: blokkades zichtbaar.
  assert.equal((await req('beheer', 'POST', `/api/projecten/${P}/kwaliteitscontrole`)).statusCode, 201);
  b = await st();
  const blok = b.kwaliteit.resultaat.blokkerend.map((x: { tekst: string }) => x.tekst).join(' | ');
  assert.match(blok, /Publicatierechten/); assert.match(blok, /Adres van de website/); assert.match(blok, /Presentatieprofiel/);
  assert.equal(b.kwaliteit.actueel, true);

  // Menselijke beoordeling: bulk, besluiten, afwijzen met motivering, rest afzonderlijk.
  await req('beheer', 'POST', `/api/projecten/${P}/gegevens/bulkgoedkeuring`);
  assert.equal((await gegeven('feit.kamers', { actie: 'goedkeuren', bevestigd: true, motivering: 'Kenmerkentabel aangehouden; makelaar bevestigt 4 kamers' })).statusCode, 200);
  assert.equal((await gegeven('feit.tuin', { actie: 'goedkeuren', bevestigd: true, motivering: 'Zonneterras = het balkon op het dak' })).statusCode, 200);
  assert.equal((await gegeven('feit.warmwater', { actie: 'afwijzen' })).statusCode, 400, 'afwijzen zonder motivering');
  assert.equal((await gegeven('feit.warmwater', { actie: 'afwijzen', motivering: 'Dubbel met verwarming' })).json().status, 'afgewezen');
  b = await st();
  for (const g of b.broncontrole.te_beoordelen) assert.equal((await gegeven(g.sleutel, { actie: 'goedkeuren' })).statusCode, 200, g.sleutel);
  b = await st();
  assert.equal(b.fasen[1].status, 'gereed');
  assert.equal(b.broncontrole.te_beoordelen.length, 0, 'vastgestelde gegevens hoeven niet opnieuw beoordeeld');
  assert.deepEqual([b.broncontrole.telling.opgelost, b.broncontrole.telling.afgewezen], [2, 1]);

  // Kwaliteitscontrole: beslissingen op projectniveau.
  assert.equal((await beslis('rechten', { bevestigd: true })).statusCode, 400, 'rechten zonder toelichting');
  assert.equal((await beslis('rechten', { bevestigd: true, motivering: 'Linde bevestigt per mail van 5-11' })).statusCode, 200);
  assert.equal((await beslis('profiel', { profiel: 'stads' })).statusCode, 200);
  assert.equal((await beslis('websiteadres', { conceptadres: true })).statusCode, 200);
  b = await st();
  const klein = b.broncontrole && (await req('beheer', 'GET', `/api/projecten/${P}/aanlevering`)).json().bestanden.find((x: { breedte: number; soort: string }) => x.soort === 'foto' && x.breedte < 1200);
  assert.equal((await beslis('openingsbeeld', { bestand_id: klein.id })).statusCode, 400, 'te klein voor het openingsbeeld');
  assert.ok(b.beslissingen.openingsbeeld_voorstel);
  assert.equal((await beslis('openingsbeeld', { bestand_id: b.beslissingen.openingsbeeld_voorstel })).statusCode, 200);
  assert.equal(punt(await st(), 'fotokwaliteit'), false, 'originelen nodig: beslissing vereist');
  assert.equal((await beslis('fotokwaliteit', { motivering: 'Eerste concept met brochurebeelden; originelen opgevraagd' })).statusCode, 200);
  b = await st();
  assert.equal(punt(b, 'kwaliteitscontrole'), false, 'na de beslissingen is de controle verouderd');
  assert.equal(b.kwaliteit.actueel, false);
  await req('beheer', 'POST', `/api/projecten/${P}/kwaliteitscontrole`);
  b = await st();
  assert.deepEqual(b.kwaliteit.resultaat.blokkerend, []);
  assert.ok(b.kwaliteit.resultaat.aandacht.some((x: { tekst: string }) => /€ 158/.test(x.tekst)), 'bedrag in de tekst ter beoordeling');
  assert.ok(b.checklist.every((x: { ok: boolean }) => x.ok), JSON.stringify(b.checklist.filter((x: { ok: boolean }) => !x.ok)));
  assert.equal(b.fasen[3].status, 'open');

  // De export volgt het aanleverformaat van de generator.
  const k = (await pool.query("SELECT volgnummer FROM verwerking WHERE project_id = $1 AND soort = 'kwaliteitscontrole' ORDER BY volgnummer DESC LIMIT 1", [P])).rows[0];
  const map = join(config.opslag, 'projecten', P, 'controle', String(k.volgnummer));
  const w = JSON.parse(readFileSync(join(map, 'woning.json'), 'utf8'));
  assert.equal(w.rechten.bevestigd, true); assert.equal(w.site.canonical, `https://${b.project.slug}.invalid/`); assert.equal(w.site.index, false);
  assert.equal(w.makelaar.naam, 'Linde Makelaars'); assert.equal(w.profiel, 'stads'); assert.ok(w.huisstijl);
  assert.ok(!w.feiten.some((f: { sleutel: string }) => f.sleutel === 'warmwater'), 'afgewezen feit niet in de export');
  assert.equal(w.feiten.find((f: { sleutel: string }) => f.sleutel === 'kamers').verificatie, 'bevestigd');
  assert.match(readFileSync(join(map, 'fotos.csv'), 'utf8'), /;ja;/);
  assert.doesNotMatch(readFileSync(join(map, 'woning.json'), 'utf8') + readFileSync(join(map, 'teksten.md'), 'utf8'), /vraagprijs|€\s?\d{3}\.\d{3}/i, 'geen vraagprijs in de export');

  // Vrijgave: alleen voor conceptgeneratie.
  assert.equal((await beslis('vrijgave', { motivering: 'Broncontrole en kwaliteitscontrole afgerond' }, 'a')).statusCode, 403, 'makelaar mag niet vrijgeven');
  const vr = await beslis('vrijgave', { motivering: 'Broncontrole en kwaliteitscontrole afgerond' });
  assert.equal(vr.statusCode, 200, vr.body);
  b = vr.json();
  assert.equal(b.project.status, 'klaar_voor_productie'); assert.equal(b.vrijgave.vrijgegeven, true); assert.equal(b.vrijgave.actueel, true);
  assert.equal(b.fasen[3].status, 'gereed');
  assert.match(b.vrijgave.betekenis, /geen publicatie/);

  // Besluitenlog: wie, wanneer, wat en waarom.
  const log = b.besluiten as { onderwerp: string; handeling: string; motivering: string | null; door: string; op: string }[];
  for (const o of ['rechten', 'profiel', 'websiteadres', 'openingsbeeld', 'fotokwaliteit', 'vrijgave', 'gegeven: Kamers', 'gegeven: Warm water']) assert.ok(log.some((x) => x.onderwerp === o), o);
  assert.ok(log.every((x) => x.door === 'beheer' && x.op));
  assert.equal(log.find((x) => x.onderwerp === 'gegeven: Warm water')!.motivering, 'Dubbel met verwarming');

  // Een wijziging na de vrijgave laat de vrijgave vervallen.
  await gegeven('feit.bouwjaar', { actie: 'corrigeren', waarde: '1997' });
  b = await st();
  assert.equal(b.project.status, 'aanlevering_incompleet'); assert.equal(b.vrijgave.vrijgegeven, false); assert.ok(b.vrijgave.vervallen_op);
  await gegeven('feit.bouwjaar', { actie: 'corrigeren', waarde: '1996' });

  // Nieuwe import: goedgekeurde, gecorrigeerde en afgewezen gegevens blijven ongemoeid.
  await req('beheer', 'POST', `/api/projecten/${P}/verwerkingen`, { soort: 'brochure-import' });
  await wekVerwerker();
  b = await st();
  assert.equal(b.broncontrole.telling.overgenomen, 0, 'geen enkel gegeven opnieuw te beoordelen');
  assert.equal(b.broncontrole.telling.afgewezen, 1);
  assert.equal(b.broncontrole.telling.opgelost, 2);

  // Gegevensscheiding: de makelaar ziet de beoordeling van het eigen kantoor, een ander kantoor niet.
  assert.equal((await req('a', 'GET', `/api/projecten/${P}/beoordeling`)).statusCode, 200);
  assert.equal((await req('b', 'GET', `/api/projecten/${P}/beoordeling`)).statusCode, 404);
  assert.equal((await req('a', 'POST', `/api/projecten/${P}/kwaliteitscontrole`)).statusCode, 403);
  const bg = await pool.query("SELECT count(*)::int AS n FROM besluit WHERE project_id = $1", [P]);
  assert.ok(bg.rows[0].n > 8);

  // Niets gegenereerd: de generator en de productie-instantie zijn ongewijzigd.
  assert.equal(execFileSync('git', ['-C', config.generator, 'status', '--porcelain'], { encoding: 'utf8' }), '');
  assert.ok(!readdirSync(join(config.generator, 'woningen')).some((x) => x.startsWith('linde')));
  assert.ok(!existsSync(join(config.generator, 'uitvoer', `${b.project.slug}`)));
});

test('besluitenlog kan niet worden gewijzigd of verwijderd', async () => {
  const id = (await pool.query("SELECT id FROM gebruiker WHERE email = 'beheer@studio.test'")).rows[0].id;
  const { alsGebruiker } = await import('../api/src/db.ts');
  await assert.rejects(alsGebruiker(id, (cl) => cl.query("UPDATE besluit SET motivering = 'x'")), /permission denied/);
  await assert.rejects(alsGebruiker(id, (cl) => cl.query('DELETE FROM besluit')), /permission denied/);
});
