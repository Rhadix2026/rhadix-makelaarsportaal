// Correctie aandachtspaneel: het paneel is de werkvoorraad (alleen OPEN/IN_BEHANDELING). 'Nieuw' is alleen een
// markering binnen die selectie; bewust bekijken (zoals 'Alle verbeterpunten') verwijdert alleen die markering en
// verandert de aantallen open en de getoonde werkvoorraad niet. Verwerkte en geannuleerde punten blijven in het
// volledige overzicht. Voor kantoor en makelaar blijven afhandelingen door Rhadix een aparte melding.
// Uitgangssituatie zoals op test: 1 open, 1 in behandeling, 2 verwerkt, 2 geannuleerd, nog nooit bekeken.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { bouwApp } from '../api/src/server.ts';
import { migreer, pool } from '../api/src/db.ts';
import { login, maakGebruiker, maakKantoorDirect } from './hulp.ts';

const app = bouwApp();
const id: Record<string, string> = {}, c: Record<string, string> = {}, pt: Record<string, string> = {};
let A = '', P = '', K1 = '';
const req = (wie: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => app.inject({ method, url, headers: { cookie: c[wie] }, payload });
type Item = { id: string; status: string; nieuw: boolean };
type Blok = { nieuw: number; open: number; afgehandeld: number; afgehandeld_nieuw: number; items: Item[]; afgehandeld_items: Item[] };
const blok = async (wie: string) => (await req(wie, 'GET', '/api/aandacht')).json().soorten[0] as Blok;
const wacht = () => new Promise((r) => setTimeout(r, 15));

before(async () => {
  await migreer();
  A = await maakKantoorDirect('Kantoor A', 'kantoor-a');
  id.beheer = await maakGebruiker('beheer@studio.test', { platform: true });
  id.kba = await maakGebruiker('kba@studio.test', { kantoren: [[A, 'kantoorbeheerder']] });
  id.mka = await maakGebruiker('mka@studio.test', { kantoren: [[A, 'makelaar']] });
  for (const e of Object.keys(id)) c[e] = await login(app, `${e}@studio.test`);
  P = (await req('mka', 'POST', '/api/projecten', { kantoor_id: A, naam: 'Woning', adres: 'Markt 27', plaats: 'Wolvega' })).json().id;
  const maak = async (v: number) => (await pool.query(`INSERT INTO concept (project_id, kantoor_id, versie, map, invoer_vingerafdruk, build_vingerafdruk, ontwerpsysteem, profiel,
      generator_commit, bouw, metingen, voorbeeld_token, aangemaakt_door) VALUES ($1, $2, $3, 'x', 'x', 'x', '1.0', 'buitenplaats', 'x', '{}', '{}', $4, $5) RETURNING id`,
    [P, A, v, randomBytes(32).toString('base64url'), id.beheer])).rows[0].id as string;
  K1 = await maak(1); await maak(2);
  for (const n of ['open', 'behandeling', 'klaar1', 'klaar2', 'geann1', 'geann2']) {
    pt[n] = (await req('mka', 'POST', `/api/concepten/${K1}/verbeterpunten`, { punten: [{ tekst: `punt ${n}` }] })).json().ids[0]; await wacht();
  }
  const zet = (n: string, data: object) => req('beheer', 'PATCH', `/api/verbeterpunten/${pt[n]}`, data);
  await zet('behandeling', { status: 'IN_BEHANDELING' });
  for (const n of ['klaar1', 'klaar2']) await zet(n, { status: 'KLAAR', verwerkt_in_versie: 2, reactie: 'Verwerkt in v2.' });
  for (const n of ['geann1', 'geann2']) await zet(n, { status: 'GEANNULEERD', reactie: 'Niet uitgevoerd: buiten de brochure.' });
});
after(() => app.close());

test('platformbeheer, eerste opening: alleen de 2 open punten, beide nieuw; geen verwerkte of geannuleerde', async () => {
  const b = await blok('beheer');
  assert.equal(b.open, 2); assert.equal(b.nieuw, 2, 'nieuw telt alleen binnen de werkvoorraad (niet 6)');
  assert.deepEqual(b.items.map((i) => i.id).sort(), [pt.open, pt.behandeling].sort());
  assert.ok(b.items.every((i) => ['OPEN', 'IN_BEHANDELING'].includes(i.status) && i.nieuw));
  assert.deepEqual(b.afgehandeld_items, [], 'geen afhandelingsblok voor platformbeheer');
});

test("platformbeheer, na 'Alle verbeterpunten' (bewust bekeken): zelfde werkvoorraad en aantal open; alleen de markering weg", async () => {
  const voor = await blok('beheer');
  assert.equal((await req('beheer', 'POST', '/api/aandacht/verbeterpunten/gezien')).statusCode, 200); await wacht();
  const na = await blok('beheer');
  assert.equal(na.open, voor.open);
  assert.deepEqual(na.items.map((i) => i.id), voor.items.map((i) => i.id), 'dezelfde punten in dezelfde volgorde');
  assert.equal(na.nieuw, 0); assert.ok(na.items.every((i) => !i.nieuw));
  // Een nieuw open punt: alleen dat punt gemarkeerd.
  const r = await req('mka', 'POST', `/api/concepten/${K1}/verbeterpunten`, { punten: [{ tekst: 'punt nieuw na inzage' }] });
  const nieuw = r.json().ids[0];
  const daarna = await blok('beheer');
  assert.equal(daarna.open, 3); assert.equal(daarna.nieuw, 1);
  assert.deepEqual(daarna.items.filter((i) => i.nieuw).map((i) => i.id), [nieuw]);
  assert.equal(daarna.items[0].id, nieuw, 'nieuw eerst');
  // Opruimen voor de volgende toets: dit punt gemotiveerd annuleren (blijft in het volledige overzicht).
  await req('beheer', 'PATCH', `/api/verbeterpunten/${nieuw}`, { status: 'GEANNULEERD', reactie: 'Testpunt.' });
});

test('volledig overzicht (platformbeheer): standaard de werkvoorraad, met status alle ook verwerkt en geannuleerd', async () => {
  const werk = (await req('beheer', 'GET', '/api/verbeterpunten')).json() as Item[];
  assert.deepEqual(werk.map((i) => i.status).sort(), ['IN_BEHANDELING', 'OPEN']);
  const alle = (await req('beheer', 'GET', '/api/verbeterpunten?status=alle')).json() as Item[];
  assert.equal(alle.length, 7);
  assert.deepEqual(alle.slice(0, 2).map((i) => i.status).sort(), ['IN_BEHANDELING', 'OPEN'], 'open eerst');
  for (const wie of ['kba', 'mka']) assert.equal((await req(wie, 'GET', '/api/verbeterpunten?status=alle')).statusCode, 403, wie);
});

test('makelaar en kantoorbeheerder: werkvoorraad alleen open; afhandelingen door Rhadix als aparte melding tot inzage', async () => {
  for (const wie of ['mka', 'kba']) {
    const b = await blok(wie);
    assert.deepEqual(b.items.map((i) => i.id).sort(), [pt.open, pt.behandeling].sort(), `${wie}: werkvoorraad alleen open`);
    assert.equal(b.open, 2);
    assert.equal(b.afgehandeld_items.length, 5, `${wie}: 2 verwerkt + 3 geannuleerd als aparte melding`);
    assert.ok(b.afgehandeld_items.every((i) => ['KLAAR', 'GEANNULEERD'].includes(i.status)));
    assert.ok(b.nieuw >= 6, `${wie}: reacties en afhandelingen tellen als nieuw (${b.nieuw})`);
    assert.equal((await req(wie, 'POST', '/api/aandacht/verbeterpunten/gezien')).statusCode, 200); await wacht();
    const na = await blok(wie);
    assert.deepEqual(na.items.map((i) => i.id).sort(), [pt.open, pt.behandeling].sort(), `${wie}: werkvoorraad ongewijzigd na inzage`);
    assert.equal(na.open, 2); assert.equal(na.nieuw, 0); assert.deepEqual(na.afgehandeld_items, []);
  }
  // Een nieuwe afhandeling door Rhadix verschijnt weer als melding; de werkvoorraad krimpt met dat punt.
  await req('beheer', 'PATCH', `/api/verbeterpunten/${pt.behandeling}`, { status: 'KLAAR', verwerkt_in_versie: 2, reactie: 'Verwerkt in v2.' });
  const m = await blok('mka');
  assert.deepEqual(m.items.map((i) => i.id), [pt.open]); assert.equal(m.open, 1);
  assert.deepEqual(m.afgehandeld_items.map((i) => i.id), [pt.behandeling]); assert.equal(m.nieuw, 1);
  // Statussen in de database ongewijzigd door bekijken.
  const st = (await pool.query('SELECT status, count(*)::int AS n FROM verbeterpunt GROUP BY 1 ORDER BY 1')).rows.map((r) => `${r.status}:${r.n}`);
  assert.deepEqual(st, ['GEANNULEERD:3', 'KLAAR:3', 'OPEN:1']);
});
