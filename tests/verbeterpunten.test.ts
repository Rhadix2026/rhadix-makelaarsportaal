// Verbeterpunten als takenworkflow (migratie 015): autorisatie per rol (platformbeheer, kantoorbeheerder,
// makelaar, ander kantoor), de volledige workflow (indienen → in behandeling → nieuwe versie → afronden met
// versie en toelichting → accepteren), de acceptatieblokkade en de regels in de database zelf.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { bouwApp } from '../api/src/server.ts';
import { alsGebruiker, migreer, pool } from '../api/src/db.ts';
import { login, maakGebruiker, maakKantoorDirect } from './hulp.ts';

const app = bouwApp();
let A = '', B = '', P = '', PB = '';
const id: Record<string, string> = {};
const c: Record<string, string> = {};
const k: Record<string, string> = {};   // conceptversies: a1, a2 (project A), b1 (project B)

async function concept(project: string, versie: number) {
  const p = (await pool.query('SELECT kantoor_id FROM project WHERE id = $1', [project])).rows[0];
  return (await pool.query(`INSERT INTO concept (project_id, kantoor_id, versie, map, invoer_vingerafdruk, build_vingerafdruk, ontwerpsysteem, profiel,
      generator_commit, bouw, metingen, voorbeeld_token, aangemaakt_door)
    VALUES ($1, $2, $3, 'x', 'x', 'x', '1.0', 'buitenplaats', 'x', '{}', '{}', $4, $5) RETURNING id`,
    [project, p.kantoor_id, versie, randomBytes(32).toString('base64url'), id.beheer])).rows[0].id as string;
}

before(async () => {
  await migreer();
  A = await maakKantoorDirect('Kantoor A', 'kantoor-a');
  B = await maakKantoorDirect('Kantoor B', 'kantoor-b');
  id.beheer = await maakGebruiker('beheer@studio.test', { platform: true });
  id.kba = await maakGebruiker('kba@studio.test', { kantoren: [[A, 'kantoorbeheerder']] });
  id.mka = await maakGebruiker('mka@studio.test', { kantoren: [[A, 'makelaar']] });
  id.mkb = await maakGebruiker('mkb@studio.test', { kantoren: [[B, 'makelaar']] });
  for (const e of ['beheer', 'kba', 'mka', 'mkb']) c[e] = await login(app, `${e}@studio.test`);
  P = (await req('mka', 'POST', '/api/projecten', { kantoor_id: A, naam: 'Woning A' })).json().id;
  PB = (await req('mkb', 'POST', '/api/projecten', { kantoor_id: B, naam: 'Woning B' })).json().id;
  await pool.query("UPDATE project SET status = 'interne_review' WHERE id = ANY($1)", [[P, PB]]);
  k.a1 = await concept(P, 1);
  k.b1 = await concept(PB, 1);
});
after(() => app.close());

const req = (wie: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: c[wie] }, payload });
const punten = async (wie = 'beheer') => (await req(wie, 'GET', `/api/projecten/${P}/verbeterpunten`)).json() as { id: string; status: string; tekst: string; versie: number; verwerkt_in_versie: number | null; reactie: string | null; behandelaar: string | null }[];
const dienIn = (wie: string, concept: string, ...teksten: string[]) =>
  req(wie, 'POST', `/api/concepten/${concept}/verbeterpunten`, { punten: teksten.map((tekst, i) => ({ onderdeel: i ? 'teksten' : 'openingsbeeld', tekst })) });
const behandel = (wie: string, punt: string, data: object) => req(wie, 'PATCH', `/api/verbeterpunten/${punt}`, data);

test('indienen: makelaar, kantoorbeheerder en platformbeheer (meerdere per keer); ander kantoor niet', async () => {
  const r = await dienIn('mka', k.a1, 'Andere openingsfoto, liefst de voorgevel', 'Kop "Wonen in" aanvullen');
  assert.equal(r.statusCode, 201, r.body);
  assert.equal(r.json().ids.length, 2);
  assert.equal((await dienIn('kba', k.a1, 'Telefoonnummer kantoor ontbreekt')).statusCode, 201);
  assert.equal((await dienIn('beheer', k.a1, 'Alt-teksten nalopen')).statusCode, 201);
  assert.equal((await dienIn('mkb', k.a1, 'Probeer bij een ander kantoor')).statusCode, 404, 'ander kantoor');
  assert.equal((await req('mka', 'POST', `/api/concepten/${k.a1}/verbeterpunten`, { punten: [{ tekst: 'x' }] })).statusCode, 400, 'te kort');
  assert.equal((await req('mka', 'POST', `/api/concepten/${k.a1}/verbeterpunten`, { punten: Array.from({ length: 21 }, () => ({ tekst: 'abcdef' })) })).statusCode, 400, 'maximaal 20');
  const lijst = await punten('mka');
  assert.equal(lijst.length, 4); assert.ok(lijst.every((p) => p.status === 'OPEN' && p.versie === 1));
  // Zelfde gevolgen als altijd: concept 'verbeterpunten', project 'correctie'; besluitenlog en audit.
  assert.equal((await pool.query('SELECT status FROM concept WHERE id = $1', [k.a1])).rows[0].status, 'verbeterpunten');
  assert.equal((await pool.query('SELECT status FROM project WHERE id = $1', [P])).rows[0].status, 'correctie');
  const log = (await pool.query(`SELECT handeling FROM besluit WHERE project_id = $1 AND onderwerp = 'verbeterpunten v1' ORDER BY op`, [P])).rows.map((r) => r.handeling);
  assert.deepEqual(log, ['ingediend (2)', 'ingediend (1)', 'ingediend (1)']);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM auditregel WHERE actie = 'verbeterpunten_ingediend'`)).rows[0].n, 3);
  // Het bevroren archief blijft leeg: geen dubbele registratie.
  assert.deepEqual((await pool.query('SELECT verbeterpunten FROM concept WHERE id = $1', [k.a1])).rows[0].verbeterpunten, []);
});

test('lezen: eigen kantoor en platformbeheer; ander kantoor niet; overzicht alleen voor platformbeheer', async () => {
  assert.equal((await req('kba', 'GET', `/api/projecten/${P}/verbeterpunten`)).statusCode, 200);
  assert.equal((await req('mkb', 'GET', `/api/projecten/${P}/verbeterpunten`)).statusCode, 404);
  const o = await req('beheer', 'GET', '/api/verbeterpunten');
  assert.equal(o.statusCode, 200); assert.equal(o.json().length, 4);
  assert.ok(o.json().every((p: { kantoor: string; versies: number[] }) => p.kantoor === 'Kantoor A' && p.versies.includes(1)));
  for (const wie of ['kba', 'mka', 'mkb']) assert.equal((await req(wie, 'GET', '/api/verbeterpunten')).statusCode, 403, wie);
  // In de database: een makelaar van B ziet niets van A.
  assert.equal(await alsGebruiker(id.mkb, async (x) => (await x.query('SELECT 1 FROM verbeterpunt')).rowCount), 0);
});

test('behandelen alleen door platformbeheer; regels voor afronden en annuleren', async () => {
  const [p1, p2, p3, p4] = await punten();
  for (const wie of ['kba', 'mka', 'mkb']) assert.equal((await behandel(wie, p1.id, { status: 'IN_BEHANDELING' })).statusCode, 403, wie);
  const r = await behandel('beheer', p1.id, { status: 'IN_BEHANDELING' });
  assert.equal(r.statusCode, 200, r.body); assert.equal(r.json().behandelaar, id.beheer);
  assert.equal((await behandel('beheer', p1.id, { reactie: 'We kiezen de foto van pagina 2.' })).json().status, 'IN_BEHANDELING', 'beantwoorden laat de status staan');
  assert.equal((await behandel('beheer', p1.id, { status: 'KLAAR', reactie: 'Aangepast' })).statusCode, 400, 'zonder versie');
  assert.equal((await behandel('beheer', p1.id, { status: 'KLAAR', reactie: 'Aangepast', verwerkt_in_versie: 1 })).statusCode, 400, 'niet in dezelfde versie');
  assert.equal((await behandel('beheer', p4.id, { status: 'GEANNULEERD' })).statusCode, 400, 'annuleren zonder motivering');
  const ann = await behandel('beheer', p4.id, { status: 'GEANNULEERD', reactie: 'Alt-teksten volgen in de redactieronde.' });
  assert.equal(ann.statusCode, 200); assert.equal(ann.json().status, 'GEANNULEERD');
  assert.equal((await behandel('beheer', p4.id, { status: 'OPEN' })).statusCode, 409, 'afgehandeld is definitief');
  void p2; void p3;
});

test('nieuwe conceptversie rondt niets af; alleen Rhadix rondt af met versie en toelichting; acceptatie geblokkeerd tot alles is afgehandeld', async () => {
  // Accepteren van v1 met open punten: geweigerd, met de lijst.
  const weg = await req('kba', 'PUT', `/api/concepten/${k.a1}/beoordeling`, { besluit: 'geaccepteerd' });
  assert.equal(weg.statusCode, 409); assert.equal(weg.json().open.length, 3);
  assert.equal((await req('mka', 'PUT', `/api/concepten/${k.a1}/beoordeling`, { besluit: 'geaccepteerd' })).statusCode, 403, 'makelaar accepteert niet (ongewijzigd)');
  // Nieuwe versie: niets verandert aan de punten.
  k.a2 = await concept(P, 2);
  const na = await punten();
  assert.deepEqual(na.map((p) => p.status).sort(), ['GEANNULEERD', 'IN_BEHANDELING', 'OPEN', 'OPEN']);
  // Afronden in v2 met toelichting; zonder toelichting geweigerd.
  const [p1, p2, p3] = na.filter((p) => p.status !== 'GEANNULEERD');
  assert.equal((await behandel('beheer', p1.id, { status: 'KLAAR', verwerkt_in_versie: 2 })).statusCode, 400, 'toelichting verplicht');
  const klaar = await behandel('beheer', p1.id, { status: 'KLAAR', verwerkt_in_versie: 2, reactie: 'Openingsfoto vervangen door de voorgevel.' });
  assert.equal(klaar.statusCode, 200, klaar.body); assert.equal(klaar.json().verwerkt_in_versie, 2); assert.ok(klaar.json().afgehandeld_op);
  assert.equal((await req('kba', 'PUT', `/api/concepten/${k.a1}/beoordeling`, { besluit: 'geaccepteerd' })).json().open.length, 2, 'nog 2 open');
  await behandel('beheer', p2.id, { status: 'KLAAR', verwerkt_in_versie: 2, reactie: 'Kop aangevuld.' });
  await behandel('beheer', p3.id, { status: 'GEANNULEERD', reactie: 'Telefoonnummer komt uit de kantoorgegevens; daar aangevuld.' });
  // Alles afgehandeld (KLAAR of GEANNULEERD): accepteren mag.
  const ok = await req('kba', 'PUT', `/api/concepten/${k.a1}/beoordeling`, { besluit: 'geaccepteerd' });
  assert.equal(ok.statusCode, 200, ok.body); assert.equal(ok.json().status, 'geaccepteerd');
  // Per versie zichtbaar voor de makelaar, met reactie en 'verwerkt in v2'.
  const zicht = await punten('mka');
  assert.deepEqual(zicht.map((p) => [p.status, p.verwerkt_in_versie]).sort(), [['GEANNULEERD', null], ['GEANNULEERD', null], ['KLAAR', 2], ['KLAAR', 2]]);
  assert.ok(zicht.every((p) => p.reactie && p.reactie.length >= 3));
  const c1 = (await req('mka', 'GET', `/api/concepten/${k.a1}`)).json();
  assert.equal(c1.verbeterpunten.length, 4); assert.equal(c1.open_verbeterpunten, 0);
  // Logboeken: elke handeling vastgelegd.
  const log = (await pool.query(`SELECT handeling FROM besluit WHERE project_id = $1 AND onderwerp = 'verbeterpunten v1'`, [P])).rows.map((r) => r.handeling);
  for (const h of ['in behandeling', 'beantwoord', 'afgerond in v2', 'geannuleerd']) assert.ok(log.includes(h), h);
});

test('bestaande route (beoordeling, besluit verbeterpunten) schrijft in de tabel, niet in het archief', async () => {
  const r = await req('kba', 'PUT', `/api/concepten/${k.a2}/beoordeling`, { besluit: 'verbeterpunten', verbeterpunten: [{ onderdeel: 'mobiel', tekst: 'Menu op mobiel loopt over' }] });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().verbeterpunten.length, 1); assert.equal(r.json().verbeterpunten[0].status, 'OPEN');
  assert.deepEqual((await pool.query('SELECT verbeterpunten FROM concept WHERE id = $1', [k.a2])).rows[0].verbeterpunten, []);
  assert.ok((await pool.query(`SELECT 1 FROM besluit WHERE project_id = $1 AND onderwerp = 'concept v2' AND handeling = 'verbeterpunten vastgelegd'`, [P])).rowCount);
});

test('database: geen rechtstreeks schrijven buiten de regels; bewaking van versies, overgangen en acceptatie', async () => {
  const p = (await punten()).find((x) => x.versie === 2)!;
  const fout = async (wie: string, sql: string, w: unknown[] = []) => assert.rejects(alsGebruiker(id[wie], (x) => x.query(sql, w)), Error, `${wie}: ${sql}`);
  const geenRij = async (wie: string, sql: string, w: unknown[]) => assert.equal(await alsGebruiker(id[wie], async (x) => (await x.query(sql, w)).rowCount), 0, `${wie}: ${sql}`);
  // Kantoorgebruikers: niet zelf behandelen, niet invoegen, niet verwijderen.
  await geenRij('kba', "UPDATE verbeterpunt SET status = 'IN_BEHANDELING' WHERE id = $1", [p.id]);
  await geenRij('mka', "UPDATE verbeterpunt SET reactie = 'zelf' WHERE id = $1", [p.id]);
  await fout('mka', 'DELETE FROM verbeterpunt');
  await fout('mka', `INSERT INTO verbeterpunt (project_id, kantoor_id, concept_id, tekst, ingediend_door) VALUES ('${P}', '${A}', '${k.a2}', 'rechtstreeks', '${id.mka}')`);
  await fout('mkb', 'SELECT app.verbeterpunten_indienen($1, $2)', [k.a2, JSON.stringify([{ tekst: 'van een ander kantoor' }])]);
  // Archief bevroren: niemand schrijft nog in concept.verbeterpunten.
  await fout('kba', `UPDATE concept SET verbeterpunten = '[]' WHERE id = $1`, [k.a2]);
  // Ook platformbeheer: de ingediende tekst niet wijzigen; geen verwerkt_in van een ander project of een lagere versie.
  await fout('beheer', "UPDATE verbeterpunt SET tekst = 'gewijzigd' WHERE id = $1", [p.id]);
  await fout('beheer', "UPDATE verbeterpunt SET status = 'KLAAR', verwerkt_in = $2, reactie = 'x x x', afgehandeld_door = $3, afgehandeld_op = now() WHERE id = $1", [p.id, k.b1, id.beheer]);
  await fout('beheer', "UPDATE verbeterpunt SET status = 'KLAAR', verwerkt_in = $2, reactie = 'x x x', afgehandeld_door = $3, afgehandeld_op = now() WHERE id = $1", [p.id, k.a1, id.beheer]);
  // Acceptatie van v2 met een open punt: ook rechtstreeks in de database geweigerd.
  await assert.rejects(pool.query("UPDATE concept SET status = 'geaccepteerd' WHERE id = $1", [k.a2]), /verbeterpunten open/);
  // Na een geannuleerd punt: definitief.
  await behandel('beheer', p.id, { status: 'GEANNULEERD', reactie: 'Opgelost in de generator.' });
  await fout('beheer', "UPDATE verbeterpunt SET status = 'OPEN', afgehandeld_op = NULL, afgehandeld_door = NULL WHERE id = $1", [p.id]);
});
