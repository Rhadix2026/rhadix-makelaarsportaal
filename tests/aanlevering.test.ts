// Stap 4: aanlevering (brochure, losse foto's), brochure-import via de bestaande generator,
// de drie gegevenslagen, bescherming van handmatige en goedgekeurde gegevens, dubbele foto's,
// het opslaan zonder te genereren, de kantoorhuisstijl en de gegevensscheiding.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { bouwApp } from '../api/src/server.ts';
import { alsGebruiker, migreer, pool } from '../api/src/db.ts';
import { wekVerwerker } from '../api/src/aanlevering.ts';
import { config } from '../api/src/config.ts';
import { sharp } from '../api/src/generator.ts';
import { woningtypeUit } from '../api/src/gegevens.ts';
import { login, maakGebruiker, maakKantoorDirect } from './hulp.ts';

const app = bouwApp();
let A = '', B = '';
const c: Record<string, string> = {};
// Markt 27 Wolvega (Linde Makelaars): de vaste praktijkbrochure. Lokaal, niet in git.
const BROCHURE = join(homedir(), 'Backups', 'ai-storytelling-nulmeting-2026-11-05', 'brochures', 'markt-27-wolvega-brochure.pdf');
const heeftBrochure = existsSync(BROCHURE);

before(async () => {
  await migreer();
  A = await maakKantoorDirect('Linde Makelaars', 'linde-makelaars');
  B = await maakKantoorDirect('Kantoor B', 'kantoor-b');
  await pool.query("UPDATE kantoor SET standaard_profiel = 'stads' WHERE id = $1", [A]);
  await maakGebruiker('beheer@studio.test', { platform: true });
  await maakGebruiker('a@studio.test', { kantoren: [[A, 'makelaar']] });
  await maakGebruiker('b@studio.test', { kantoren: [[B, 'makelaar']] });
  for (const e of ['beheer', 'a', 'b']) c[e] = await login(app, `${e}@studio.test`);
});
after(() => app.close());

const req = (wie: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: c[wie] }, payload });
const upload = (wie: string, url: string, body: Buffer, naam: string, type = 'application/octet-stream') =>
  app.inject({ method: 'POST', url, headers: { cookie: c[wie], 'content-type': type, 'x-bestandsnaam': encodeURIComponent(naam) }, payload: body });
const project = async (data: object) => {
  const r = await req('beheer', 'POST', '/api/projecten', { kantoor_id: A, ...data });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const aanlevering = async (id: string, wie = 'beheer') => (await req(wie, 'GET', `/api/projecten/${id}/aanlevering`)).json();
// Synthetische testbeelden: een kleurverloop met een vlak, in twee formaten (zelfde beeld).
const beeld = (b: number, h: number, kleur = { r: 200, g: 60, b: 40 }) => sharp({ create: { width: b, height: h, channels: 3, background: kleur } } as never)
  .composite([{ input: Buffer.from(`<svg width="${b}" height="${h}"><rect x="${b * 0.1}" y="${h * 0.2}" width="${b * 0.5}" height="${h * 0.3}" fill="#1A2847"/><circle cx="${b * 0.8}" cy="${h * 0.7}" r="${h * 0.15}" fill="#F0E68C"/></svg>`) }])
  .jpeg({ quality: 90 }).toBuffer() as Promise<Buffer>;

test('projecten: alleen kantoor en naam verplicht; "Nog niet gekozen" blijft mogelijk naast een kantoorstandaard', async () => {
  const p = await project({ naam: 'Alleen een naam' });
  assert.equal(p.adres, null); assert.equal(p.profiel, 'stads', 'zonder keuze geldt de standaard van het kantoor');
  const n = await project({ naam: 'Bewust zonder profiel', profiel: '' });
  assert.equal(n.profiel, null, 'expliciet "Nog niet gekozen" wordt niet vervangen door de kantoorstandaard');
});

test('upload: type uit de inhoud, lege en verkeerde bestanden geweigerd, zelfde foto niet dubbel, makelaar mag niet', async () => {
  const p = await project({ naam: 'Uploadwoning' });
  const url = `/api/projecten/${p.id}/bestanden`;
  assert.equal((await upload('beheer', `${url}?soort=brochure`, Buffer.from('geen pdf'), 'x.pdf', 'application/pdf')).statusCode, 415);
  assert.equal((await upload('beheer', `${url}?soort=foto`, Buffer.from('%PDF-1.4 x'), 'foto.jpg', 'image/jpeg')).statusCode, 415);
  assert.equal((await upload('beheer', `${url}?soort=iets`, Buffer.from('x'), 'x')).statusCode, 400);
  const f = await beeld(1600, 1000);
  const r1 = await upload('beheer', `${url}?soort=foto`, f, 'woonkamer.jpg', 'image/jpeg');
  assert.equal(r1.statusCode, 201, r1.body);
  const b = r1.json().bestand;
  assert.equal(b.breedte, 1600); assert.equal(b.herkomst, 'upload'); assert.equal(b.originele_naam, 'woonkamer.jpg');
  // Origineel byte-voor-byte bewaard (originele kwaliteit).
  const pad = (await pool.query('SELECT opslag FROM bestand WHERE id = $1', [b.id])).rows[0].opslag;
  assert.ok(readFileSync(join(config.opslag, pad)).equals(f));
  const r2 = await upload('beheer', `${url}?soort=foto`, f, 'kopie.jpg', 'image/jpeg');
  assert.equal(r2.statusCode, 200); assert.equal(r2.json().al_aanwezig, true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM bestand WHERE project_id = $1', [p.id])).rows[0].n, 1);
  // Uploaden mag het eigen kantoor (migratie 010); een makelaar van een ander kantoor ziet het project niet.
  assert.equal((await upload('b', `${url}?soort=foto`, await beeld(900, 600), 'x.jpg', 'image/jpeg')).statusCode, 404);
  // Bestand tonen: eigen kantoor wel, ander kantoor niet; nooit als uitvoerbare pagina.
  const t = await req('a', 'GET', `/api/bestanden/${b.id}`);
  assert.equal(t.statusCode, 200); assert.match(String(t.headers['content-security-policy']), /sandbox/);
  assert.equal(t.headers['x-content-type-options'], 'nosniff');
  assert.equal((await req('b', 'GET', `/api/bestanden/${b.id}`)).statusCode, 404);
  assert.equal((await req('a', 'GET', `/api/bestanden/${b.id}/miniatuur`)).headers['content-type'], 'image/webp');
});

test('dubbele foto\'s: hetzelfde beeld in lagere kwaliteit wordt niet gebruikt; intrekken herstelt', async () => {
  const p = await project({ naam: 'Dubbelwoning' });
  const url = `/api/projecten/${p.id}/bestanden?soort=foto`;
  const groot = (await upload('beheer', url, await beeld(2400, 1600), 'groot.jpg')).json().bestand;
  const klein = (await upload('beheer', url, await beeld(800, 533), 'klein.jpg')).json().bestand;
  const anderBeeld = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: { r: 240, g: 240, b: 240 } } } as never)
    .composite([{ input: Buffer.from('<svg width="1600" height="1000"><rect x="900" y="50" width="600" height="900" fill="#111"/><rect x="50" y="600" width="700" height="300" fill="#777"/></svg>') }])
    .jpeg().toBuffer() as Buffer;
  const ander = (await upload('beheer', url, anderBeeld, 'ander.jpg')).json().bestand;
  let o = await aanlevering(p.id);
  const vind = (id: string) => o.bestanden.find((x: { id: string }) => x.id === id);
  assert.equal(vind(klein.id).dubbel_van, groot.id);
  assert.match(vind(klein.id).dubbel_reden, /groot\.jpg.*2400×1600/);
  assert.equal(vind(groot.id).dubbel_van, null);
  assert.equal(vind(ander.id).dubbel_van, null, 'een ander beeld is geen dubbel');
  assert.equal((await req('beheer', 'DELETE', `/api/bestanden/${groot.id}`)).statusCode, 200);
  o = await aanlevering(p.id);
  assert.equal(vind(klein.id).dubbel_van, null, 'na intrekken van het grote beeld wordt het kleine weer gebruikt');
  assert.equal(vind(groot.id).vervallen, true);
});

test('woningtype uit de brochureomschrijving', () => {
  assert.equal(woningtypeUit('Maisonnette'), 'maisonnette');
  assert.equal(woningtypeUit('Bovenwoning'), 'appartement');
  assert.equal(woningtypeUit('Vrijstaande woning'), 'vrijstaand');
  assert.equal(woningtypeUit('Woonhuis'), null);
});

test('brochure-import Markt 27: zelfde resultaat als de generator, gegevens aangevuld, handmatig beschermd, geen website', { skip: !heeftBrochure && 'Markt 27-brochure niet lokaal aanwezig' }, async () => {
  // Handmatig ingevoerd vóór de import: adres (afwijkend) en contactpersoon.
  const p = await project({ naam: 'Markt 27', adres: 'Markt 27a', contactpersoon: 'Contact Linde' });
  const pdf = readFileSync(BROCHURE);
  assert.equal((await req('beheer', 'POST', `/api/projecten/${p.id}/verwerkingen`, { soort: 'brochure-import' })).statusCode, 409, 'zonder brochure geen import');
  const u = await upload('beheer', `/api/projecten/${p.id}/bestanden?soort=brochure`, pdf, 'Markt 27 Wolvega.pdf', 'application/pdf');
  assert.equal(u.statusCode, 201, u.body);
  const v = await req('beheer', 'POST', `/api/projecten/${p.id}/verwerkingen`, { soort: 'brochure-import' });
  assert.equal(v.statusCode, 202, v.body);
  assert.equal((await req('beheer', 'POST', `/api/projecten/${p.id}/verwerkingen`, { soort: 'brochure-import' })).statusCode, 409, 'één verwerking tegelijk per project');
  await wekVerwerker();
  const o = await aanlevering(p.id);
  const imp = (await pool.query("SELECT * FROM verwerking WHERE project_id = $1", [p.id])).rows[0];
  assert.equal(imp.status, 'klaar', imp.fout);
  assert.ok(imp.duur_ms > 0); assert.ok(imp.stappen.import > 0);

  // Vergelijking veld voor veld met de generator zelf (zelfde PDF, zelfde functie, aparte map).
  const { importeer } = await import(pathToFileURL(join(config.generator, 'packages/import/index.mjs')).href);
  const refMap = join(config.opslag, 'referentie-import');
  mkdirSync(refMap, { recursive: true });
  const ref = await importeer(BROCHURE, { uit: refMap });
  assert.deepEqual(imp.rapport.feiten, ref.feiten);
  assert.deepEqual(imp.rapport.hoofdstukken, ref.hoofdstukken);
  assert.deepEqual(imp.rapport.telling, ref.telling);
  assert.deepEqual(imp.rapport.conflicten, ref.conflicten);
  assert.equal(imp.rapport.beelden.length, ref.beelden.length);
  // De vraagprijs wordt nooit bewaard (historisch, niet publiceren).
  assert.ok(ref.gegevens.vraagprijs, 'de brochure bevat een vraagprijs');
  assert.equal(imp.rapport.gegevens.vraagprijs, undefined);
  assert.ok(imp.rapport.vraagprijs_gevonden);
  assert.doesNotMatch(JSON.stringify(imp.rapport), new RegExp(String(ref.gegevens.vraagprijs.waarde).replace(/[€.\s]/g, '.?')));

  // Beelden uit de brochure: originele bytes, met pagina; aanleveringscontrole van de generator uitgevoerd.
  const fotos = o.bestanden.filter((b: { soort: string; herkomst: string }) => b.soort === 'foto' && b.herkomst === 'brochure');
  assert.equal(fotos.length, ref.beelden.filter((b: { soort: string }) => b.soort === 'foto').length);
  assert.ok(fotos.every((f: { pagina: number }) => f.pagina > 0));
  assert.ok(o.import.controle && Array.isArray(o.import.controle.fouten));
  assert.ok(o.brochure_logo, 'logo van de makelaar gevonden');

  // Drie lagen: extractie, vastgelegd (aangevuld of beschermd).
  const g = (s: string) => o.gegevens.find((x: { sleutel: string }) => x.sleutel === s);
  assert.equal(g('adres').vastgelegd.waarde, 'Markt 27a', 'handmatig adres niet overschreven');
  assert.equal(g('adres').vastgelegd.herkomst, 'handmatig');
  assert.equal(g('adres').extractie.waarde, 'Markt 27');
  assert.equal(g('adres').afwijking, true);
  assert.equal(g('postcode').vastgelegd.waarde, '8471 AS'); assert.equal(g('postcode').vastgelegd.status, 'overgenomen');
  assert.equal(g('plaats').vastgelegd.waarde, 'Wolvega');
  assert.equal(g('woningtype').vastgelegd.waarde, 'maisonnette');
  assert.match(g('feit.woonoppervlakte').vastgelegd.bron, /brochure p\. \d/);
  assert.equal(g('feit.kamers').conflict.ernst, 'conflict');
  assert.deepEqual(g('feit.kamers').signalen, ['tegenstrijdigheid', 'onzeker']);
  assert.ok(g('feit.tuin').signalen.includes('terminologie'), "balkon/dakterras ↔ zonneterras = terminologische afwijking");
  assert.ok(g('adres').signalen.includes('afwijking'));

  // Meldingen in drie niveaus.
  const niveau = (t: RegExp) => o.meldingen.find((m: { titel: string }) => t.test(m.titel))?.niveau;
  // Fase-afhankelijk: een inhoudelijke tegenstrijdigheid blokkeert het interne concept niet, wel de publicatie.
  assert.equal(niveau(/^Inhoudelijke tegenstrijdigheid: Kamers/), 'aandacht');
  assert.equal(o.meldingen.find((m: { titel: string }) => /^Inhoudelijke tegenstrijdigheid: Kamers/.test(m.titel)).actie, 'publicatie');
  assert.match(o.meldingen.find((m: { titel: string }) => /^Inhoudelijke tegenstrijdigheid: Kamers/.test(m.titel)).tekst, /Het concept gebruikt '\d+' als onbevestigd/);
  assert.equal(o.meldingen.find((m: { titel: string }) => /^Publicatierechten/.test(m.titel)).actie, 'conceptgeneratie');
  assert.equal(niveau(/^Mogelijke terminologische afwijking: Buitenruimte/), 'aandacht');
  assert.equal(niveau(/^Afwijking van de brochure: Straat/), 'aandacht');
  assert.equal(niveau(/^Publicatierechten/), 'blokkerend');
  assert.equal(niveau(/^Vraagprijs gevonden/), 'info');
  assert.equal(niveau(/onder de publicatienorm/), 'aandacht');
  assert.ok(o.meldingen.every((m: { niveau: string }) => ['blokkerend', 'aandacht', 'info'].includes(m.niveau)));

  // Fotokwaliteit volgens de norm van de generator (EIS: 1200 px).
  assert.equal(o.fotokwaliteit.norm.goed, 1200);
  assert.equal(o.fotokwaliteit.in_gebruik, 34);
  assert.equal(o.fotokwaliteit.geschikt + o.fotokwaliteit.onvoldoende, 34);
  assert.equal(o.fotokwaliteit.originelen_nodig, o.fotokwaliteit.onvoldoende, 'zonder losse foto\'s zijn alle te kleine beelden brochurebeelden');
  assert.ok(o.fotokwaliteit.onvoldoende >= 33);

  // Bulkgoedkeuring: alleen gegevens zonder signaal; tegenstrijdig, terminologie, onzeker en afwijking blijven open.
  const bulk = await req('beheer', 'POST', `/api/projecten/${p.id}/gegevens/bulkgoedkeuring`);
  assert.equal(bulk.statusCode, 200, bulk.body);
  const uit = bulk.json().uitgesloten.map((x: { sleutel: string }) => x.sleutel);
  for (const s of ['feit.kamers', 'feit.tuin', 'woningtype']) assert.ok(uit.includes(s), `${s} uitgesloten van bulk`);
  assert.ok(bulk.json().goedgekeurd > 10);
  const na = await aanlevering(p.id);
  const gn = (s: string) => na.gegevens.find((x: { sleutel: string }) => x.sleutel === s);
  assert.equal(gn('feit.kamers').vastgelegd.status, 'overgenomen');
  assert.equal(gn('feit.tuin').vastgelegd.status, 'overgenomen');
  assert.equal(gn('feit.bouwjaar').vastgelegd.status, 'goedgekeurd');
  assert.equal(gn('adres').vastgelegd.waarde, 'Markt 27a', 'bulk raakt handmatige waarden niet');
  assert.equal((await req('b', 'POST', `/api/projecten/${p.id}/gegevens/bulkgoedkeuring`)).statusCode, 404, 'ander kantoor');
  const pr = (await req('beheer', 'GET', `/api/projecten/${p.id}`)).json();
  assert.equal(pr.postcode, '8471 AS', 'het project volgt het aangevulde gegeven');
  assert.equal(pr.adres, 'Markt 27a');
  assert.equal(pr.contactpersoon, 'Contact Linde');

  // Brochurewaarde over een handmatige waarde: alleen met bevestiging.
  const url = (s: string) => `/api/projecten/${p.id}/gegevens/${s}`;
  assert.equal((await req('beheer', 'PUT', url('adres'), { actie: 'brochure' })).statusCode, 409);
  const ov = await req('beheer', 'PUT', url('adres'), { actie: 'brochure', bevestigd: true });
  assert.equal(ov.statusCode, 200, ov.body); assert.equal(ov.json().waarde, 'Markt 27'); assert.equal(ov.json().status, 'goedgekeurd');
  // Correctie en goedkeuring; makelaar mag niets wijzigen.
  // Tegenstrijdigheid: nooit zonder expliciet, gemotiveerd besluit.
  assert.equal((await req('beheer', 'PUT', url('feit.kamers'), { actie: 'goedkeuren' })).statusCode, 409);
  assert.equal((await req('beheer', 'PUT', url('feit.kamers'), { actie: 'corrigeren', waarde: '3' })).statusCode, 409);
  assert.equal((await req('beheer', 'PUT', url('feit.kamers'), { actie: 'corrigeren', waarde: '3', bevestigd: true })).statusCode, 409, 'motivering verplicht');
  assert.equal((await req('beheer', 'PUT', url('feit.tuin'), { actie: 'goedkeuren', motivering: 'zelfde' })).statusCode, 409, 'bevestiging verplicht');
  const k = await req('beheer', 'PUT', url('feit.kamers'), { actie: 'corrigeren', waarde: '3', bevestigd: true, motivering: 'Makelaar bevestigt 3 kamers' });
  assert.equal(k.statusCode, 200, k.body); assert.equal(k.json().herkomst, 'handmatig');
  assert.equal(k.json().besluit.soort, 'tegenstrijdigheid'); assert.equal(k.json().besluit.motivering, 'Makelaar bevestigt 3 kamers');
  const t = await req('beheer', 'PUT', url('feit.tuin'), { actie: 'goedkeuren', bevestigd: true, motivering: 'Zonneterras is het balkon op het dak' });
  assert.equal(t.json().besluit.soort, 'terminologie'); assert.equal(t.json().waarde, 'Zonneterras');
  const ob = await aanlevering(p.id);
  assert.ok(!ob.meldingen.some((m: { niveau: string; titel: string }) => m.niveau === 'blokkerend' && /tegenstrijdigheid/.test(m.titel)));
  assert.ok(ob.meldingen.some((m: { niveau: string; titel: string }) => m.niveau === 'info' && /^Besloten: Kamers = 3/.test(m.titel)));
  assert.equal((await req('beheer', 'PUT', url('feit.inhoud'), { actie: 'corrigeren', waarde: 'veel' })).statusCode, 400);
  assert.equal((await req('beheer', 'PUT', url('postcode'), { actie: 'goedkeuren' })).json().status, 'goedgekeurd');
  assert.equal((await req('b', 'PUT', url('postcode'), { actie: 'corrigeren', waarde: '1234 AB' })).statusCode, 404, 'ander kantoor');

  // Tweede import: goedgekeurde en gecorrigeerde gegevens blijven staan.
  await upload('beheer', `/api/projecten/${p.id}/bestanden?soort=foto`, await beeld(2000, 1300), 'losse-foto.jpg', 'image/jpeg');
  assert.equal((await req('beheer', 'POST', `/api/projecten/${p.id}/verwerkingen`, { soort: 'brochure-import' })).statusCode, 202);
  await wekVerwerker();
  const o2 = await aanlevering(p.id);
  const g2 = (s: string) => o2.gegevens.find((x: { sleutel: string }) => x.sleutel === s);
  assert.equal(g2('feit.kamers').vastgelegd.waarde, '3');
  assert.equal(g2('postcode').vastgelegd.status, 'goedgekeurd');
  assert.equal(o2.bestanden.filter((b: { herkomst: string; vervallen: boolean; soort: string }) => b.herkomst === 'brochure' && !b.vervallen && b.soort === 'foto').length, fotos.length,
    'beelden van de eerste import vervallen, niet verdubbeld');
  assert.equal(o2.import.volgnummer, 2);

  // Makelaar ziet het eigen project (alleen lezen), ander kantoor niets.
  assert.equal((await req('a', 'GET', `/api/projecten/${p.id}/aanlevering`)).statusCode, 200);
  assert.equal((await req('b', 'GET', `/api/projecten/${p.id}/aanlevering`)).statusCode, 404);
  const bId = await alsGebruiker((await pool.query("SELECT id FROM gebruiker WHERE email = 'b@studio.test'")).rows[0].id, async (cl) =>
    (await cl.query('SELECT count(*)::int AS n FROM bestand WHERE project_id = $1', [p.id])).rows[0].n
    + (await cl.query('SELECT count(*)::int AS n FROM gegeven WHERE project_id = $1', [p.id])).rows[0].n
    + (await cl.query('SELECT count(*)::int AS n FROM verwerking WHERE project_id = $1', [p.id])).rows[0].n);
  assert.equal(bId, 0, 'RLS: ander kantoor ziet geen bestanden, gegevens of verwerkingen');

  // Opslaan zonder te genereren: momentopname, status ongewijzigd, niets in de generator.
  const s = await req('beheer', 'POST', `/api/projecten/${p.id}/aanleveringen`);
  assert.equal(s.statusCode, 201, s.body); assert.equal(s.json().versie, 1);
  assert.equal(s.json().samenvatting.losse_fotos, 1);
  assert.equal((await req('beheer', 'GET', `/api/projecten/${p.id}`)).json().status, 'aanlevering_incompleet');
  assert.equal(execFileSync('git', ['-C', config.generator, 'status', '--porcelain'], { encoding: 'utf8' }), '');
  assert.ok(!readdirSync(join(config.generator, 'woningen')).some((w) => w.includes('markt-27') && w !== 'markt-27-wolvega'));
  // Kantoor ligt vast na de start van de aanlevering.
  assert.equal((await req('beheer', 'PUT', `/api/projecten/${p.id}`, { ...pr, kantoor_id: B })).statusCode, 409);

  // Logo uit de brochure als kantoorlogo: vult lege kantoorkleuren aan.
  const l = await req('beheer', 'POST', `/api/kantoren/${A}/logo/brochure`, { bestand_id: o2.brochure_logo.id });
  assert.equal(l.statusCode, 200, l.body);
  assert.equal(l.json().logo.herkomst, 'brochure');
  assert.equal(l.json().herkomst, 'logo');
  assert.match(l.json().merkkleur, /^#[0-9A-F]{6}$/);
});

test('huisstijl: logo vult lege kleuren, overschrijft ingestelde kleuren pas na bevestiging; contrast per profiel', async () => {
  const logo = await sharp({ create: { width: 400, height: 160, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } } as never)
    .composite([{ input: Buffer.from('<svg width="400" height="160"><rect x="0" y="0" width="260" height="160" fill="#E8B000"/><rect x="270" y="0" width="130" height="160" fill="#0B6E4F"/></svg>') }])
    .png().toBuffer() as Buffer;
  const K = await maakKantoorDirect('Kleurkantoor', 'kleurkantoor');
  const r = await upload('beheer', `/api/kantoren/${K}/logo`, logo, 'logo.png', 'image/png');
  assert.equal(r.statusCode, 200, r.body);
  const h = r.json();
  assert.equal(h.herkomst, 'logo'); assert.ok(h.merkkleur && h.detailkleur && h.merkkleur !== h.detailkleur);
  assert.ok(h.toepassing.length >= 3);
  for (const t of h.toepassing) { assert.ok(t.licht.contrast >= 4.5, `${t.profiel} licht ${t.licht.contrast}`); assert.ok(t.donker.contrast >= 4.5); }
  // Handmatige kleur, daarna een nieuw logo: voorstel wijkt af, kleur blijft.
  const k = (await req('beheer', 'GET', `/api/kantoren/${K}`)).json();
  assert.equal((await req('beheer', 'PUT', `/api/kantoren/${K}`, { ...k, merkkleur: '#123456' })).statusCode, 200);
  const r2 = await upload('beheer', `/api/kantoren/${K}/logo`, await beeld(600, 200), 'ander-logo.jpg', 'image/jpeg');
  assert.equal(r2.json().merkkleur, '#123456'); assert.equal(r2.json().herkomst, 'handmatig'); assert.equal(r2.json().voorstel_wijkt_af, true);
  const b = await req('beheer', 'POST', `/api/kantoren/${K}/huisstijl/voorstel`);
  assert.equal(b.json().merkkleur, r2.json().voorstel.merk); assert.equal(b.json().herkomst, 'logo');
  assert.equal((await upload('a', `/api/kantoren/${A}/logo`, logo, 'logo.png', 'image/png')).statusCode, 403);
  assert.equal((await upload('beheer', `/api/kantoren/${K}/logo`, Buffer.from('<html><script>x</script></html>'), 'x.svg', 'image/svg+xml')).statusCode, 415);
  assert.equal((await req('b', 'GET', `/api/kantoren/${K}/huisstijl`)).statusCode, 404);
});

test('bestandsnamen: kort en herkenbaar op het scherm, technische namen vervangen', async () => {
  const { kortNaam } = await import('../web/src/onderdelen/bestandsnaam.ts');
  assert.equal(kortNaam('Markt 27 Wolvega.pdf', 'Brochure'), 'Markt 27 Wolvega.pdf');
  assert.equal(kortNaam('TW92ZURvY3VtZW50OjEyODkzMjMxfDkzNTU4Mnw0OTU5Nzc1MXxhZGJhYWViZmM2MjlkMTVh.pdf', 'Brochure'), 'Brochure.pdf');
  assert.equal(kortNaam('groot-1c8f8c14-990d-46dc-a2c2-84be351292d9.jpg', 'Foto'), 'Foto.jpg');
  assert.equal(kortNaam('IMG_20261105_154233_HDR_woonkamer_achterzijde_tuin.JPG', 'Foto').length <= 34, true);
  assert.match(kortNaam('Verkoopbrochure Markt 27 Wolvega definitief versie 3 november.pdf', 'Brochure'), /^Verkoopbrochure.*….*\.pdf$/);
  // De volledige naam blijft intern bewaard.
  const p = (await pool.query("SELECT id FROM project LIMIT 1")).rows[0];
  const naam = 'TW92ZURvY3VtZW50OjEyODkzMjMxfDkzNTU4Mnw0OTU5Nzc1MXxhZGJhYWViZmM2MjlkMTVh.jpg';
  const r = await upload('beheer', `/api/projecten/${p.id}/bestanden?soort=foto`, await beeld(1300, 900, { r: 9, g: 99, b: 199 }), naam, 'image/jpeg');
  assert.equal(r.json().bestand.originele_naam, naam);
});
