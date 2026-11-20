// Stap 3A.4 – benchmark Beusemkolkweg 16, Tilligte (zoals project 'bossie' op test): de makelaarroute met de echte
// brochure en de echte generator. Controleert: domeinvoorstel zonder plaats en een bezette naam blokkeert niets;
// woningtype niet nodig; profiel buitenplaats; geen interne projectnaam op de website; navigatie voor kopers;
// zon/schaduw als interne plaatshouder alleen in de afgeschermde preview, nooit in de opgeslagen site.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { bouwApp } from '../api/src/server.ts';
import { migreer, pool } from '../api/src/db.ts';
import { wekVerwerker } from '../api/src/aanlevering.ts';
import { config } from '../api/src/config.ts';
import { opslagPad } from '../api/src/opslag.ts';
import { wisDomeinCache } from '../api/src/keuzes.ts';
import { login, maakGebruiker, maakKantoorDirect } from './hulp.ts';

const BROCHURE = join(homedir(), 'Backups', 'ai-storytelling-nulmeting-2026-11-05', 'brochures', 'beusemkolkweg-16-tilligte-brochure.pdf');
const app = bouwApp();
let A = '';
const c: Record<string, string> = {};
before(async () => {
  await migreer();
  A = await maakKantoorDirect('Rhadix testmakelaars', 'rhadix-testmakelaars');
  await pool.query("UPDATE kantoor SET telefoon = '0600000000', email = 'info@test.invalid' WHERE id = $1", [A]);
  await maakGebruiker('mk@studio.test', { kantoren: [[A, 'kantoorbeheerder']] });
  c.mk = await login(app, 'mk@studio.test');
});
after(() => app.close());
const req = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => app.inject({ method, url, headers: { cookie: c.mk }, payload });

test('benchmark Beusemkolkweg 16 (bossie): naam, domein, woningtype, navigatie, zon/schaduw', { skip: !existsSync(BROCHURE) && 'brochure niet lokaal', timeout: 900_000 }, async () => {
  const nep = createServer((_q, s) => { s.statusCode = 200; s.end('{}'); });   // het register meldt alles als bezet
  await new Promise<void>((ok) => nep.listen(0, '127.0.0.1', () => ok()));
  const vorig = config.rdapNl; config.rdapNl = `http://127.0.0.1:${(nep.address() as { port: number }).port}`;
  try {
    // Zoals de vereenvoudigde aanlevering: kantoor zonder standaardprofiel → buitenplaats.
    const P = (await req('POST', '/api/projecten', { kantoor_id: A, naam: 'bossie', profiel: 'buitenplaats' })).json().id as string;
    await app.inject({ method: 'POST', url: `/api/projecten/${P}/bestanden?soort=brochure`, headers: { cookie: c.mk, 'content-type': 'application/pdf' }, payload: readFileSync(BROCHURE) });
    assert.equal((await req('POST', `/api/projecten/${P}/verwerkingen`, { soort: 'brochure-import' })).statusCode, 202);
    await wekVerwerker();
    let k = (await req('GET', `/api/projecten/${P}/keuzes`)).json();
    assert.equal(k.project.adres, 'Beusemkolkweg 16'); assert.equal(k.project.plaats, 'Tilligte');
    assert.equal(k.domein.voorstel, 'beusemkolkweg16.nl', 'straat + huisnummer, zonder plaats');

    // Domein: bezet (en daarna een eigen, gewijzigde naam); blokkeert niets.
    wisDomeinCache();
    assert.equal((await req('POST', `/api/projecten/${P}/keuzes/domein`, { domein: 'beusemkolkweg16.nl', controleer: true })).json().uitkomst.status, 'bezet');
    assert.equal((await req('POST', `/api/projecten/${P}/keuzes/domein`, { domein: 'erve-beusemkolk.nl', controleer: false })).statusCode, 200, 'makelaar kan wijzigen');
    // Homepagefoto: het automatische voorstel; zon/schaduw: ja met foto.
    assert.ok(k.openingsbeeld.voorstel);
    assert.equal((await req('PUT', `/api/projecten/${P}/beslissingen/openingsbeeld`, { bestand_id: k.openingsbeeld.voorstel })).statusCode, 200);
    assert.equal((await req('PUT', `/api/projecten/${P}/keuzes/zonschaduw`, { gewenst: true, bestand_id: k.openingsbeeld.voorstel })).statusCode, 200);

    // Conceptwebsite aanmaken (zelfde aanroepen als de knop).
    const sb = await req('POST', `/api/projecten/${P}/snelle-beoordeling`, { overnemen: true, openingsbeeld: k.openingsbeeld.voorstel });
    assert.equal(sb.statusCode, 200, sb.body);
    assert.deepEqual(sb.json().open, [], 'woningtype en domein blokkeren niets: ' + JSON.stringify(sb.json().open));
    const p = (await pool.query('SELECT woningtype, profiel, domein FROM project WHERE id = $1', [P])).rows[0];
    assert.equal(p.profiel, 'buitenplaats'); assert.equal(p.domein, null);
    const g = await req('POST', `/api/projecten/${P}/concepten`);
    assert.equal(g.statusCode, 202, g.body);
    await wekVerwerker();
    const lijst = (await req('GET', `/api/projecten/${P}/concepten`)).json();
    assert.equal(lijst.generatie.status, 'klaar', lijst.generatie.melding ?? '');
    const kc = (await pool.query('SELECT map, voorbeeld_token FROM concept WHERE project_id = $1', [P])).rows[0];

    // Geen interne projectnaam in de website of de aanlevering aan de generator.
    const opslag = readFileSync(opslagPad(`${kc.map}/site/index.html`), 'utf8');
    const woning = JSON.parse(readFileSync(opslagPad(`${kc.map}/aanlevering/woning.json`), 'utf8'));
    assert.equal(woning.naam, 'Beusemkolkweg 16');
    assert.doesNotMatch(opslag, /bossie/i, 'interne projectnaam niet in de website');
    assert.match(opslag, /Beusemkolkweg 16 · Tilligte|Beusemkolkweg 16<\/span>/, 'objectadres in de header');
    // Navigatie voor kopers.
    const nav = [...(opslag.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? '').matchAll(/<a[^>]*href="#([^"]+)"[^>]*>([^<]+)</g)].map((m) => m[2].trim());
    for (const slecht of ['Eerste en tweede', 'Begane grond kantoor', 'Wonen in']) assert.ok(!nav.includes(slecht), `geen '${slecht}' in de navigatie: ${nav.join(' | ')}`);
    assert.match(opslag, /<h2[^>]*>Verdieping kantoor/); assert.match(opslag, /<h2[^>]*>Wonen in de omgeving van Tilligte/);
    console.log('  navigatie:', nav.join(' | '));

    // Zon/schaduw: plaatshouder alleen in de afgeschermde preview, nooit in de opgeslagen site.
    assert.doesNotMatch(opslag, /data-mp-intern/, 'opgeslagen site zonder plaatshouder');
    const pv = await req('GET', `/api/voorbeeld/${kc.voorbeeld_token}/`);
    assert.equal(pv.statusCode, 200);
    assert.match(pv.body, /data-mp-intern="zon-schaduw"/); assert.match(pv.body, /Intern · alleen in de afgeschermde preview/);
    assert.ok(pv.body.indexOf('data-mp-intern') < pv.body.search(/<section[^>]*id="contact"/), 'eigen onderdeel vóór contact');
    assert.equal(readFileSync(opslagPad(`${kc.map}/site/index.html`), 'utf8'), opslag, 'bestand op schijf ongewijzigd na het serveren');
    // Zonder aanvraag: geen plaatshouder.
    await req('PUT', `/api/projecten/${P}/keuzes/zonschaduw`, { gewenst: false });
    k = (await req('GET', `/api/projecten/${P}/keuzes`)).json();
    assert.equal(k.zonschaduw.gewenst, false);
    assert.match((await req('GET', `/api/voorbeeld/${kc.voorbeeld_token}/`)).body, /data-mp-intern/, 'het concept toont de aanvraag van het moment van genereren');
  } finally { config.rdapNl = vorig; nep.close(); }
});
