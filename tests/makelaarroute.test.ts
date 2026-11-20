// Stap 3A.3: de volledige route van de makelaar, uitsluitend met de rechten van de makelaar en met de
// bestaande functies: brochure importeren → gegevens → domeinnaam → homepagefoto → zon/schaduw →
// conceptwebsite aanmaken (snelle beoordeling + bestaande conceptgeneratie) → voortgang → concept bekijken →
// later een keuze wijzigen en een nieuwe conceptversie maken. Bouwt echt (±2× 1–2 minuten). Niets wordt gepubliceerd.
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
import { wisDomeinCache } from '../api/src/keuzes.ts';
import { login, maakGebruiker, maakKantoorDirect } from './hulp.ts';

const BROCHURE = join(homedir(), 'Backups', 'ai-storytelling-nulmeting-2026-11-05', 'brochures', 'markt-27-wolvega-brochure.pdf');
const app = bouwApp();
let A = '', B = '';
const c: Record<string, string> = {};

before(async () => {
  await migreer();
  A = await maakKantoorDirect('Linde Makelaars', 'linde-makelaars');
  B = await maakKantoorDirect('Kantoor B', 'kantoor-b');
  await pool.query("UPDATE kantoor SET telefoon = '0561 000000', email = 'info@linde.invalid', standaard_profiel = 'stads' WHERE id = $1", [A]);
  await maakGebruiker('mk@studio.test', { kantoren: [[A, 'kantoorbeheerder']] });   // zoals de testmakelaar op test
  await maakGebruiker('b@studio.test', { kantoren: [[B, 'kantoorbeheerder']] });
  for (const e of ['mk', 'b']) c[e] = await login(app, `${e}@studio.test`);
});
after(() => app.close());

const req = (wie: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => app.inject({ method, url, headers: { cookie: c[wie] }, payload });

test('makelaarroute Markt 27: import → keuzes → conceptwebsite → voortgang → bekijken → wijzigen → v2', { skip: !existsSync(BROCHURE) && 'brochure niet lokaal', timeout: 900_000 }, async () => {
  const nep = createServer((q, s) => { s.statusCode = q.url?.includes('bezet') ? 200 : 404; s.end('{}'); });
  await new Promise<void>((ok) => nep.listen(0, '127.0.0.1', () => ok()));
  const vorig = config.rdapNl; config.rdapNl = `http://127.0.0.1:${(nep.address() as { port: number }).port}`;
  try {
    // 1. Aanleveren met een eigen projectnaam (zoals 'test rene'); de import vult het adres.
    const p = (await req('mk', 'POST', '/api/projecten', { kantoor_id: A, naam: 'test rene', profiel: 'stads' })).json();
    const P = p.id as string;
    await app.inject({ method: 'POST', url: `/api/projecten/${P}/bestanden?soort=brochure`, headers: { cookie: c.mk, 'content-type': 'application/pdf' }, payload: readFileSync(BROCHURE) });
    assert.equal((await req('mk', 'POST', `/api/projecten/${P}/verwerkingen`, { soort: 'brochure-import' })).statusCode, 202);
    await wekVerwerker();

    // 2. Gegevens en keuzes: de projectnaam blijft staan, het adres komt uit de brochure.
    let k = (await req('mk', 'GET', `/api/projecten/${P}/keuzes`)).json();
    assert.equal(k.project.naam, 'test rene', 'handmatige projectnaam niet overschreven');
    assert.match(k.project.adres, /^Markt 27/); assert.equal(k.project.plaats, 'Wolvega');
    assert.match(k.domein.voorstel, /^markt27a?\.nl$/, `voorstel zonder plaats: ${k.domein.voorstel}`);
    assert.equal(k.domein.wens, null, 'voorstel ≠ gecontroleerde wens');

    // 3. Homepagefoto: meer keuze dan alleen de norm; voorkeur volgens de norm; lagere resolutie kiesbaar.
    const goed = k.fotos.filter((f: { kwaliteit: string }) => f.kwaliteit === 'goed');
    const beperkt = k.fotos.filter((f: { kwaliteit: string }) => f.kwaliteit === 'beperkt');
    assert.ok(goed.length >= 1 && beperkt.length >= 10, `kiesbaar: ${goed.length} goed + ${beperkt.length} beperkt van ${k.fotos.length}`);
    assert.ok(goed.some((f: { id: string }) => f.id === k.openingsbeeld.voorstel), 'automatische voorkeur volgens de norm');

    // 4. Domeinnaam: ongeldig, bezet, beschikbaar (server controleert altijd zelf).
    wisDomeinCache();
    assert.equal((await req('mk', 'POST', `/api/projecten/${P}/keuzes/domein`, { domein: 'markt 27.nl', controleer: true })).statusCode, 400, 'ongeldig');
    const bez = await req('mk', 'POST', `/api/projecten/${P}/keuzes/domein`, { domein: 'bezet-markt27.nl', controleer: true });
    assert.equal(bez.json().uitkomst.status, 'bezet');
    wisDomeinCache();
    const vrij = await req('mk', 'POST', `/api/projecten/${P}/keuzes/domein`, { domein: k.domein.voorstel, controleer: true });
    assert.equal(vrij.json().uitkomst.status, 'beschikbaar'); assert.equal(vrij.json().gereserveerd, false);

    // 5. Homepagefoto met lagere resolutie (bewust), 6. zon/schaduw ja met foto.
    const gekozen = beperkt[0].id as string;
    assert.equal((await req('mk', 'PUT', `/api/projecten/${P}/beslissingen/openingsbeeld`, { bestand_id: gekozen })).statusCode, 200);
    assert.equal((await req('mk', 'PUT', `/api/projecten/${P}/keuzes/zonschaduw`, { gewenst: true, bestand_id: beperkt[1].id })).statusCode, 200);
    k = (await req('mk', 'GET', `/api/projecten/${P}/keuzes`)).json();
    assert.equal(k.openingsbeeld.gekozen, gekozen); assert.equal(k.zonschaduw.gewenst, true);

    // 7. Conceptwebsite aanmaken: precies wat de knop doet (snelle beoordeling, dan de bestaande generatie).
    assert.equal((await req('b', 'POST', `/api/projecten/${P}/snelle-beoordeling`, { overnemen: true })).statusCode, 404, 'ander kantoor');
    const sb = await req('mk', 'POST', `/api/projecten/${P}/snelle-beoordeling`, { overnemen: true, openingsbeeld: gekozen });
    assert.equal(sb.statusCode, 200, sb.body);
    assert.deepEqual(sb.json().open, [], JSON.stringify(sb.json().open));
    const bo = sb.json().beoordeling;
    assert.equal(bo.beslissingen.openingsbeeld.id, gekozen, 'keuze van de makelaar blijft staan');
    assert.equal(bo.checklist.find((x: { code: string }) => x.code === 'openingsbeeld_kwaliteit').ok, false, 'beeldnorm: zichtbaar aandachtspunt');
    assert.equal(bo.beslissingen.domein, null, 'domeinwens is niet het definitieve domein'); assert.equal(bo.beslissingen.conceptadres, true);
    const g1 = await req('mk', 'POST', `/api/projecten/${P}/concepten`);
    assert.equal(g1.statusCode, 202, g1.body);
    assert.equal((await req('mk', 'POST', `/api/projecten/${P}/concepten`)).statusCode, 409, 'niet dubbel starten');
    await wekVerwerker();
    const s1 = (await req('mk', 'GET', `/api/projecten/${P}/verwerkingen/${g1.json().id}`)).json();
    assert.equal(s1.status, 'klaar', s1.melding ?? ''); assert.equal(s1.voortgang.percentage, 100); assert.equal(s1.concept.versie, 1);

    // 8. Concept bekijken: de bestaande preview; de gekozen homepagefoto is het openingsbeeld.
    let lijst = (await req('mk', 'GET', `/api/projecten/${P}/concepten`)).json();
    assert.equal(lijst.concepten.length, 1);
    const pv = await app.inject({ method: 'GET', url: `/api/voorbeeld/${lijst.concepten[0].voorbeeld_token}/` });
    assert.equal(pv.statusCode, 200); assert.match(pv.body, /<html/i);
    const v1 = (await req('mk', 'GET', `/api/concepten/${lijst.concepten[0].id}`)).json();
    assert.match(JSON.stringify(v1.bouw), /aangewezen in de aanlevering/, 'generator gebruikt de gekozen homepagefoto');
    assert.equal((await req('b', 'GET', `/api/concepten/${lijst.concepten[0].id}`)).statusCode, 404, 'ander kantoor ziet het concept niet');

    // 9. Later wijzigen: andere homepagefoto, opnieuw aanmaken → v2; v1 blijft bewaard.
    const ander = goed[0].id as string;
    assert.equal((await req('mk', 'PUT', `/api/projecten/${P}/beslissingen/openingsbeeld`, { bestand_id: ander })).statusCode, 200);
    const sb2 = await req('mk', 'POST', `/api/projecten/${P}/snelle-beoordeling`, { overnemen: true, openingsbeeld: ander });
    assert.deepEqual(sb2.json().open, [], sb2.body.slice(0, 400));
    const g2 = await req('mk', 'POST', `/api/projecten/${P}/concepten`);
    assert.equal(g2.statusCode, 202, g2.body);
    await wekVerwerker();
    lijst = (await req('mk', 'GET', `/api/projecten/${P}/concepten`)).json();
    assert.deepEqual(lijst.concepten.map((x: { versie: number }) => x.versie), [2, 1]);
    // Alles in het besluitenlog.
    const log = (await pool.query('SELECT onderwerp FROM besluit WHERE project_id = $1', [P])).rows.map((r) => r.onderwerp);
    for (const o of ['domeinwens', 'openingsbeeld', 'zonschaduw', 'bronovername', 'vrijgave']) assert.ok(log.includes(o), o);
  } finally { config.rdapNl = vorig; nep.close(); }
});
