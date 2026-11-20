// Inlogmelding en aandachtspaneel (migratie 016): rollen en organisatiescheiding, nieuw tegenover bekeken,
// reacties van Rhadix, 'gezien' verandert niets aan de punten, sessiecode bij herhaald inloggen en bij
// afmelden en opnieuw aanmelden, en de regels voor de tabel gezien in de database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { bouwApp } from '../api/src/server.ts';
import { alsGebruiker, migreer, pool } from '../api/src/db.ts';
import { randomUUID } from 'node:crypto';
import { login, maakGebruiker, maakKantoorDirect, rhadixToken, ssoCookie } from './hulp.ts';

const app = bouwApp();
let A = '', B = '', PA = '', PB = '';
const id: Record<string, string> = {}, c: Record<string, string> = {}, k: Record<string, string> = {};
const req = (wie: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => app.inject({ method, url, headers: { cookie: c[wie] }, payload });
type Blok = { rol: string; nieuw: number; open: number; afgehandeld: number; afgehandeld_nieuw: number; items: { id: string; tekst: string; kantoor?: string; adres: string | null; project_naam: string; nieuw: boolean }[] };
const blok = async (wie: string) => { const r = (await req(wie, 'GET', '/api/aandacht')).json(); return { ...(r.soorten[0] as Blok), rol: r.rol as string }; };
const gezien = (wie: string) => req(wie, 'POST', '/api/aandacht/verbeterpunten/gezien');
const dien = (wie: string, concept: string, tekst: string) => req(wie, 'POST', `/api/concepten/${concept}/verbeterpunten`, { punten: [{ tekst }] });
const punt = async (tekst: string) => (await pool.query('SELECT id FROM verbeterpunt WHERE tekst = $1', [tekst])).rows[0].id as string;
const wacht = () => new Promise((r) => setTimeout(r, 15));   // tijdstempels strikt na elkaar

async function concept(project: string, versie: number) {
  const p = (await pool.query('SELECT kantoor_id FROM project WHERE id = $1', [project])).rows[0];
  return (await pool.query(`INSERT INTO concept (project_id, kantoor_id, versie, map, invoer_vingerafdruk, build_vingerafdruk, ontwerpsysteem, profiel,
      generator_commit, bouw, metingen, voorbeeld_token, aangemaakt_door) VALUES ($1, $2, $3, 'x', 'x', 'x', '1.0', 'buitenplaats', 'x', '{}', '{}', $4, $5) RETURNING id`,
    [project, p.kantoor_id, versie, randomBytes(32).toString('base64url'), id.beheer])).rows[0].id as string;
}

before(async () => {
  await migreer();
  A = await maakKantoorDirect('Kantoor A', 'kantoor-a'); B = await maakKantoorDirect('Kantoor B', 'kantoor-b');
  id.beheer = await maakGebruiker('beheer@studio.test', { platform: true });
  id.beheer2 = await maakGebruiker('beheer2@studio.test', { platform: true });
  id.kba = await maakGebruiker('kba@studio.test', { kantoren: [[A, 'kantoorbeheerder']] });
  id.mka = await maakGebruiker('mka@studio.test', { kantoren: [[A, 'makelaar']] });
  id.mka2 = await maakGebruiker('mka2@studio.test', { kantoren: [[A, 'makelaar']] });
  id.mkb = await maakGebruiker('mkb@studio.test', { kantoren: [[B, 'makelaar']] });
  for (const e of Object.keys(id)) c[e] = await login(app, `${e}@studio.test`);
  PA = (await req('mka', 'POST', '/api/projecten', { kantoor_id: A, naam: 'Woning A (intern)', adres: 'Dorpsstraat 1', plaats: 'Ootmarsum' })).json().id;
  PB = (await req('mkb', 'POST', '/api/projecten', { kantoor_id: B, naam: 'Woning B (intern)', adres: 'Geheimweg 9', plaats: 'Elders' })).json().id;
  k.a1 = await concept(PA, 1); k.a2 = await concept(PA, 2); k.b1 = await concept(PB, 1);
  await dien('mka', k.a1, 'A1: eigen punt makelaar A'); await wacht();
  await dien('mka', k.a1, 'A2: tweede punt makelaar A'); await wacht();
  await dien('mka2', k.a1, 'A3: punt van de collega'); await wacht();
  await dien('mkb', k.b1, 'B1: punt van kantoor B');
});
after(() => app.close());

test('rollen en organisatiescheiding: platform alles, kantoorbeheerder eigen kantoor, makelaar eigen punten', async () => {
  const p = await blok('beheer');
  assert.equal(p.rol, 'platformbeheer'); assert.equal(p.open, 4); assert.equal(p.nieuw, 4, 'nooit bekeken: alles nieuw');
  assert.deepEqual([...new Set(p.items.map((i) => i.kantoor))].sort(), ['Kantoor A', 'Kantoor B']);
  const kb = await blok('kba');
  assert.equal(kb.rol, 'kantoorbeheerder'); assert.equal(kb.open, 3); assert.equal(kb.nieuw, 0, 'nog geen reactie van Rhadix');
  assert.ok(kb.items.every((i) => !('kantoor' in i)), 'geen kantoornaam voor kantoorgebruikers');
  const m = await blok('mka');
  assert.equal(m.rol, 'makelaar'); assert.equal(m.open, 2);
  assert.deepEqual(m.items.map((i) => i.tekst).sort(), ['A1: eigen punt makelaar A', 'A2: tweede punt makelaar A'], 'niet het punt van de collega');
  const mb = await blok('mkb');
  assert.deepEqual(mb.items.map((i) => i.tekst), ['B1: punt van kantoor B']);
  // Geen gegevens van een andere organisatie, ook niet in tekst of projectnaam.
  for (const wie of ['kba', 'mka', 'mka2']) {
    const tekst = (await req(wie, 'GET', '/api/aandacht')).body + (await req(wie, 'GET', '/api/aandacht/verbeterpunten')).body;
    assert.doesNotMatch(tekst, /Kantoor B|Geheimweg|Woning B|B1: punt/, wie);
  }
  assert.doesNotMatch((await req('mkb', 'GET', '/api/aandacht')).body + (await req('mkb', 'GET', '/api/aandacht/verbeterpunten')).body, /Kantoor A|Dorpsstraat|Woning A|A1: /);
});

test('nieuw tegenover bekeken (platformbeheer): per gebruiker; bekijken verandert niets aan de punten; alleen lezen zet niets', async () => {
  const statussen = async () => (await pool.query('SELECT id, status, bijgewerkt_op FROM verbeterpunt ORDER BY id')).rows;
  const voor = await statussen();
  // Dashboard/paneel lezen (ook herhaald) zet niets: 'Later' en alleen het dashboard openen zijn geen inzage.
  await req('beheer', 'GET', '/api/aandacht'); await req('beheer', 'GET', '/api/aandacht');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM gezien')).rows[0].n, 0);
  assert.equal((await blok('beheer')).nieuw, 4);
  // Bewust bekijken: nieuw 0, open blijft 4, de punten zelf ongewijzigd.
  assert.equal((await gezien('beheer')).statusCode, 200); await wacht();
  const na = await blok('beheer');
  assert.equal(na.nieuw, 0); assert.equal(na.open, 4);
  assert.deepEqual(await statussen(), voor, 'status en bijgewerkt_op ongewijzigd');
  // Een nieuw punt telt weer; een andere platformbeheerder heeft een eigen tijdstip.
  await dien('mka', k.a1, 'A4: nieuw na inzage');
  assert.equal((await blok('beheer')).nieuw, 1);
  assert.equal((await blok('beheer2')).nieuw, 5);
  assert.equal((await req('beheer', 'POST', '/api/aandacht/iets-anders/gezien')).statusCode, 404);
});

test('reacties van Rhadix: nieuw voor de indiener en de kantoorbeheerder; afgehandeld apart geteld', async () => {
  await gezien('kba'); await gezien('mka'); await gezien('mka2'); await wacht();
  const a1 = await punt('A1: eigen punt makelaar A'), a3 = await punt('A3: punt van de collega');
  await req('beheer', 'PATCH', `/api/verbeterpunten/${a1}`, { reactie: 'We pakken dit op.' });
  let m = await blok('mka');
  assert.equal(m.nieuw, 1, 'reactie op eigen punt'); assert.ok(m.items.find((i) => i.id === a1)?.nieuw);
  assert.equal((await blok('mka2')).nieuw, 0, 'reactie op andermans punt telt niet voor de collega');
  assert.equal((await blok('kba')).nieuw, 1, 'kantoorbeheerder ziet de reactie binnen zijn kantoor');
  await req('beheer', 'PATCH', `/api/verbeterpunten/${a3}`, { status: 'KLAAR', verwerkt_in_versie: 2, reactie: 'Verwerkt in v2.' });
  const m2 = await blok('mka2');
  assert.equal(m2.nieuw, 1); assert.equal(m2.afgehandeld_nieuw, 1); assert.equal(m2.open, 0);
  const kb = await blok('kba');
  assert.equal(kb.nieuw, 2); assert.equal(kb.afgehandeld, 1); assert.equal(kb.open, 3, 'A1, A2, A4 open');
  // In behandeling nemen (zonder reactie) is ook een handeling van Rhadix.
  await req('beheer', 'PATCH', `/api/verbeterpunten/${await punt('A2: tweede punt makelaar A')}`, { status: 'IN_BEHANDELING' });
  assert.equal((await blok('mka')).nieuw, 2);
  // De makelaar bekijkt: zijn teller 0; die van de kantoorbeheerder niet.
  await gezien('mka');
  m = await blok('mka'); assert.equal(m.nieuw, 0); assert.equal(m.open, 3);
  assert.equal((await blok('kba')).nieuw, 3);
  // De volledige lijst voor de makelaar: alleen eigen punten, met de drie categorieën af te leiden.
  const lijst = (await req('mka', 'GET', '/api/aandacht/verbeterpunten')).json();
  assert.equal(lijst.rol, 'makelaar'); assert.ok(lijst.punten.every((p: { eigen: boolean }) => p.eigen));
});

test('sessiecode: gelijk binnen één aanmelding, nieuw bij herhaald inloggen en na afmelden en opnieuw aanmelden', async () => {
  const sessie = async (cookie: string) => (await app.inject({ method: 'GET', url: '/api/ik', headers: { cookie } })).json().sessie as string;
  const s1 = await sessie(c.mka);
  assert.match(s1, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(await sessie(c.mka), s1, 'zelfde aanmelding (ander tabblad): zelfde code');
  assert.ok(!c.mka.includes(s1), 'de code is niet het token zelf');
  const opnieuw = await login(app, 'mka@studio.test');
  assert.notEqual(await sessie(opnieuw), s1, 'herhaald inloggen: nieuwe code');
  await app.inject({ method: 'POST', url: '/api/uitloggen', headers: { cookie: opnieuw, origin: 'http://127.0.0.1:5480' } });
  const derde = await login(app, 'mka@studio.test');
  const s3 = await sessie(derde);
  assert.ok(s3 && s3 !== s1, 'na afmelden en opnieuw aanmelden: nieuwe code');
  assert.equal((await app.inject({ method: 'GET', url: '/api/aandacht' })).statusCode, 401, 'zonder aanmelding geen aandachtspunten');
});

test('database: gezien alleen de eigen rij; niemand leest of zet het tijdstip van een ander', async () => {
  const rijen = await alsGebruiker(id.mka, async (x) => (await x.query('SELECT gebruiker_id FROM gezien')).rows.map((r) => r.gebruiker_id));
  assert.deepEqual(rijen, [id.mka]);
  assert.deepEqual(await alsGebruiker(id.beheer, async (x) => (await x.query('SELECT gebruiker_id FROM gezien')).rows.map((r) => r.gebruiker_id)), [id.beheer], 'ook platformbeheer alleen de eigen rij');
  await assert.rejects(alsGebruiker(id.mka, (x) => x.query(`INSERT INTO gezien (gebruiker_id, onderwerp) VALUES ($1, 'verbeterpunten')`, [id.mka2])));
  assert.equal(await alsGebruiker(id.mka, async (x) => (await x.query(`UPDATE gezien SET gezien_op = now() WHERE gebruiker_id = $1`, [id.kba])).rowCount), 0);
  await assert.rejects(alsGebruiker(id.mka, (x) => x.query('DELETE FROM gezien')));
});

test('sessiecode bij aanmelden via Rhadix: zelfde token = zelfde sessie; nieuwe aanmelding (nieuw token) = nieuwe sessie', async () => {
  const org = randomUUID();
  await pool.query('UPDATE kantoor SET rhadix_tenant_id = $2 WHERE id = $1', [A, org]);
  const sub = randomUUID();
  const t1 = rhadixToken({ sub, tenant_id: org, email: 'sso.makelaar@rhadix.test', iat: Math.floor(Date.now() / 1000) - 60 });
  const t2 = rhadixToken({ sub, tenant_id: org, email: 'sso.makelaar@rhadix.test', iat: Math.floor(Date.now() / 1000) });
  const ik = async (t: string) => (await app.inject({ method: 'GET', url: '/api/ik', headers: { cookie: ssoCookie(t) } })).json();
  const a = await ik(t1), b = await ik(t1), n = await ik(t2);
  assert.equal(a.bron, 'rhadix'); assert.match(a.sessie, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(b.sessie, a.sessie, 'zelfde aanmelding');
  assert.notEqual(n.sessie, a.sessie, 'nieuwe aanmelding');
  // De Rhadix-makelaar ziet alleen wat voor hem relevant is (nog niets ingediend: geen punten van collega's).
  const r = (await app.inject({ method: 'GET', url: '/api/aandacht', headers: { cookie: ssoCookie(t2) } })).json();
  assert.equal(r.rol, 'makelaar'); assert.equal(r.soorten[0].items.length, 0); assert.equal(r.soorten[0].open, 0);
});
