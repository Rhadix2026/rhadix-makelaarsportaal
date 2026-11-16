// Voortgangsindicatie van verwerkingen: berekening op echte procesgegevens, afgeknepen wegschrijven,
// het protocol met het kindproces, begrijpelijke foutmeldingen en de autorisatie van het
// statusverzoek (eigen kantoor, ander kantoor, platformbeheer; herladen; meerdere gebruikers).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bouwApp } from '../api/src/server.ts';
import { migreer, pool } from '../api/src/db.ts';
import { draaiKind, wekVerwerker } from '../api/src/aanlevering.ts';
import { config } from '../api/src/config.ts';
import { sharp } from '../api/src/generator.ts';
import { FASEN, foutMelding, leesRegel, schrijver, Volger, voortgangRegel, type Gebeurtenis, type Voortgang } from '../api/src/voortgang.ts';
import { login, maakGebruiker, maakKantoorDirect } from './hulp.ts';

const app = bouwApp();
let A = '', B = '';
const c: Record<string, string> = {};

before(async () => {
  await migreer();
  A = await maakKantoorDirect('Voortgang A', 'voortgang-a');
  B = await maakKantoorDirect('Voortgang B', 'voortgang-b');
  await maakGebruiker('vg-beheer@studio.test', { platform: true });
  await maakGebruiker('vg-a1@studio.test', { kantoren: [[A, 'makelaar']] });
  await maakGebruiker('vg-a2@studio.test', { kantoren: [[A, 'kantoorbeheerder']] });
  await maakGebruiker('vg-b@studio.test', { kantoren: [[B, 'makelaar']] });
  for (const e of ['vg-beheer', 'vg-a1', 'vg-a2', 'vg-b']) c[e] = await login(app, `${e}@studio.test`);
});
after(() => app.close());

const req = (wie: string, method: 'GET' | 'POST', url: string, payload?: object) => app.inject({ method, url, headers: { cookie: c[wie] }, payload });
const project = async (naam: string) => {
  const r = await req('vg-beheer', 'POST', '/api/projecten', { kantoor_id: A, naam });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().id as string;
};

// ── Berekening ────────────────────────────────────────────────────────────
test('brochure-import: fasen in volgorde, geen percentage zolang het aantal foto\'s onbekend is, daarna oplopend tot hoogstens 99', () => {
  const v = new Volger('brochure-import', true);
  const standen: Voortgang[] = [];
  const doe = (g: Gebeurtenis) => { v.verwerk(g); standen.push(v.stand()); };
  for (const stap of ['pdf_lezen', 'structuur', 'gegevens', 'teksten', 'beelden', 'controle', 'schrijven']) { doe({ soort: 'import', stap, status: 'start' }); doe({ soort: 'import', stap, status: 'klaar' }); }
  assert.ok(standen.every((s) => s.percentage === null), 'tijdens de import is het totaal nog niet bekend');
  assert.equal(standen[0].fase, 'inlezen'); assert.equal(standen.at(-1)!.fase, 'extractie');
  doe({ soort: 'controle', status: 'start' }); doe({ soort: 'controle', status: 'klaar' });
  doe({ soort: 'kenmerken', klaar: 0, totaal: 120, fotos: 115 });
  for (let i = 1; i <= 120; i++) doe({ soort: 'kenmerken', klaar: i, totaal: 120 });
  doe({ soort: 'classificatie', fase: 'laden', klaar: 0, totaal: 115 });
  doe({ soort: 'classificatie', fase: 'model_geladen', klaar: 0, totaal: 115 });
  for (let i = 8; i < 115; i += 8) doe({ soort: 'classificatie', fase: 'beelden', klaar: i, totaal: 115 });
  doe({ soort: 'classificatie', fase: 'beelden', klaar: 115, totaal: 115 });
  doe({ soort: 'fase', fase: 'verwerken' });
  doe({ soort: 'fase', fase: 'afronden' });
  const p = standen.map((s) => s.percentage).filter((x): x is number => x !== null);
  assert.ok(p.length > 100);
  for (let i = 1; i < p.length; i++) assert.ok(p[i] >= p[i - 1], `percentage daalt niet (${p[i - 1]} → ${p[i]})`);
  assert.ok(p.at(-1)! <= 99, 'nooit 100 % tijdens de verwerking');
  const halverwege = standen.find((s) => s.klaar === 56 && s.eenheid === "foto's")!;
  assert.equal(halverwege.fase, 'classificatie'); assert.equal(halverwege.totaal, 115);
  assert.ok(halverwege.percentage! > 40 && halverwege.percentage! < 60, `bij 56 van 115 foto's ±de helft (${halverwege.percentage})`);
  assert.deepEqual([...new Set(standen.map((s) => s.fase_nr))], [1, 2, 3, 4, 5]);
  assert.equal(standen[0].fasen, FASEN.length);
});

test('zonder classificatie (of zonder foto\'s) telt die fase niet mee', () => {
  const v = new Volger('brochure-import', false);
  for (const stap of ['pdf_lezen', 'structuur', 'gegevens', 'teksten', 'beelden', 'controle', 'schrijven']) v.verwerk({ soort: 'import', stap, status: 'klaar' });
  v.verwerk({ soort: 'controle', status: 'klaar' });
  v.verwerk({ soort: 'kenmerken', klaar: 0, totaal: 10, fotos: 0 });
  v.verwerk({ soort: 'kenmerken', klaar: 10, totaal: 10 });
  v.verwerk({ soort: 'fase', fase: 'verwerken' });
  assert.ok(v.stand().percentage! >= 80, `vrijwel klaar zonder classificatie (${v.stand().percentage})`);
});

test('foto-indeling: aantal vooraf bekend, dus direct een percentage', () => {
  const v = new Volger('foto-indeling', true, 20);
  assert.equal(v.stand().fase, 'classificatie'); assert.equal(v.stand().percentage, 0);
  v.verwerk({ soort: 'classificatie', fase: 'model_geladen', klaar: 0, totaal: 20 });
  v.verwerk({ soort: 'classificatie', fase: 'beelden', klaar: 16, totaal: 20 });
  assert.equal(v.stand().klaar, 16); assert.ok(v.stand().percentage! > 60);
});

// ── Afgeknepen wegschrijven ───────────────────────────────────────────────
test('schrijver: nieuwe fase of stap meteen, binnen een stap hoogstens één keer per interval, laatste stand niet kwijt', async () => {
  const geschreven: Voortgang[] = [];
  const s = schrijver(new Volger('foto-indeling', true, 200), async (x) => { geschreven.push(x); }, { minMs: 200, hartslagMs: 60_000 });
  s.gebeurtenis({ soort: 'classificatie', fase: 'laden', klaar: 0, totaal: 200 });
  s.gebeurtenis({ soort: 'classificatie', fase: 'model_geladen', klaar: 0, totaal: 200 });
  for (let i = 8; i <= 200; i += 8) s.gebeurtenis({ soort: 'classificatie', fase: 'beelden', klaar: i, totaal: 200 });
  await new Promise((r) => setTimeout(r, 300));
  await s.stop();
  assert.ok(geschreven.length <= 4, `25 reeksen, maar ${geschreven.length} schrijfacties`);
  assert.equal(geschreven.at(-1)!.klaar, 200, 'de laatste stand wordt alsnog geschreven');
});

test('schrijver: hartslag houdt "bijgewerkt" vers zolang er niets gebeurt; na stop niet meer', async () => {
  let n = 0;
  const s = schrijver(new Volger('foto-indeling', true, 5), async () => { n++; }, { minMs: 10, hartslagMs: 50 });
  await s.nu();
  await new Promise((r) => setTimeout(r, 5200));
  await s.stop();
  const na = n;
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(na >= 2, `hartslag schreef (${na})`); assert.equal(n, na);
});

// ── Kindproces ────────────────────────────────────────────────────────────
test('kindproces: voortgangsregels komen live door en blijven buiten resultaat en foutmelding', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kind-'));
  try {
    const goed = join(dir, 'goed.ts'), fout = join(dir, 'fout.ts');
    const r = (g: Gebeurtenis) => JSON.stringify(voortgangRegel(g));
    writeFileSync(goed, `process.stderr.write(${r({ soort: 'import', stap: 'pdf_lezen', status: 'start' })});
process.stderr.write('een gewone waarschuwing\\n');
process.stderr.write(${r({ soort: 'classificatie', fase: 'beelden', klaar: 8, totaal: 9 })}.slice(0, 20));
process.stderr.write(${r({ soort: 'classificatie', fase: 'beelden', klaar: 8, totaal: 9 })}.slice(20));
process.stdout.write(JSON.stringify({ ok: true }));`);
    writeFileSync(fout, `process.stderr.write(${r({ soort: 'import', stap: 'pdf_lezen', status: 'start' })});
process.stderr.write('Error: PDF kapot\\n'); process.exit(1);`);
    const g: Gebeurtenis[] = [];
    assert.deepEqual(await draaiKind({}, (x) => g.push(x), goed), { ok: true });
    assert.deepEqual(g, [{ soort: 'import', stap: 'pdf_lezen', status: 'start' }, { soort: 'classificatie', fase: 'beelden', klaar: 8, totaal: 9 }], 'ook een over twee stukken verdeelde regel');
    await assert.rejects(draaiKind({}, undefined, fout), (e: Error) => e.message === 'Error: PDF kapot');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('leesRegel: alleen geldige voortgangsregels', () => {
  assert.deepEqual(leesRegel(voortgangRegel({ soort: 'fase', fase: 'verwerken' }).trim()), { soort: 'fase', fase: 'verwerken' });
  assert.equal(leesRegel('Traceback (most recent call last):'), null);
  assert.equal(leesRegel('##voortgang {kapot'), null);
});

test('foutmelding: begrijpelijk en zonder technische details', () => {
  const technisch = 'SigLIP-classificatie mislukt: RuntimeError: /opt/generator/.cache/ai/venv/lib/python3.11/torch: out of memory';
  for (const [f, verwacht] of [
    ['onderbroken: de studio is tijdens de verwerking gestopt', /opnieuw is gestart/],
    [technisch, /analyseren van de foto's/],
    ['Error: Invalid PDF structure at /srv/opslag/projecten/x/brochure.pdf', /brochure kon niet worden gelezen/],
    ['kindproces stopte met code 137', /niet gelukt/],
    [null, /niet gelukt/],
  ] as const) {
    const m = foutMelding(f);
    assert.match(m, verwacht);
    assert.doesNotMatch(m, /\/|Error|code \d|python|torch|SigLIP/i, `geen techniek in "${m}"`);
  }
});

// ── Statusverzoek: autorisatie, herladen, meerdere gebruikers ───────────
test('statusverzoek: eigen kantoor (twee gebruikers) ziet de voortgang, ander kantoor niet; techniek alleen voor platformbeheer', async () => {
  const p = await project('Voortgang autorisatie');
  const g = (await pool.query("SELECT id FROM gebruiker WHERE email = 'vg-beheer@studio.test'")).rows[0].id;
  const stand = new Volger('foto-indeling', true, 40); stand.verwerk({ soort: 'classificatie', fase: 'beelden', klaar: 16, totaal: 40 });
  const v = (await pool.query(`INSERT INTO verwerking (project_id, kantoor_id, soort, volgnummer, status, aangevraagd_door, gestart_op, voortgang)
    VALUES ($1, $2, 'foto-indeling', 1, 'bezig', $3, now(), $4) RETURNING id`, [p, A, g, JSON.stringify(stand.stand())])).rows[0].id;
  const url = `/api/projecten/${p}/verwerkingen/${v}`;
  for (const wie of ['vg-a1', 'vg-a2', 'vg-beheer']) {
    const r = await req(wie, 'GET', url);
    assert.equal(r.statusCode, 200, `${wie}: ${r.body}`);
    assert.equal(r.json().voortgang.klaar, 16); assert.equal(r.headers['cache-control'], 'no-store');
  }
  assert.equal((await req('vg-b', 'GET', url)).statusCode, 404, 'ander kantoor: niet gevonden (RLS)');
  assert.equal((await req('vg-b', 'GET', `/api/projecten/${p}/aanlevering`)).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401, 'niet ingelogd');
  assert.equal((await req('vg-a1', 'GET', `/api/projecten/${p}/verwerkingen/geen-uuid`)).statusCode, 404);
  // Herladen: dezelfde stand, want die staat in de database (de verwerking loopt op de server).
  assert.deepEqual((await req('vg-a1', 'GET', url)).json().voortgang, (await req('vg-a1', 'GET', url)).json().voortgang);

  await pool.query("UPDATE verwerking SET status = 'mislukt', fout = 'SigLIP-classificatie mislukt: Traceback /opt/generator/x.py' WHERE id = $1", [v]);
  const m = (await req('vg-a1', 'GET', url)).json();
  assert.equal(m.fout, null, 'makelaar ziet geen technische fout'); assert.match(m.melding, /analyseren van de foto's/);
  const o = (await req('vg-a1', 'GET', `/api/projecten/${p}/aanlevering`)).json();
  assert.equal(o.verwerkingen[0].fout, null); assert.match(o.verwerkingen[0].melding, /foto's/);
  assert.match((await req('vg-beheer', 'GET', url)).json().fout, /Traceback/, 'platformbeheer ziet de technische fout');
});

// ── Echte verwerking (licht: kleine synthetische brochure, zonder classificatie) ──
const fixture = join(config.generator, 'tests', 'brochure-fixture.mjs');
test('brochure-import: voortgang wordt tijdens de verwerking bijgewerkt en eindigt op 100 % met status klaar', { skip: !existsSync(fixture) }, async () => {
  const p = await project('Voortgang import');
  const dir = mkdtempSync(join(tmpdir(), 'vg-brochure-'));
  try {
    const { maakBrochure } = await import(pathToFileURL(fixture).href);
    await maakBrochure(join(dir, 'b.pdf'));
    const { readFileSync } = await import('node:fs');
    const up = await app.inject({ method: 'POST', url: `/api/projecten/${p}/bestanden?soort=brochure`,
      headers: { cookie: c['vg-beheer'], 'content-type': 'application/octet-stream', 'x-bestandsnaam': 'b.pdf' }, payload: readFileSync(join(dir, 'b.pdf')) });
    assert.ok([200, 201].includes(up.statusCode), up.body);
    const v = (await req('vg-beheer', 'POST', `/api/projecten/${p}/verwerkingen`, { soort: 'brochure-import' })).json().id;
    const gezien = new Set<string>();
    const kijk = setInterval(async () => {
      const r = (await pool.query('SELECT voortgang FROM verwerking WHERE id = $1', [v])).rows[0]?.voortgang;
      if (r) gezien.add(r.fase);
    }, 15);
    await wekVerwerker();
    clearInterval(kijk);
    const eind = (await req('vg-a1', 'GET', `/api/projecten/${p}/verwerkingen/${v}`)).json();
    assert.equal(eind.status, 'klaar', eind.melding ?? '');
    assert.equal(eind.voortgang.percentage, 100); assert.equal(eind.voortgang.fase, 'afronden');
    assert.ok(gezien.has('inlezen') || gezien.has('extractie'), `tussenstanden gezien: ${[...gezien].join(', ')}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Echte classificatie (alleen met lokaal model; 10 synthetische foto's, twee reeksen) ──
const model = existsSync(join(config.generator, '.cache/ai/hf/hub/models--google--siglip-so400m-patch14-384'));
test('foto-indeling met echte classificatie: tellingen per reeks in de voortgang', { skip: !model, timeout: 300_000 }, async () => {
  const p = await project('Voortgang classificatie');
  for (let i = 0; i < 10; i++) {
    // Willekeurige pixels: elke foto anders (anders herkent de studio ze terecht als dubbel).
    const ruw = Buffer.alloc(160 * 120 * 3); for (let j = 0; j < ruw.length; j++) ruw[j] = Math.floor(Math.random() * 256);
    const b = await sharp(ruw, { raw: { width: 160, height: 120, channels: 3 } }).resize(640, 480, { kernel: 'nearest' }).jpeg().toBuffer();
    const r = await app.inject({ method: 'POST', url: `/api/projecten/${p}/bestanden?soort=foto`,
      headers: { cookie: c['vg-beheer'], 'content-type': 'application/octet-stream', 'x-bestandsnaam': `foto-${i}.jpg` }, payload: b });
    assert.ok([200, 201].includes(r.statusCode), r.body);
  }
  const was = config.classificatie;
  config.classificatie = true;
  try {
    const v = (await req('vg-beheer', 'POST', `/api/projecten/${p}/verwerkingen`, { soort: 'foto-indeling' })).json().id;
    const standen: Voortgang[] = [];
    const kijk = setInterval(async () => {
      const r = (await pool.query('SELECT voortgang FROM verwerking WHERE id = $1', [v])).rows[0]?.voortgang;
      if (r && JSON.stringify(r) !== JSON.stringify(standen.at(-1))) standen.push(r);
    }, 50);
    await wekVerwerker();
    clearInterval(kijk);
    const eind = (await pool.query('SELECT status, voortgang, fout FROM verwerking WHERE id = $1', [v])).rows[0];
    assert.equal(eind.status, 'klaar', eind.fout ?? '');
    const cls = standen.filter((s) => s.fase === 'classificatie');
    assert.ok(cls.some((s) => s.stap === 'Beeldherkenning starten'), 'fase: model laden zichtbaar');
    assert.ok(cls.some((s) => s.totaal === 10 && (s.klaar ?? 0) > 0), `tellingen gezien: ${cls.map((s) => `${s.klaar}/${s.totaal}`).join(' ')}`);
    assert.equal(eind.voortgang.percentage, 100);
  } finally { config.classificatie = was; }
});

// ── Herimport en gelijktijdige starts (licht: kleine synthetische brochure, zonder classificatie) ──
test('herimport: zelfde voortgang als de eerste import; handmatige waarde blijft; tweede start tijdens een lopende geweigerd', { skip: !existsSync(fixture) }, async () => {
  const r0 = await req('vg-beheer', 'POST', '/api/projecten', { kantoor_id: A, naam: 'Voortgang herimport', adres: 'Handmatigstraat 9' });
  assert.equal(r0.statusCode, 201, r0.body);
  const p = r0.json().id as string;
  const dir = mkdtempSync(join(tmpdir(), 'vg-herimport-'));
  try {
    const { maakBrochure } = await import(pathToFileURL(fixture).href);
    await maakBrochure(join(dir, 'b.pdf'));
    const { readFileSync } = await import('node:fs');
    const up = await app.inject({ method: 'POST', url: `/api/projecten/${p}/bestanden?soort=brochure`,
      headers: { cookie: c['vg-beheer'], 'content-type': 'application/octet-stream', 'x-bestandsnaam': 'b.pdf' }, payload: readFileSync(join(dir, 'b.pdf')) });
    assert.ok([200, 201].includes(up.statusCode), up.body);
    for (const ronde of [1, 2]) {
      const start = await req('vg-a1', 'POST', `/api/projecten/${p}/verwerkingen`, { soort: 'brochure-import' });
      assert.equal(start.statusCode, 202, `ronde ${ronde}: ${start.body}`);
      const v = start.json().id;
      // Zolang deze in de wachtrij staat: geen tweede import, geen foto-indeling (ook niet door een collega).
      for (const [wie, soort] of [['vg-a1', 'brochure-import'], ['vg-a2', 'brochure-import'], ['vg-a2', 'foto-indeling']] as const) {
        const tweede = await req(wie, 'POST', `/api/projecten/${p}/verwerkingen`, { soort });
        assert.equal(tweede.statusCode, 409, `ronde ${ronde} ${wie} ${soort}`); assert.match(tweede.json().fout, /loopt al een verwerking/);
      }
      const gezien = new Set<string>();
      const kijk = setInterval(async () => { const x = (await pool.query('SELECT voortgang FROM verwerking WHERE id = $1', [v])).rows[0]?.voortgang; if (x) gezien.add(x.fase); }, 15);
      await wekVerwerker();
      clearInterval(kijk);
      const eind = (await req('vg-a1', 'GET', `/api/projecten/${p}/verwerkingen/${v}`)).json();
      assert.equal(eind.status, 'klaar', eind.melding ?? ''); assert.equal(eind.volgnummer, ronde);
      assert.equal(eind.voortgang.percentage, 100, `ronde ${ronde}`);
      assert.ok(gezien.size > 0, `ronde ${ronde}: tussenstanden gezien (${[...gezien].join(', ')})`);
      const adres = (await req('vg-a1', 'GET', `/api/projecten/${p}/aanlevering`)).json().gegevens.find((g: { sleutel: string }) => g.sleutel === 'adres');
      assert.equal(adres.vastgelegd.waarde, 'Handmatigstraat 9', `ronde ${ronde}: handmatige waarde blijft`);
      assert.equal(adres.vastgelegd.herkomst, 'handmatig');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('gelijktijdige starts: precies één wordt aangenomen, de rest krijgt een nette 409 (geen 500)', async () => {
  const p = await project('Voortgang gelijktijdig');
  const ruw = Buffer.alloc(80 * 60 * 3); for (let j = 0; j < ruw.length; j++) ruw[j] = (j * 7919) % 256;
  const foto = await sharp(ruw, { raw: { width: 80, height: 60, channels: 3 } }).resize(320, 240).jpeg().toBuffer();
  const up = await app.inject({ method: 'POST', url: `/api/projecten/${p}/bestanden?soort=foto`,
    headers: { cookie: c['vg-beheer'], 'content-type': 'application/octet-stream', 'x-bestandsnaam': 'f.jpg' }, payload: foto });
  assert.ok([200, 201].includes(up.statusCode), up.body);
  const r = await Promise.all(Array.from({ length: 8 }, (_, i) => req(i % 2 ? 'vg-a1' : 'vg-a2', 'POST', `/api/projecten/${p}/verwerkingen`, { soort: 'foto-indeling' })));
  const codes = r.map((x) => x.statusCode).sort();
  assert.deepEqual(codes, [202, 409, 409, 409, 409, 409, 409, 409], codes.join(','));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM verwerking WHERE project_id = $1 AND status IN ('wachtrij', 'bezig')", [p])).rows[0].n, 1);
  // Ook rechtstreeks in de database: een tweede lopende verwerking voor hetzelfde project kan niet bestaan.
  const g = (await pool.query("SELECT id FROM gebruiker WHERE email = 'vg-beheer@studio.test'")).rows[0].id;
  await assert.rejects(pool.query(`INSERT INTO verwerking (project_id, kantoor_id, soort, volgnummer, status, aangevraagd_door) VALUES ($1, $2, 'foto-indeling', 99, 'wachtrij', $3)`, [p, A, g]),
    (e: { constraint?: string }) => e.constraint === 'verwerking_een_lopend');
  await wekVerwerker();
});
