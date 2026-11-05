// Makelaarskantoren: invoercontrole en databasebewerkingen. Alles loopt via alsGebruiker(), dus
// de database bepaalt wie welk kantoor ziet en wie mag wijzigen (RLS).
import type pg from 'pg';
import { audit } from './db.ts';

export type KantoorInvoer = {
  merknaam: string; juridische_naam: string | null; slug: string; telefoon: string | null; email: string | null; website: string | null;
  adresregels: string[]; standaard_profiel: string | null; merkkleur: string | null; status: 'actief' | 'inactief';
};

export const maakSlug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' en ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');

const leeg = (v: unknown) => (typeof v === 'string' ? v.trim() : '') || null;

/** Controleert de invoer; geeft de opgeschoonde gegevens of een lijst met fouten per veld. */
export function valideerKantoor(b: Record<string, unknown>, profielen: string[]):
  { ok: true; kantoor: KantoorInvoer } | { ok: false; fouten: Record<string, string> } {
  const f: Record<string, string> = {};
  const merknaam = leeg(b.merknaam);
  if (!merknaam) f.merknaam = 'Merknaam is verplicht';
  else if (merknaam.length > 120) f.merknaam = 'Merknaam is te lang (maximaal 120 tekens)';
  const juridische_naam = leeg(b.juridische_naam);
  if (juridische_naam && juridische_naam.length > 160) f.juridische_naam = 'Juridische naam is te lang (maximaal 160 tekens)';
  const slug = leeg(b.slug) ?? (merknaam ? maakSlug(merknaam) : null);
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) f.slug = 'Alleen kleine letters, cijfers en koppeltekens';
  const email = leeg(b.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) f.email = 'Geen geldig e-mailadres';
  const website = leeg(b.website);
  if (website && !/^https?:\/\/[^\s]+\.[^\s]+$/.test(website)) f.website = 'Begin met https:// (bijvoorbeeld https://www.kantoor.nl)';
  const telefoon = leeg(b.telefoon);
  if (telefoon && !/^[+0-9 ()-]{6,20}$/.test(telefoon)) f.telefoon = 'Alleen cijfers, spaties, +, - en haakjes';
  const adres = Array.isArray(b.adresregels) ? b.adresregels : [];
  const adresregels = adres.map(leeg).filter((x): x is string => !!x);
  if (adres.some((x) => typeof x !== 'string') || adresregels.length > 4) f.adresregels = 'Hooguit vier adresregels';
  const standaard_profiel = leeg(b.standaard_profiel);
  if (standaard_profiel && !profielen.includes(standaard_profiel)) f.standaard_profiel = `Kies uit: ${profielen.join(', ')}`;
  const merkkleur = leeg(b.merkkleur);
  if (merkkleur && !/^#[0-9A-Fa-f]{6}$/.test(merkkleur)) f.merkkleur = 'Gebruik een hexkleur, bijvoorbeeld #1A2847';
  const status = (leeg(b.status) ?? 'actief') as KantoorInvoer['status'];
  if (!['actief', 'inactief'].includes(status)) f.status = 'Actief of inactief';
  if (Object.keys(f).length) return { ok: false, fouten: f };
  return { ok: true, kantoor: { merknaam: merknaam!, juridische_naam, slug: slug!, telefoon, email, website, adresregels, standaard_profiel, merkkleur: merkkleur?.toUpperCase() ?? null, status } };
}

const VELDEN = 'id, merknaam, juridische_naam, slug, telefoon, email, website, adresregels, standaard_profiel, merkkleur, status, aangemaakt_op, gewijzigd_op';

export async function lijstKantoren(c: pg.PoolClient) {
  return (await c.query(`SELECT ${VELDEN}, (SELECT count(*)::int FROM lidmaatschap l WHERE l.kantoor_id = k.id) AS gebruikers
    FROM kantoor k ORDER BY lower(merknaam)`)).rows;
}

export async function leesKantoor(c: pg.PoolClient, id: string) {
  const k = (await c.query(`SELECT ${VELDEN} FROM kantoor WHERE id = $1`, [id])).rows[0];
  if (!k) return null;
  const leden = (await c.query(`SELECT g.id, g.naam, g.email, l.rol FROM lidmaatschap l JOIN gebruiker g ON g.id = l.gebruiker_id
    WHERE l.kantoor_id = $1 ORDER BY lower(g.naam)`, [id])).rows;
  return { ...k, leden };
}

export async function maakKantoor(c: pg.PoolClient, gebruiker: string, k: KantoorInvoer) {
  const r = (await c.query(`INSERT INTO kantoor (merknaam, juridische_naam, slug, telefoon, email, website, adresregels, standaard_profiel, merkkleur, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${VELDEN}`,
    [k.merknaam, k.juridische_naam, k.slug, k.telefoon, k.email, k.website, k.adresregels, k.standaard_profiel, k.merkkleur, k.status])).rows[0];
  await audit(c, { gebruiker, actie: 'aanmaken', tabel: 'kantoor', id: r.id, nieuw: r });
  return r;
}

export async function wijzigKantoor(c: pg.PoolClient, gebruiker: string, id: string, k: KantoorInvoer) {
  const oud = (await c.query(`SELECT ${VELDEN} FROM kantoor WHERE id = $1`, [id])).rows[0];
  if (!oud) return null;
  const r = (await c.query(`UPDATE kantoor SET merknaam = $2, juridische_naam = $3, slug = $4, telefoon = $5, email = $6, website = $7, adresregels = $8,
    standaard_profiel = $9, merkkleur = $10, status = $11, gewijzigd_op = now() WHERE id = $1 RETURNING ${VELDEN}`,
    [id, k.merknaam, k.juridische_naam, k.slug, k.telefoon, k.email, k.website, k.adresregels, k.standaard_profiel, k.merkkleur, k.status])).rows[0];
  if (!r) return 'geweigerd' as const;
  await audit(c, { gebruiker, actie: 'wijzigen', tabel: 'kantoor', id, oud, nieuw: r });
  return r;
}
