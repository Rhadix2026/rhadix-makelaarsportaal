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

const req = (wie: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
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

// ── Stap 3A.2: keuzes van de makelaar ──────────────────────────────────────
import { createServer } from 'node:http';
import { config } from '../api/src/config.ts';
import { controleerDomein, domeinVoorstel, geldigNlDomein, wisDomeinCache } from '../api/src/keuzes.ts';

test('domeinvoorstel uit het adres en .nl-validatie', () => {
  assert.equal(domeinVoorstel('Denekamperstraat 23B'), 'denekamperstraat23b.nl');
  assert.equal(domeinVoorstel('Markt 27'), 'markt27.nl');
  assert.equal(domeinVoorstel("Hoofdstraat 12-a 'De Eik'"), 'hoofdstraat12adeeik.nl');
  assert.equal(domeinVoorstel('Kerkweg 1, Ëibergen'), 'kerkweg1eibergen.nl');
  assert.equal(domeinVoorstel(null), null);
  assert.ok(geldigNlDomein('markt27.nl') && geldigNlDomein('markt-27.nl'));
  for (const fout of ['markt27.com', '-markt.nl', 'markt-.nl', 'a..nl', 'xn--abc.nl', 'markt 27.nl', '.nl']) assert.ok(!geldigNlDomein(fout), fout);
});

test('beschikbaarheidscontrole: alleen 404 = beschikbaar, 200 = bezet, al het andere = onbekend (nooit geraden)', async () => {
  const antwoord = (status: number) => (async () => new Response('', { status })) as unknown as typeof fetch;
  wisDomeinCache(); assert.equal((await controleerDomein('vrij-a.nl', antwoord(404))).status, 'beschikbaar');
  wisDomeinCache(); assert.equal((await controleerDomein('bezet-a.nl', antwoord(200))).status, 'bezet');
  wisDomeinCache(); const r = await controleerDomein('druk-a.nl', antwoord(429)); assert.equal(r.status, 'onbekend'); assert.match(r.reden!, /minuut/);
  wisDomeinCache(); assert.equal((await controleerDomein('stuk-a.nl', (async () => { throw new Error('netwerk'); }) as unknown as typeof fetch)).status, 'onbekend');
  wisDomeinCache(); await controleerDomein('een-a.nl', antwoord(404));
  assert.equal((await controleerDomein('twee-a.nl', antwoord(404))).status, 'onbekend', 'minimaal 5 s tussen opvragingen');
  assert.equal((await controleerDomein('een-a.nl', antwoord(200))).status, 'beschikbaar', 'uitslag 10 minuten onthouden');
});

test('keuzes via de API: domeinwens met servercontrole, zon/schaduw, organisatiescheiding en zichtbaar in het besluitenlog', async () => {
  const nep = createServer((q, s) => { s.statusCode = q.url?.includes('bezet') ? 200 : 404; s.end('{}'); });
  await new Promise<void>((ok) => nep.listen(0, '127.0.0.1', () => ok()));
  const vorig = config.rdapNl; config.rdapNl = `http://127.0.0.1:${(nep.address() as { port: number }).port}`;
  try {
    const p = (await req('a', 'POST', '/api/projecten', { kantoor_id: A, naam: 'Keuzes A', profiel: 'buitenplaats' })).json();
    await pool.query("UPDATE project SET adres = 'Denekamperstraat 23B', plaats = 'Beuningen' WHERE id = $1", [p.id]);
    const k = (await req('a', 'GET', `/api/projecten/${p.id}/keuzes`)).json();
    assert.equal(k.domein.voorstel, 'denekamperstraat23b.nl');
    assert.deepEqual(k.fotos, []);
    wisDomeinCache();
    const d = await req('a', 'POST', `/api/projecten/${p.id}/keuzes/domein`, { domein: 'https://www.Denekamperstraat23B.nl/', controleer: true });
    assert.equal(d.statusCode, 200, d.body);
    assert.equal(d.json().domein, 'denekamperstraat23b.nl');
    assert.equal(d.json().uitkomst.status, 'beschikbaar');
    assert.equal(d.json().gereserveerd, false);
    assert.equal((await req('a', 'POST', `/api/projecten/${p.id}/keuzes/domein`, { domein: 'markt27.com' })).statusCode, 400);
    const na = (await req('a', 'GET', `/api/projecten/${p.id}/keuzes`)).json();
    assert.equal(na.domein.wens.domein, 'denekamperstraat23b.nl');
    assert.equal(na.domein.wens.uitkomst.status, 'beschikbaar');
    assert.equal(na.domein.definitief, null, 'het definitieve domein blijft ongemoeid');
    // Zon/schaduw
    assert.equal((await req('a', 'PUT', `/api/projecten/${p.id}/keuzes/zonschaduw`, { gewenst: true })).statusCode, 400, 'ja zonder foto');
    const pb = (await req('b', 'POST', '/api/projecten', { kantoor_id: B, naam: 'Keuzes B', profiel: 'buitenplaats' })).json();
    const fotoB = (await pool.query(`INSERT INTO bestand (project_id, kantoor_id, soort, herkomst, originele_naam, mime, grootte, sha256, opslag)
      VALUES ($1, $2, 'foto', 'upload', 'b.jpg', 'image/jpeg', 1, repeat('b', 64), 'x/b') RETURNING id`, [pb.id, B])).rows[0].id;
    assert.equal((await req('a', 'PUT', `/api/projecten/${p.id}/keuzes/zonschaduw`, { gewenst: true, bestand_id: fotoB })).statusCode, 400, 'foto van een ander project');
    assert.equal((await req('a', 'PUT', `/api/projecten/${p.id}/keuzes/zonschaduw`, { gewenst: false })).statusCode, 200);
    assert.equal((await req('a', 'GET', `/api/projecten/${p.id}/keuzes`)).json().zonschaduw.gewenst, false);
    // Organisatiescheiding
    assert.equal((await req('b', 'GET', `/api/projecten/${p.id}/keuzes`)).statusCode, 404);
    assert.notEqual((await req('b', 'POST', `/api/projecten/${p.id}/keuzes/domein`, { domein: 'kaper.nl' })).statusCode, 200);
    assert.notEqual((await req('b', 'PUT', `/api/projecten/${p.id}/keuzes/zonschaduw`, { gewenst: false })).statusCode, 200);
    // Zichtbaar in het bestaande besluitenlog (uitgebreid beheer)
    const log = (await req('a', 'GET', `/api/projecten/${p.id}/beoordeling`)).json().besluiten.map((x: { onderwerp: string; handeling: string }) => `${x.onderwerp}:${x.handeling}`);
    assert.ok(log.includes('domeinwens:gecontroleerd: beschikbaar') && log.includes('zonschaduw:niet gewenst'), log.join(','));
  } finally { config.rdapNl = vorig; nep.close(); }
});
