// Centrale Rhadix-login: tokencontrole, rollen, koppeling op organisatie-ID, organisatiescheiding,
// herkomstcontrole en de noodtoegang. Tokens worden getekend met een tijdelijk testsleutelpaar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto';
import { bouwApp } from '../api/src/server.ts';
import { migreer, pool } from '../api/src/db.ts';
import { config } from '../api/src/config.ts';
import { wisSsoCache } from '../api/src/rhadixsso.ts';
import { login, maakGebruiker, maakKantoorDirect, rhadixToken, ssoCookie, WACHTWOORD } from './hulp.ts';

const app = bouwApp();
const HERKOMST = 'http://127.0.0.1:5480';
const ORG_A = randomUUID(), ORG_B = randomUUID();
let A = '', B = '';

before(async () => {
  await migreer();
  A = await maakKantoorDirect('Kantoor A', 'sso-a');
  B = await maakKantoorDirect('Kantoor B', 'sso-b');
  await pool.query('UPDATE kantoor SET rhadix_tenant_id = $2 WHERE id = $1', [A, ORG_A]);
  await pool.query('UPDATE kantoor SET rhadix_tenant_id = $2 WHERE id = $1', [B, ORG_B]);
  await pool.query("INSERT INTO project (kantoor_id, slug, naam, ontwerpsysteem) VALUES ($1, 'sso-a-woning', 'Woning A', 'ds-1.0'), ($2, 'sso-b-woning', 'Woning B', 'ds-1.0')", [A, B]);
});
after(() => app.close());

const als = (token: string, url: string, extra: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url, headers: { cookie: ssoCookie(token), ...extra } });
const namen = async (token: string, url: string, veld: string) => {
  const b = (await als(token, url)).json();
  return (Array.isArray(b) ? b : b.projecten).map((r: Record<string, string>) => r[veld]);
};

test('makelaar via Rhadix: aangemaakt zonder wachtwoord, in het kantoor van de eigen organisatie', async () => {
  const sub = randomUUID();
  const t = rhadixToken({ sub, tenant_id: ORG_A, email: 'makelaar.a@rhadix.test', name: 'Makelaar A',
    branding: { primary_color: '#123456', accent_color: '#abcdef', wordmark: 'Kantoor A', logo_url: 'https://platform.rhadix.invalid/api/branding/x/logo' } });
  const r = await als(t, '/api/ik');
  assert.equal(r.statusCode, 200);
  const ik = r.json();
  assert.equal(ik.bron, 'rhadix');
  assert.equal(ik.platformbeheer, false);
  assert.deepEqual(ik.kantoren.map((k: { naam: string; rol: string }) => [k.naam, k.rol]), [['Kantoor A', 'makelaar']]);
  assert.deepEqual(ik.huisstijl, { primair: '#123456', accent: '#abcdef', woordmerk: 'Kantoor A', logo: 'https://platform.rhadix.invalid/api/branding/x/logo' });
  assert.equal(ik.uitloggen, 'https://platform.rhadix.invalid/api/auth/logout');
  const g = (await pool.query("SELECT wachtwoord_hash, extern_bron, extern_id, rhadix_tenant_id FROM gebruiker WHERE email = 'makelaar.a@rhadix.test'")).rows[0];
  assert.deepEqual(g, { wachtwoord_hash: null, extern_bron: 'rhadix', extern_id: sub, rhadix_tenant_id: ORG_A });
});

test('organisatiescheiding: een makelaar ziet alleen het eigen kantoor en de eigen woningen', async () => {
  const t = rhadixToken({ tenant_id: ORG_A });
  assert.deepEqual(await namen(t, '/api/kantoren', 'merknaam'), ['Kantoor A']);
  assert.deepEqual(await namen(t, '/api/projecten', 'naam'), ['Woning A']);
  assert.equal((await als(t, `/api/kantoren/${B}`)).statusCode, 404, 'bestaan van een ander kantoor wordt niet verraden');
  const tb = rhadixToken({ tenant_id: ORG_B, role: 'ORG_ADMIN' });
  assert.deepEqual(await namen(tb, '/api/projecten', 'naam'), ['Woning B']);
});

test('kantoorbeheerder (ORG_ADMIN) heeft dezelfde grenzen als in de eerste fase: niets wijzigen', async () => {
  const t = rhadixToken({ tenant_id: ORG_A, role: 'ORG_ADMIN' });
  const ik = (await als(t, '/api/ik')).json();
  assert.equal(ik.kantoren[0].rol, 'kantoorbeheerder');
  const r = await app.inject({ method: 'PUT', url: `/api/kantoren/${A}`, headers: { cookie: ssoCookie(t), origin: HERKOMST }, payload: { merknaam: 'X' } });
  assert.equal(r.statusCode, 403);
  const k = await app.inject({ method: 'PUT', url: `/api/kantoren/${A}/rhadix-organisatie`, headers: { cookie: ssoCookie(t), origin: HERKOMST }, payload: { tenant_id: null } });
  assert.equal(k.statusCode, 403, 'koppelen is alleen voor platformbeheer');
});

test('RHADIX_ADMIN wordt platformbeheer en ziet alle kantoren; geen lidmaatschap nodig', async () => {
  const t = rhadixToken({ role: 'RHADIX_ADMIN', tenant_name: 'Rhadix' });
  const ik = (await als(t, '/api/ik')).json();
  assert.equal(ik.platformbeheer, true);
  assert.deepEqual(ik.kantoren, []);
  assert.deepEqual(await namen(t, '/api/kantoren', 'merknaam'), ['Kantoor A', 'Kantoor B']);
});

test('toegang alleen via de apps-claim, ook voor RHADIX_ADMIN (geen rol-bypass)', async () => {
  for (const claims of [{ apps: ['datavalidatie', 'rhadix-crm'] }, { apps: [] }, { apps: 'rhadix-makelaarsportaal' }, { role: 'RHADIX_ADMIN', apps: ['datavalidatie'] }]) {
    const r = await als(rhadixToken({ tenant_id: ORG_A, ...claims }), '/api/ik');
    assert.equal(r.statusCode, 403, JSON.stringify(claims));
    assert.equal(r.json().sso, 'geen-toegang');
  }
});

test('ongeldige tokens geven 401: andere sleutel, uitgever, verlopen, HS256, none, gewijzigde inhoud', async () => {
  const ander = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const goed = rhadixToken({ tenant_id: ORG_A });
  const [kop, , sig] = goed.split('.');
  const nep = Buffer.from(JSON.stringify({ sub: randomUUID(), role: 'RHADIX_ADMIN', tenant_id: ORG_A, email: 'x@y.z', apps: ['rhadix-makelaarsportaal'], iss: 'suresync-id', exp: 4e9 })).toString('base64url');
  const hs = (() => {
    const k = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const p = nep;
    return `${k}.${p}.${createHmac('sha256', config.sso.sleutel!).update(`${k}.${p}`).digest('base64url')}`;
  })();
  const geen = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${nep}.`;
  for (const [naam, t] of [
    ['andere sleutel', rhadixToken({ tenant_id: ORG_A }, { sleutel: ander })],
    ['andere uitgever', rhadixToken({ tenant_id: ORG_A, iss: 'iemand-anders' })],
    ['verlopen', rhadixToken({ tenant_id: ORG_A, exp: Math.floor(Date.now() / 1000) - 120 })],
    ['nog niet geldig', rhadixToken({ tenant_id: ORG_A, nbf: Math.floor(Date.now() / 1000) + 600 })],
    ['HS256 met de publieke sleutel als geheim', hs],
    ['alg none', geen],
    ['gewijzigde inhoud', `${kop}.${nep}.${sig}`],
    ['zonder tenant_id', rhadixToken({ tenant_id: undefined })],
    ['onzin', 'abc.def.ghi'],
  ] as const) {
    const r = await als(t, '/api/ik');
    assert.equal(r.statusCode, 401, naam);
  }
});

test('machinetokens en RSO-beheer krijgen geen toegang', async () => {
  for (const claims of [{ typ: 'machine' }, { typ: 'client' }, { scope: 'external' }]) {
    const r = await als(rhadixToken({ tenant_id: ORG_A, ...claims }), '/api/ik');
    assert.equal(r.statusCode, 403, JSON.stringify(claims));
  }
  const rso = await als(rhadixToken({ tenant_id: ORG_A, role: 'RSO_ADMIN' }), '/api/ik');
  assert.equal(rso.statusCode, 403);
  assert.equal(rso.json().sso, 'rso');
});

test('koppeling op organisatie-ID, nooit op naam; platformbeheer koppelt een nieuwe organisatie', async () => {
  const ORG_C = randomUUID();
  // Zelfde naam als een gekoppelde organisatie, ander ID: komt NIET in dat kantoor.
  const t = rhadixToken({ tenant_id: ORG_C, tenant_name: 'Kantoor A' });
  const r = await als(t, '/api/ik');
  assert.equal(r.statusCode, 403);
  assert.equal(r.json().sso, 'niet-gekoppeld');
  assert.match((await app.inject({ method: 'GET', url: '/api/inlogopties', headers: { cookie: ssoCookie(t) } })).json().melding, /nog niet aan een kantoor/);

  const beheer = rhadixToken({ role: 'RHADIX_ADMIN' });
  const lijst = (await als(beheer, '/api/rhadix-organisaties')).json();
  assert.ok(lijst.some((o: { tenant_id: string; kantoor_id: string | null }) => o.tenant_id === ORG_C && o.kantoor_id === null), 'organisatie zichtbaar voor platformbeheer');
  const C = await maakKantoorDirect('Kantoor C', 'sso-c');
  const dubbel = await app.inject({ method: 'PUT', url: `/api/kantoren/${C}/rhadix-organisatie`, headers: { cookie: ssoCookie(beheer), origin: HERKOMST }, payload: { tenant_id: ORG_A } });
  assert.equal(dubbel.statusCode, 409, 'een organisatie hoort bij één kantoor');
  const k = await app.inject({ method: 'PUT', url: `/api/kantoren/${C}/rhadix-organisatie`, headers: { cookie: ssoCookie(beheer), origin: HERKOMST }, payload: { tenant_id: ORG_C } });
  assert.equal(k.statusCode, 200);
  const ik = (await als(t, '/api/ik')).json();
  assert.deepEqual(ik.kantoren.map((x: { naam: string }) => x.naam), ['Kantoor C']);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM auditregel WHERE actie = 'rhadix-koppeling'")).rows[0].n, 1);
});

test('rol en organisatie volgen het token: een nieuwe rol of organisatie past het lidmaatschap aan', async () => {
  const sub = randomUUID(), email = 'wisselaar@rhadix.test';
  const kantoren = async (claims: Record<string, unknown>) =>
    (await als(rhadixToken({ sub, email, ...claims }), '/api/ik')).json().kantoren.map((k: { naam: string; rol: string }) => `${k.naam}:${k.rol}`);
  assert.deepEqual(await kantoren({ tenant_id: ORG_A, role: 'ORG_USER' }), ['Kantoor A:makelaar']);
  assert.deepEqual(await kantoren({ tenant_id: ORG_A, role: 'ORG_ADMIN' }), ['Kantoor A:kantoorbeheerder']);
  assert.deepEqual(await kantoren({ tenant_id: ORG_B, role: 'ORG_USER' }), ['Kantoor B:makelaar'], 'verhuisd: kantoor A is weg');
  const t = rhadixToken({ sub, email, tenant_id: ORG_B });
  assert.deepEqual(await namen(t, '/api/projecten', 'naam'), ['Woning B']);
});

test('ontkoppelen of een inactief kantoor neemt de toegang weg', async () => {
  const ORG_D = randomUUID();
  const D = await maakKantoorDirect('Kantoor D', 'sso-d');
  await pool.query('UPDATE kantoor SET rhadix_tenant_id = $2 WHERE id = $1', [D, ORG_D]);
  const t = rhadixToken({ tenant_id: ORG_D });
  assert.equal((await als(t, '/api/ik')).statusCode, 200);
  await pool.query("UPDATE kantoor SET status = 'inactief' WHERE id = $1", [D]);
  wisSsoCache();
  assert.equal((await als(t, '/api/ik')).statusCode, 403);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM lidmaatschap WHERE kantoor_id = $1', [D])).rows[0].n, 0);
});

test('een bestaand portaalaccount met hetzelfde e-mailadres wordt niet stilzwijgend overgenomen', async () => {
  await maakGebruiker('bestaand@rhadix.test', { kantoren: [[A, 'makelaar']] });
  const r = await als(rhadixToken({ tenant_id: ORG_A, email: 'bestaand@rhadix.test' }), '/api/ik');
  assert.equal(r.statusCode, 403);
  assert.equal(r.json().sso, 'conflict');
});

test('een in het portaal geblokkeerde gebruiker blijft geblokkeerd, ook met een geldig token', async () => {
  const sub = randomUUID();
  assert.equal((await als(rhadixToken({ sub, tenant_id: ORG_A }), '/api/ik')).statusCode, 200);
  await pool.query("UPDATE gebruiker SET actief = false WHERE extern_bron = 'rhadix' AND extern_id = $1", [sub]);
  assert.equal((await als(rhadixToken({ sub, tenant_id: ORG_A, exp: Math.floor(Date.now() / 1000) + 1800 }), '/api/ik')).statusCode, 403);
});

test('wijzigen met het Rhadix-cookie alleen vanaf de eigen herkomst (niet zonder Origin, niet vanaf een andere rhadix.nl-app)', async () => {
  const beheer = rhadixToken({ role: 'RHADIX_ADMIN' });
  const verzoek = (origin?: string) => app.inject({ method: 'PUT', url: `/api/kantoren/${A}/rhadix-organisatie`,
    headers: { cookie: ssoCookie(beheer), ...(origin ? { origin } : {}) }, payload: { tenant_id: ORG_A } });
  assert.equal((await verzoek()).statusCode, 403);
  assert.equal((await verzoek('https://crm.rhadix.nl')).statusCode, 403);
  assert.equal((await verzoek(HERKOMST)).statusCode, 200);
});

test('noodtoegang (STUDIO_LOKALE_LOGIN=tunnel): eigen login alleen via 127.0.0.1, nooit via de publieke naam of Cloudflare', async () => {
  await maakGebruiker('nood@studio.test', { platform: true });
  const cookie = await login(app, 'nood@studio.test');
  const vorig = config.lokaleLogin;
  config.lokaleLogin = 'tunnel';
  try {
    const inloggen = (host: string, extra: Record<string, string> = {}) =>
      app.inject({ method: 'POST', url: '/api/inloggen', headers: { host, ...extra }, payload: { email: 'nood@studio.test', wachtwoord: WACHTWOORD } });
    assert.equal((await inloggen('makelaarsportaal-test.rhadix.nl')).statusCode, 403);
    assert.equal((await inloggen('127.0.0.1', { 'cf-connecting-ip': '198.51.100.7' })).statusCode, 403);
    assert.equal((await inloggen('127.0.0.1')).statusCode, 200);
    // Een bestaande eigen sessie telt ook alleen via de tunnel.
    assert.equal((await app.inject({ method: 'GET', url: '/api/ik', headers: { cookie, host: 'makelaarsportaal-test.rhadix.nl' } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/api/ik', headers: { cookie, host: '127.0.0.1:8581' } })).statusCode, 200);
    const opties = (await app.inject({ method: 'GET', url: '/api/inlogopties', headers: { host: 'makelaarsportaal-test.rhadix.nl' } })).json();
    assert.deepEqual(opties, { rhadix: 'https://platform.rhadix.invalid', lokaal: false, melding: null });
  } finally { config.lokaleLogin = vorig; }
});
