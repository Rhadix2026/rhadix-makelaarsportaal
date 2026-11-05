// Tijdregistratie (machine, actief, kalender) en de indeling van kwaliteitsmeldingen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bouwApp } from '../api/src/server.ts';
import { migreer, pool } from '../api/src/db.ts';
import type pg from 'pg';
import { actief, actieveTijd } from '../api/src/tijd.ts';
import { deelConceptIn, deelMeldingIn, splits } from '../api/src/indeling.ts';
import { login, maakGebruiker, maakKantoorDirect } from './hulp.ts';

const app = bouwApp();
let A = '', P = '', beheerId = '';
const c: Record<string, string> = {};

before(async () => {
  await migreer();
  A = await maakKantoorDirect('Tijd A', 'tijd-a');
  const B = await maakKantoorDirect('Tijd B', 'tijd-b');
  beheerId = await maakGebruiker('beheer-tijd@studio.test', { platform: true });
  await maakGebruiker('a-tijd@studio.test', { kantoren: [[A, 'makelaar']] });
  await maakGebruiker('b-tijd@studio.test', { kantoren: [[B, 'makelaar']] });
  for (const e of ['beheer', 'a', 'b']) c[e] = await login(app, `${e}-tijd@studio.test`);
  P = (await app.inject({ method: 'POST', url: '/api/projecten', headers: { cookie: c.beheer }, payload: { kantoor_id: A, naam: 'Tijdproject' } })).json().id;
});
after(() => app.close());

const t = (min: number) => new Date(Date.UTC(2026, 10, 5, 12, 0) + min * 60e3);

test('actieve tijd: alleen tussenpozen binnen de inactiviteitsgrens tellen mee', () => {
  const g = 'g1';
  // 0–4 min actief (stappen van 1 min), dan 4 uur pauze, dan 2 min actief.
  const m = [0, 1, 2, 3, 4, 244, 245, 246].map((x) => ({ gebruiker: g, op: t(x) }));
  const r = actieveTijd(m, 5 * 60e3);
  assert.equal(r.ms, 6 * 60e3, '4 + 2 minuten; de pauze van 4 uur telt niet');
  assert.equal(r.pauzes, 1); assert.equal(r.sessies, 2);
  // Een tussenpoos van precies de grens telt mee, een langere niet.
  assert.equal(actieveTijd([{ gebruiker: g, op: t(0) }, { gebruiker: g, op: t(5) }], 5 * 60e3).ms, 5 * 60e3);
  assert.equal(actieveTijd([{ gebruiker: g, op: t(0) }, { gebruiker: g, op: t(6) }], 5 * 60e3).ms, 0);
  // Per gebruiker: twee mensen tegelijk tellen elk hun eigen tijd.
  assert.equal(actieveTijd([{ gebruiker: 'x', op: t(0) }, { gebruiker: 'x', op: t(2) }, { gebruiker: 'y', op: t(1) }, { gebruiker: 'y', op: t(3) }], 5 * 60e3).ms, 4 * 60e3);
  // Instelbare grens.
  assert.equal(actieveTijd(m, 1 * 60e3).ms, 6 * 60e3);
  assert.equal(actieveTijd(m, 30e3).ms, 0);
});

test('interacties registreren: gedempt, alleen eigen projecten, onbekend scherm geweigerd', async () => {
  const post = (wie: string, scherm: string, p = P) => app.inject({ method: 'POST', url: `/api/projecten/${p}/activiteit`, headers: { cookie: c[wie] }, payload: { scherm } });
  assert.equal((await post('beheer', 'beoordeling')).statusCode, 204);
  assert.equal((await post('beheer', 'beoordeling')).statusCode, 204);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM activiteit WHERE project_id = $1', [P])).rows[0].n, 1, 'binnen 20 s niet nogmaals vastgelegd');
  assert.equal((await post('a', 'project')).statusCode, 204, 'makelaar van het eigen kantoor');
  assert.equal((await post('b', 'project')).statusCode, 404, 'ander kantoor ziet het project niet');
  assert.equal((await post('beheer', 'iets')).statusCode, 400);
  // Alleen tijdstip, scherm en gebruiker; geen inhoud.
  const kolommen = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'activiteit' ORDER BY 1")).rows.map((r) => r.column_name);
  assert.deepEqual(kolommen, ['gebruiker', 'id', 'kantoor_id', 'op', 'project_id', 'scherm']);
});

test('meting: betrouwbaar alleen als de interacties vanaf het begin zijn geregistreerd', async () => {
  const q = async <T>(fn: (cl: pg.PoolClient) => Promise<T>) => { const cl = await pool.connect(); try { return await fn(cl); } finally { cl.release(); } };
  // Besluit (handeling) vóór de eerste interactie: onvolledig.
  await pool.query("INSERT INTO besluit (project_id, kantoor_id, onderwerp, handeling, door, op) VALUES ($1, $2, 'test', 'test', $3, now() - interval '1 hour')", [P, A, beheerId]);
  const r = await q((cl) => actief(cl, P, new Date()));
  assert.equal(r.betrouwbaar, false); assert.match(r.toelichting, /onvolledig/);
  assert.ok(r.pauzes >= 1, 'het uur tussen het besluit en de interacties telt niet');
  assert.ok(r.ms < 60e3);
  // Een project waar de registratie vóór de eerste handeling begint: betrouwbaar.
  const P2 = (await app.inject({ method: 'POST', url: '/api/projecten', headers: { cookie: c.beheer }, payload: { kantoor_id: A, naam: 'Tijdproject 2' } })).json().id;
  await pool.query(`INSERT INTO activiteit (project_id, kantoor_id, gebruiker, scherm, op) VALUES
    ($1, $2, $3, 'beoordeling', now() - interval '10 minutes'), ($1, $2, $3, 'beoordeling', now() - interval '8 minutes'), ($1, $2, $3, 'beoordeling', now() - interval '7 minutes')`, [P2, A, beheerId]);
  await pool.query("INSERT INTO besluit (project_id, kantoor_id, onderwerp, handeling, door, op) VALUES ($1, $2, 'test', 'test', $3, now() - interval '6 minutes')", [P2, A, beheerId]);
  const r2 = await q((cl) => actief(cl, P2, new Date()));
  assert.equal(r2.betrouwbaar, true); assert.equal(Math.round(r2.ms / 60e3), 4); assert.equal(r2.interacties, 3); assert.equal(r2.handelingen, 1);
});

test('indeling van kwaliteitsmeldingen: categorie, actie en technische details apart', () => {
  assert.deepEqual(splits('27 woorden in compositie[2].onderdelen[0].props.tekst.inhoud[0].prose'), { tekst: '27 woorden', detail: 'compositie[2].onderdelen[0].props.tekst.inhoud[0].prose' });
  assert.deepEqual(splits('regulier 72 tekens per regel op 768 px (norm 45–70): #indeling p.prose'), { tekst: 'regulier 72 tekens per regel op 768 px (norm 45–70)', detail: '#indeling p.prose' });
  const f = deelMeldingIn('fotocategorieën', "3 foto's met onzekere classificatie: menselijke controle nodig", 'publicatie');
  assert.deepEqual([f.categorie, f.actie], ['fotografie', 'publicatie']);
  const z = deelMeldingIn('zinslengte', '30 woorden in compositie[10].onderdelen[0].props.inhoud[1].prose', 'publicatie');
  assert.deepEqual([z.categorie, z.actie, z.tekst], ['tekst', 'geen', 'Lange zin: 30 woorden']);
  assert.equal(deelMeldingIn('balans', '40 tekens per beeld op de pagina (norm 100–250)', 'publicatie').categorie, 'vormgeving');
  assert.equal(deelMeldingIn('feitencontrole', 'woonoppervlakte 85 m² in de tekst, 80 m² als feit', 'conceptgeneratie').actie, 'conceptgeneratie', 'blokkades blijven blokkades');
  const k = deelConceptIn({ blokkerend: [{ controle: 'feiten', melding: 'x' }], waarschuwingen: [{ controle: 'huisstijl', melding: 'geen huisstijlkleuren van de makelaar (neutraal profiel)' }] })!;
  assert.deepEqual(k.samenvatting.map((s) => s.code), ['fotografie', 'inhoud', 'tekst', 'vormgeving']);
  assert.equal(k.meldingen[0].actie, 'publicatie', 'na generatie: blokkerend geldt voor publicatie');
  assert.equal(k.meldingen[1].actie, 'geen');
});
