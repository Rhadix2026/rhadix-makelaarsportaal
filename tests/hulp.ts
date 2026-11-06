// Gedeelde testhulp: gebruikers en kantoren aanmaken via de systeemverbinding, en inloggen via de API.
import type { FastifyInstance } from 'fastify';
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { pool } from '../api/src/db.ts';

// Beveiliging: tests draaien alleen tegen de testdatabase (ingesteld via --import ./tests/omgeving.ts).
if (!process.env.STUDIO_DB_URL?.endsWith('/studio_test')) throw new Error('tests moeten tegen studio_test draaien: gebruik npm test');
const db = (await pool.query('SELECT current_database() AS d')).rows[0].d;
if (db !== 'studio_test') throw new Error(`tests zijn verbonden met '${db}' in plaats van studio_test`);
import { hashWachtwoord } from '../api/src/auth.ts';

export const WACHTWOORD = 'test-wachtwoord-123';
let hash: Promise<string> | null = null;

export async function maakGebruiker(email: string, o: { platform?: boolean; kantoren?: [string, string][]; actief?: boolean } = {}) {
  hash ??= hashWachtwoord(WACHTWOORD);
  const g = (await pool.query(`INSERT INTO gebruiker (email, naam, wachtwoord_hash, platformrol, actief) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [email, email.split('@')[0], await hash, o.platform ? 'platformbeheer' : null, o.actief ?? true])).rows[0];
  for (const [kantoor, rol] of o.kantoren ?? [])
    await pool.query('INSERT INTO lidmaatschap (gebruiker_id, kantoor_id, rol) VALUES ($1, $2, $3)', [g.id, kantoor, rol]);
  return g.id as string;
}

export async function maakKantoorDirect(naam: string, slug: string) {
  return (await pool.query('INSERT INTO kantoor (merknaam, slug) VALUES ($1, $2) RETURNING id', [naam, slug])).rows[0].id as string;
}

/** Logt in en geeft het cookie terug voor volgende verzoeken. */
export async function login(app: FastifyInstance, email: string, wachtwoord = WACHTWOORD) {
  const r = await app.inject({ method: 'POST', url: '/api/inloggen', payload: { email, wachtwoord } });
  if (r.statusCode !== 200) throw new Error(`inloggen ${email}: ${r.statusCode} ${r.body}`);
  return (r.headers['set-cookie'] as string).split(';')[0];
}

// ── Centrale Rhadix-login: testtokens, getekend met het tijdelijke testsleutelpaar (tests/omgeving.ts) ──

const b64u = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
export type TestClaims = Record<string, unknown>;

/** Een token zoals Datavalidatie het uitgeeft (RS256, iss suresync-id), met overschrijfbare claims. */
export function rhadixToken(claims: TestClaims = {}, o: { sleutel?: string; kop?: Record<string, unknown> } = {}) {
  const nu = Math.floor(Date.now() / 1000);
  const p = { sub: randomUUID(), role: 'ORG_USER', tenant_id: randomUUID(), tenant_name: 'Testorganisatie', email: `${randomUUID().slice(0, 8)}@rhadix.test`,
    name: 'Test Gebruiker', apps: ['rhadix-makelaarsportaal'], iss: 'suresync-id', exp: nu + 3600, ...claims };
  const kop = { alg: 'RS256', typ: 'JWT', kid: 'suresync-id-1', ...o.kop };
  const inhoud = `${b64u(kop)}.${b64u(p)}`;
  const handtekening = sign('RSA-SHA256', Buffer.from(inhoud), createPrivateKey(o.sleutel ?? process.env.TEST_SSO_PRIVE!)).toString('base64url');
  return `${inhoud}.${handtekening}`;
}
export const ssoCookie = (token: string) => `rhadix_sso_test=${token}`;
