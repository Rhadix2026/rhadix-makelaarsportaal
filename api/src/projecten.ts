// Woningprojecten: invoercontrole, standaardwaarden van het kantoor en databasebewerkingen.
// Alles via alsGebruiker(): RLS bepaalt welke projecten iemand ziet en wie mag schrijven.
//
// Kantoorinstellingen zijn standaardwaarden: bij het aanmaken neemt een project het
// standaardprofiel van het kantoor over (als kopie). Een wijziging per woning raakt het kantoor
// nooit, en een latere wijziging van het kantoor verandert bestaande projecten niet.
import type pg from 'pg';
import { audit } from './db.ts';
import { maakSlug } from './kantoren.ts';
import { vanFormulier } from './gegevens.ts';

export const WONINGTYPEN = ['vrijstaand', 'twee-onder-een-kap', 'geschakeld', 'tussenwoning', 'hoekwoning',
  'appartement', 'maisonnette', 'boerderij', 'landgoed', 'overig'] as const;

/** Statussen volgens FO 2.0 §4, in volgorde van het productieproces. */
export const STATUSSEN = [
  ['aanlevering_incompleet', 'Aanlevering incompleet'], ['klaar_voor_productie', 'Klaar voor productie'],
  ['in_productie', 'In productie'], ['interne_review', 'Interne review'], ['ter_review', 'Ter review makelaar'],
  ['correctie', 'Correctie'], ['goedgekeurd', 'Goedgekeurd'], ['publicatiecontrole', 'Publicatiecontrole'],
  ['live', 'Live'], ['onder_bod', 'Onder bod'], ['verkocht', 'Verkocht'], ['offline', 'Offline'], ['archief', 'Archief'],
] as const;
export type Status = (typeof STATUSSEN)[number][0];

/** Slugs die nooit voor een studioproject mogen worden gebruikt (referentiewoningen, gereserveerd). */
export const GERESERVEERD = ['beusemkolkweg-16', 'landgoed-rhoderlanden', 'markt-27-wolvega', '_voorbeeld'];
export const gereserveerd = (s: string) => GERESERVEERD.includes(s) || /^(kalibratie|import|probe)-/.test(s);

export type ProjectInvoer = {
  kantoor_id: string; naam: string; slug: string | null; adres: string | null; postcode: string | null; plaats: string | null;
  woningtype: string | null; profiel: string | null; domein: string | null; contactpersoon: string | null;
  /** Geen profiel meegestuurd: het standaardprofiel van het kantoor geldt. Leeg meegestuurd = 'Nog niet gekozen'. */
  profiel_van_kantoor: boolean;
};

const leeg = (v: unknown) => (typeof v === 'string' ? v.trim() : '') || null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normaliseerPostcode(p: string) {
  const m = p.toUpperCase().replace(/\s+/g, '').match(/^([1-9][0-9]{3})([A-Z]{2})$/);
  return m ? `${m[1]} ${m[2]}` : null;
}

export function valideerProject(b: Record<string, unknown>, profielen: string[]):
  { ok: true; project: ProjectInvoer } | { ok: false; fouten: Record<string, string> } {
  const f: Record<string, string> = {};
  const kantoor_id = leeg(b.kantoor_id);
  if (!kantoor_id || !UUID.test(kantoor_id)) f.kantoor_id = 'Kies een makelaarskantoor';
  const naam = leeg(b.naam);
  if (!naam) f.naam = 'Naam van de woning is verplicht';
  else if (naam.length > 120) f.naam = 'Te lang (maximaal 120 tekens)';
  const slug = leeg(b.slug);
  if (slug && (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 80)) f.slug = 'Alleen kleine letters, cijfers en koppeltekens';
  else if (slug && gereserveerd(slug)) f.slug = 'Deze korte naam is gereserveerd (referentiewoning of systeemnaam)';
  const postcodeIn = leeg(b.postcode);
  const postcode = postcodeIn ? normaliseerPostcode(postcodeIn) : null;
  if (postcodeIn && !postcode) f.postcode = 'Gebruik 1234 AB';
  const woningtype = leeg(b.woningtype);
  if (woningtype && !(WONINGTYPEN as readonly string[]).includes(woningtype)) f.woningtype = 'Kies een woningtype uit de lijst';
  const profiel = leeg(b.profiel);
  if (profiel && !profielen.includes(profiel)) f.profiel = `Kies uit de presentatieprofielen: ${profielen.join(', ')}`;
  const domeinIn = leeg(b.domein)?.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') ?? null;
  if (domeinIn && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domeinIn)) f.domein = 'Geen geldige domeinnaam (bijvoorbeeld voorbeeldweg1.nl)';
  for (const [k, max] of [['adres', 160], ['plaats', 80], ['contactpersoon', 120]] as const) {
    const v = leeg(b[k]); if (v && v.length > max) f[k] = `Te lang (maximaal ${max} tekens)`;
  }
  if (Object.keys(f).length) return { ok: false, fouten: f };
  return { ok: true, project: { kantoor_id: kantoor_id!, naam: naam!, slug, adres: leeg(b.adres), postcode, plaats: leeg(b.plaats),
    woningtype, profiel, domein: domeinIn, contactpersoon: leeg(b.contactpersoon), profiel_van_kantoor: !('profiel' in b) } };
}

const VELDEN = `p.id, p.kantoor_id, k.merknaam AS kantoor, k.slug AS kantoor_slug, p.slug, p.naam, p.adres, p.postcode, p.plaats,
  p.woningtype, p.profiel, p.ontwerpsysteem, p.domein, p.contactpersoon, p.status, p.aangemaakt_op, p.gewijzigd_op,
  EXISTS (SELECT 1 FROM bestand b WHERE b.project_id = p.id) AS aanlevering_gestart,
  (SELECT count(*)::int FROM concept c WHERE c.project_id = p.id) AS concepten`;

export async function lijstProjecten(c: pg.PoolClient, filter: { kantoor?: string; status?: string; zoek?: string }) {
  const w: string[] = [], v: unknown[] = [];
  if (filter.kantoor && UUID.test(filter.kantoor)) { v.push(filter.kantoor); w.push(`p.kantoor_id = $${v.length}`); }
  if (filter.status && STATUSSEN.some(([s]) => s === filter.status)) { v.push(filter.status); w.push(`p.status = $${v.length}`); }
  if (filter.zoek?.trim()) {
    v.push(`%${filter.zoek.trim().replace(/[\\%_]/g, (x) => `\\${x}`)}%`);
    w.push(`(p.naam ILIKE $${v.length} OR p.adres ILIKE $${v.length} OR p.plaats ILIKE $${v.length} OR p.slug ILIKE $${v.length})`);
  }
  return (await c.query(`SELECT ${VELDEN} FROM project p JOIN kantoor k ON k.id = p.kantoor_id
    ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY p.gewijzigd_op DESC`, v)).rows;
}

export async function telling(c: pg.PoolClient) {
  return Object.fromEntries((await c.query('SELECT status, count(*)::int AS n FROM project GROUP BY status')).rows.map((r) => [r.status, r.n]));
}

export async function leesProject(c: pg.PoolClient, id: string) {
  if (!UUID.test(id)) return null;
  return (await c.query(`SELECT ${VELDEN} FROM project p JOIN kantoor k ON k.id = p.kantoor_id WHERE p.id = $1`, [id])).rows[0] ?? null;
}

/** Nieuw project. Profiel leeg = standaardprofiel van het kantoor (kopie). Ontwerpsysteem = standaard van de generator. */
export async function maakProject(c: pg.PoolClient, gebruiker: string, p: ProjectInvoer, ontwerpsysteem: string) {
  const k = (await c.query('SELECT slug, standaard_profiel, status FROM kantoor WHERE id = $1', [p.kantoor_id])).rows[0];
  if (!k) return { fout: 'kantoor' as const };
  if (k.status !== 'actief') return { fout: 'inactief' as const };
  const slug = p.slug ?? `${k.slug}-${maakSlug(p.naam)}`.slice(0, 80).replace(/-+$/, '');
  if (gereserveerd(slug)) return { fout: 'gereserveerd' as const };
  const r = (await c.query(`INSERT INTO project (kantoor_id, slug, naam, adres, postcode, plaats, woningtype, profiel, ontwerpsysteem, domein, contactpersoon, aangemaakt_door)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [p.kantoor_id, slug, p.naam, p.adres, p.postcode, p.plaats, p.woningtype, p.profiel_van_kantoor ? k.standaard_profiel : p.profiel, ontwerpsysteem, p.domein, p.contactpersoon, gebruiker])).rows[0];
  const nieuw = await leesProject(c, r.id);
  await vanFormulier(c, gebruiker, nieuw, null, nieuw);
  await audit(c, { gebruiker, actie: 'aanmaken', tabel: 'project', id: r.id, nieuw });
  return { project: nieuw };
}

/**
 * Wijzigen. De slug en het ontwerpsysteem liggen vast na het aanmaken (mapnaam en vastgezette
 * versie). Het kantoor mag alleen wijzigen zolang de aanlevering nog niet begonnen is.
 */
export async function wijzigProject(c: pg.PoolClient, gebruiker: string, id: string, p: ProjectInvoer) {
  const oud = await leesProject(c, id);
  if (!oud) return { fout: 'onbekend' as const };
  if (p.kantoor_id !== oud.kantoor_id) {
    // Vast zodra er iets is aangeleverd: bestanden en gegevens horen dan bij dit kantoor.
    if (oud.status !== 'aanlevering_incompleet' || oud.aanlevering_gestart) return { fout: 'kantoor_vast' as const };
    const k = (await c.query('SELECT status FROM kantoor WHERE id = $1', [p.kantoor_id])).rows[0];
    if (!k) return { fout: 'kantoor' as const };
    if (k.status !== 'actief') return { fout: 'inactief' as const };
  }
  const r = await c.query(`UPDATE project SET kantoor_id = $2, naam = $3, adres = $4, postcode = $5, plaats = $6, woningtype = $7,
    profiel = $8, domein = $9, contactpersoon = $10, gewijzigd_op = now() WHERE id = $1`,
    [id, p.kantoor_id, p.naam, p.adres, p.postcode, p.plaats, p.woningtype, p.profiel, p.domein, p.contactpersoon]);
  if (!r.rowCount) return { fout: 'geweigerd' as const };
  const nieuw = await leesProject(c, id);
  await vanFormulier(c, gebruiker, nieuw, oud, nieuw);
  await audit(c, { gebruiker, actie: 'wijzigen', tabel: 'project', id, oud, nieuw });
  return { project: nieuw };
}
