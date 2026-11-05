// Kantoorhuisstijl: logo uploaden en de kleuren afleiden met de bestaande functies van de
// generator (logoKleuren, huisstijlVoorstel; contrast ≥ 4,5:1 afgedwongen). Een voorstel uit het
// logo vult alleen lege kleuren; bestaande kleuren worden pas na bevestiging vervangen.
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { audit } from './db.ts';
import { huisstijlFuncties, profielen } from './generator.ts';
import { bewaar, herkenType, MAX_GROOTTE, opslagPad, sha256 } from './opslag.ts';

const STANDAARD_PROFIEL = 'buitenplaats';

async function voorstelUit(b: Buffer, profiel: string | null) {
  const h = await huisstijlFuncties();
  const kleuren = await h.logoKleuren(b);
  const v = h.huisstijlVoorstel(kleuren, h.laadProfiel(profiel ?? STANDAARD_PROFIEL));
  return { kleuren: kleuren.slice(0, 6), merk: v?.merk ?? null, detail: v?.detail ?? null, bron: v?.bron ?? 'geen verzadigde kleuren in het logo gevonden' };
}

async function zetLogo(c: pg.PoolClient, gebruiker: string, kantoorId: string, naam: string, b: Buffer, herkomst: 'upload' | 'brochure') {
  const k = (await c.query('SELECT id, standaard_profiel, merkkleur, detailkleur FROM kantoor WHERE id = $1', [kantoorId])).rows[0];
  if (!k) return { fout: 'onbekend' as const, melding: 'Kantoor niet gevonden' };
  if (b.length > MAX_GROOTTE.logo) return { fout: 'grootte' as const, melding: 'Te groot (maximaal 10 MB)' };
  const t = herkenType(b);
  if (!t || !['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(t.mime)) return { fout: 'type' as const, melding: 'Alleen PNG, JPEG, WebP of SVG' };
  let voorstel;
  try { voorstel = await voorstelUit(b, k.standaard_profiel); } catch { return { fout: 'beeld' as const, melding: 'Het logo is niet te lezen' }; }
  const hash = sha256(b);
  const rel = bewaar(`kantoren/${kantoorId}/${hash}.${t.ext}`, b);
  const bestand = (await c.query(`INSERT INTO bestand (kantoor_id, soort, herkomst, originele_naam, mime, grootte, sha256, opslag, geupload_door)
    VALUES ($1, 'logo', $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [kantoorId, herkomst, naam.slice(0, 200) || `logo.${t.ext}`, t.mime, b.length, hash, rel, gebruiker])).rows[0];
  // Lege kleuren worden aangevuld; ingestelde kleuren blijven staan tot het voorstel bevestigd wordt.
  const vullen = !k.merkkleur && !k.detailkleur && voorstel.merk;
  const r = (await c.query(`UPDATE kantoor SET logo_id = $2, huisstijl_voorstel = $3, gewijzigd_op = now()
    ${vullen ? ", merkkleur = $4, detailkleur = $5, huisstijl_herkomst = 'logo'" : ''} WHERE id = $1 RETURNING id`,
    [kantoorId, bestand.id, JSON.stringify(voorstel), ...(vullen ? [voorstel.merk, voorstel.detail] : [])])).rows[0];
  if (!r) return { fout: 'geweigerd' as const, melding: 'Geen rechten voor deze handeling' };
  await audit(c, { gebruiker, actie: 'logo', tabel: 'kantoor', id: kantoorId, nieuw: { bestand: bestand.id, herkomst, voorstel, aangevuld: !!vullen } });
  return { huisstijl: await leesHuisstijl(c, kantoorId) };
}

export const uploadLogo = (c: pg.PoolClient, g: string, kantoorId: string, naam: string, b: Buffer) => zetLogo(c, g, kantoorId, naam, b, 'upload');

/** Het logo dat de brochure-import vond, als kantoorlogo gebruiken (bewuste handeling). */
export async function logoUitBrochure(c: pg.PoolClient, gebruiker: string, kantoorId: string, bestandId: string) {
  const b = (await c.query("SELECT opslag, originele_naam FROM bestand WHERE id = $1 AND kantoor_id = $2 AND soort = 'logo' AND herkomst = 'brochure'", [bestandId, kantoorId])).rows[0];
  if (!b) return { fout: 'onbekend' as const, melding: 'Brochurelogo niet gevonden bij dit kantoor' };
  return zetLogo(c, gebruiker, kantoorId, `brochure-${b.originele_naam}`, readFileSync(opslagPad(b.opslag)), 'brochure');
}

/** Huidige huisstijl, het voorstel uit het logo en de toepassing per presentatieprofiel (contrast). */
export async function leesHuisstijl(c: pg.PoolClient, kantoorId: string) {
  const k = (await c.query(`SELECT k.id, k.merkkleur, k.detailkleur, k.huisstijl_herkomst, k.huisstijl_voorstel, k.logo_id, b.mime AS logo_mime, b.originele_naam AS logo_naam, b.herkomst AS logo_herkomst
    FROM kantoor k LEFT JOIN bestand b ON b.id = k.logo_id WHERE k.id = $1`, [kantoorId])).rows[0];
  if (!k) return null;
  const h = await huisstijlFuncties();
  const toepassing = [];
  if (k.merkkleur) for (const naam of await profielen()) {
    const p = h.laadProfiel(naam);
    const v = h.huisstijlVoorstel([{ kleur: k.merkkleur, aandeel: 1 }], p);
    if (!v) continue;
    toepassing.push({ profiel: naam,
      licht: { achtergrond: p.kleuren.licht.achtergrond, accent: v.licht.accent, contrast: +h.contrast(v.licht.accent, p.kleuren.licht.achtergrond).toFixed(1), aangepast: v.licht.accent !== k.merkkleur },
      donker: { achtergrond: p.kleuren.donker.achtergrond, accent: v.donker.accent, contrast: +h.contrast(v.donker.accent, p.kleuren.donker.achtergrond).toFixed(1), aangepast: v.donker.accent !== k.merkkleur } });
  }
  const vs = k.huisstijl_voorstel;
  return { merkkleur: k.merkkleur, detailkleur: k.detailkleur, herkomst: k.huisstijl_herkomst,
    logo: k.logo_id ? { id: k.logo_id, mime: k.logo_mime, naam: k.logo_naam, herkomst: k.logo_herkomst } : null,
    voorstel: vs, voorstel_wijkt_af: !!(vs?.merk && (vs.merk !== k.merkkleur || vs.detail !== k.detailkleur)), toepassing };
}

/** Voorstel uit het logo bevestigen (vervangt de huidige kleuren). */
export async function bevestigVoorstel(c: pg.PoolClient, gebruiker: string, kantoorId: string) {
  const oud = (await c.query('SELECT merkkleur, detailkleur, huisstijl_voorstel FROM kantoor WHERE id = $1', [kantoorId])).rows[0];
  if (!oud?.huisstijl_voorstel?.merk) return { fout: 'geen_voorstel' as const };
  const r = (await c.query(`UPDATE kantoor SET merkkleur = $2, detailkleur = $3, huisstijl_herkomst = 'logo', gewijzigd_op = now() WHERE id = $1 RETURNING id`,
    [kantoorId, oud.huisstijl_voorstel.merk, oud.huisstijl_voorstel.detail])).rows[0];
  if (!r) return { fout: 'geweigerd' as const };
  await audit(c, { gebruiker, actie: 'huisstijl_voorstel_bevestigd', tabel: 'kantoor', id: kantoorId, oud: { merkkleur: oud.merkkleur, detailkleur: oud.detailkleur },
    nieuw: { merkkleur: oud.huisstijl_voorstel.merk, detailkleur: oud.huisstijl_voorstel.detail } });
  return { huisstijl: await leesHuisstijl(c, kantoorId) };
}
