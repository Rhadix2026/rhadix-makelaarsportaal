// Gedeelde testhulp: gebruikers en kantoren aanmaken via de systeemverbinding, en inloggen via de API.
import type { FastifyInstance } from 'fastify';
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
  return (await pool.query('INSERT INTO kantoor (naam, slug) VALUES ($1, $2) RETURNING id', [naam, slug])).rows[0].id as string;
}

/** Logt in en geeft het cookie terug voor volgende verzoeken. */
export async function login(app: FastifyInstance, email: string, wachtwoord = WACHTWOORD) {
  const r = await app.inject({ method: 'POST', url: '/api/inloggen', payload: { email, wachtwoord } });
  if (r.statusCode !== 200) throw new Error(`inloggen ${email}: ${r.statusCode} ${r.body}`);
  return (r.headers['set-cookie'] as string).split(';')[0];
}
