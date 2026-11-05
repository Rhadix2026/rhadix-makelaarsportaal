// Authenticatie zonder externe dienst: wachtwoord (scrypt, ingebouwd in Node) en een sessie in
// een HttpOnly-cookie. Alleen de hash van het sessietoken staat in de database.
//
// Uitbreidbaar met SSO: een gebruiker kan in plaats van een wachtwoord een externe identiteit
// hebben (gebruiker.extern_bron + extern_id). Een SSO-koppeling maakt na een geslaagde aanmelding
// bij de identiteitsprovider via maakSessie() dezelfde sessie aan, met methode 'oidc'. De rest
// van de studio merkt daar niets van.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from './db.ts';

const scrypt = promisify(scryptCb) as (w: string, s: Buffer, n: number, o: object) => Promise<Buffer>;

export const COOKIE = 'studio_sessie';
export const SESSIEDUUR_MS = 12 * 60 * 60e3;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, lengte: 64 };
export const MIN_WACHTWOORD = 12;

export async function hashWachtwoord(wachtwoord: string): Promise<string> {
  const zout = randomBytes(16);
  const h = await scrypt(wachtwoord, zout, SCRYPT.lengte, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * SCRYPT.N * SCRYPT.r * 2 });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, zout.toString('base64'), h.toString('base64')].join('$');
}

export async function controleerWachtwoord(wachtwoord: string, opgeslagen: string): Promise<boolean> {
  const [soort, N, r, p, zout, hash] = opgeslagen.split('$');
  if (soort !== 'scrypt') return false;
  const verwacht = Buffer.from(hash, 'base64');
  const h = await scrypt(wachtwoord, Buffer.from(zout, 'base64'), verwacht.length, { N: +N, r: +r, p: +p, maxmem: 128 * +N * +r * 2 });
  return h.length === verwacht.length && timingSafeEqual(h, verwacht);
}

// Een vaste dummy-hash: ook bij een onbekend e-mailadres kost de controle even lang.
let dummy: Promise<string> | null = null;

const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex');

// Eenvoudige rem op raden: na 5 mislukte pogingen per e-mailadres 15 minuten blokkeren.
// In het geheugen; voldoende voor de lokale eerste fase (één proces).
const POGINGEN = 5, BLOKKADE_MS = 15 * 60e3;
const mislukt = new Map<string, { n: number; sinds: number }>();
export function geblokkeerd(email: string, nu = Date.now()) {
  const m = mislukt.get(email.toLowerCase());
  if (!m) return false;
  if (nu - m.sinds > BLOKKADE_MS) { mislukt.delete(email.toLowerCase()); return false; }
  return m.n >= POGINGEN;
}
function registreerMislukt(email: string) {
  const k = email.toLowerCase(), m = mislukt.get(k);
  if (!m || Date.now() - m.sinds > BLOKKADE_MS) mislukt.set(k, { n: 1, sinds: Date.now() });
  else m.n++;
}
export function wisPogingen() { mislukt.clear(); }

export type Aanmelding = { ok: true; token: string; gebruikerId: string } | { ok: false; reden: 'onjuist' | 'geblokkeerd' };

/** Inloggen met e-mail en wachtwoord. Eén algemene foutmelding: verraadt niet of het adres bestaat. */
export async function meldAan(email: string, wachtwoord: string): Promise<Aanmelding> {
  if (geblokkeerd(email)) return { ok: false, reden: 'geblokkeerd' };
  const r = await pool.query('SELECT id, wachtwoord_hash, actief FROM gebruiker WHERE lower(email) = lower($1)', [email]);
  const g = r.rows[0];
  dummy ??= hashWachtwoord(randomBytes(16).toString('hex'));
  const goed = await controleerWachtwoord(wachtwoord, g?.wachtwoord_hash ?? await dummy);
  if (!g || !g.actief || !g.wachtwoord_hash || !goed) { registreerMislukt(email); return { ok: false, reden: 'onjuist' }; }
  mislukt.delete(email.toLowerCase());
  return { ok: true, token: await maakSessie(g.id, 'wachtwoord'), gebruikerId: g.id };
}

export async function maakSessie(gebruikerId: string, methode: 'wachtwoord' | 'oidc'): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO sessie (token_hash, gebruiker_id, methode, verloopt_op) VALUES ($1, $2, $3, $4)',
    [tokenHash(token), gebruikerId, methode, new Date(Date.now() + SESSIEDUUR_MS)]);
  return token;
}

/** Geeft de gebruiker bij een geldig, niet verlopen token van een actieve gebruiker. */
export async function sessieGebruiker(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const r = await pool.query(
    `SELECT s.gebruiker_id FROM sessie s JOIN gebruiker g ON g.id = s.gebruiker_id
     WHERE s.token_hash = $1 AND s.verloopt_op > now() AND g.actief`, [tokenHash(token)]);
  return r.rows[0]?.gebruiker_id ?? null;
}

export async function beeindigSessie(token: string | undefined) {
  if (token) await pool.query('DELETE FROM sessie WHERE token_hash = $1', [tokenHash(token)]);
}

export function leesCookie(header: string | undefined, naam = COOKIE): string | undefined {
  for (const deel of (header ?? '').split(';')) {
    const [k, ...v] = deel.trim().split('=');
    if (k === naam) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

// HttpOnly + SameSite=Strict. Geen Secure: de studio draait in deze fase op http://127.0.0.1.
export const sessieCookie = (token: string) =>
  `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSIEDUUR_MS / 1000}`;
export const wisCookie = () => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
