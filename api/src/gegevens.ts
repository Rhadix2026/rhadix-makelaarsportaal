// Vastgelegde woninggegevens (laag 3) en hun verhouding tot de brochure-extractie (laag 2).
//
// Regels:
//   - Een leeg gegeven wordt bij de import automatisch aangevuld: herkomst 'brochure', status 'overgenomen'.
//   - Een overgenomen (nog niet goedgekeurd) gegeven volgt een nieuwe import.
//   - Een handmatig ingevoerd of goedgekeurd gegeven wordt nooit automatisch vervangen; een
//     afwijkende brochurewaarde verschijnt als afwijking en kan alleen met bevestiging worden overgenomen.
//   - Adres, postcode, plaats en woningtype staan ook op het project (overzicht en filters); die
//     kolommen volgen het vastgelegde gegeven.
import type pg from 'pg';
import { audit } from './db.ts';
import { normaliseerPostcode, WONINGTYPEN } from './projecten.ts';

export const BASIS = { adres: 'Straat en huisnummer', postcode: 'Postcode', plaats: 'Plaats', woningtype: 'Woningtype' } as const;
type Basis = keyof typeof BASIS;
const isBasis = (s: string): s is Basis => s in BASIS;

export type Kandidaat = { sleutel: string; label: string; waarde: unknown; eenheid?: string | null; bron: string; zekerheid?: string; verificatie?: string; toelichting?: string };

/** Woningtype uit de brochureomschrijving ('Maisonnette', 'Bovenwoning', …); null als het niet eenduidig is. */
export function woningtypeUit(soort: string): string | null {
  const s = soort.toLowerCase();
  const regels: [RegExp, string][] = [
    [/maisonn?ette/, 'maisonnette'], [/twee-onder-een-kap|2-onder-1-kap|halfvrijstaand/, 'twee-onder-een-kap'],
    [/appartement|bovenwoning|benedenwoning|penthouse|portiek|flat|bovenhuis|benedenhuis/, 'appartement'],
    [/tussenwoning|rijtjeshuis/, 'tussenwoning'], [/hoekwoning/, 'hoekwoning'], [/geschakeld/, 'geschakeld'],
    [/boerderij|woonboerderij/, 'boerderij'], [/landgoed/, 'landgoed'], [/vrijstaand/, 'vrijstaand'],
  ];
  return regels.find(([rx]) => rx.test(s))?.[1] ?? null;
}

type Rapport = {
  gegevens: Record<string, { waarde: unknown; pagina?: number | string; zekerheid?: string }>;
  feiten: { sleutel: string; label: string; waarde: unknown; eenheid?: string; toelichting?: string; bron: string; zekerheid: string; verificatie: string }[];
};

/** De gegevens die de brochure-import heeft gevonden, als kandidaat per sleutel. */
export function kandidaten(r: Rapport): Kandidaat[] {
  const uit: Kandidaat[] = [];
  const a = r.gegevens.adres as { waarde: { straat?: string; postcode?: string | null; plaats?: string | null }; pagina?: number; zekerheid?: string } | undefined;
  if (a) {
    const bron = `brochure p. ${a.pagina}`;
    if (a.waarde.straat) uit.push({ sleutel: 'adres', label: BASIS.adres, waarde: a.waarde.straat, bron, zekerheid: a.zekerheid });
    if (a.waarde.postcode) uit.push({ sleutel: 'postcode', label: BASIS.postcode, waarde: normaliseerPostcode(a.waarde.postcode) ?? a.waarde.postcode, bron, zekerheid: a.zekerheid });
    if (a.waarde.plaats) uit.push({ sleutel: 'plaats', label: BASIS.plaats, waarde: a.waarde.plaats, bron, zekerheid: a.zekerheid });
  }
  const soort = r.feiten.find((f) => f.sleutel === 'soort');
  const type = soort && woningtypeUit(String(soort.waarde));
  if (soort && type) uit.push({ sleutel: 'woningtype', label: BASIS.woningtype, waarde: type, bron: `${soort.bron}: '${soort.waarde}'`, zekerheid: 'middel', toelichting: 'afgeleid uit de soort woning' });
  for (const f of r.feiten) uit.push({ sleutel: `feit.${f.sleutel}`, label: f.label, waarde: f.waarde, eenheid: f.eenheid ?? null, bron: f.bron,
    zekerheid: f.zekerheid, verificatie: f.verificatie, toelichting: f.toelichting });
  const d = r.gegevens.disclaimer as { waarde: string; pagina?: number } | undefined;
  if (d) uit.push({ sleutel: 'disclaimer', label: 'Disclaimer makelaar', waarde: d.waarde, bron: `brochure p. ${d.pagina}` });
  return uit;
}

const gelijk = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function spiegelProject(c: pg.PoolClient, project: string, sleutel: string, waarde: unknown) {
  if (isBasis(sleutel)) await c.query(`UPDATE project SET ${sleutel} = $2, gewijzigd_op = now() WHERE id = $1`, [project, waarde]);
}

/**
 * Vult na een import de lege gegevens aan. Bestaande projectwaarden zonder gegeven (ingevoerd in het
 * projectformulier vóór de aanlevering) gelden als handmatig en dus beschermd. Geeft de telling terug.
 */
export async function vulAan(c: pg.PoolClient, gebruiker: string, project: { id: string; kantoor_id: string } & Record<string, unknown>, verwerking: string, lijst: Kandidaat[]) {
  const t = { aangevuld: 0, bijgewerkt: 0, beschermd: 0, gelijk: 0 };
  const bestaand = new Map((await c.query('SELECT * FROM gegeven WHERE project_id = $1', [project.id])).rows.map((r) => [r.sleutel, r]));
  for (const s of Object.keys(BASIS)) if (!bestaand.has(s) && project[s] != null) {
    const r = (await c.query(`INSERT INTO gegeven (project_id, kantoor_id, sleutel, label, waarde, herkomst, status, bron, gewijzigd_door)
      VALUES ($1, $2, $3, $4, $5, 'handmatig', 'goedgekeurd', 'projectformulier', $6) RETURNING *`,
      [project.id, project.kantoor_id, s, BASIS[s as Basis], JSON.stringify(project[s]), gebruiker])).rows[0];
    bestaand.set(s, r);
  }
  for (const k of lijst) {
    const oud = bestaand.get(k.sleutel);
    if (oud && gelijk(oud.waarde, k.waarde) && (oud.eenheid ?? null) === (k.eenheid ?? null)) { t.gelijk++; continue; }
    if (oud?.status === 'goedgekeurd') { t.beschermd++; continue; }
    if (oud) {
      await c.query(`UPDATE gegeven SET label = $3, waarde = $4, eenheid = $5, bron = $6, verwerking_id = $7, gewijzigd_door = $8, gewijzigd_op = now()
        WHERE project_id = $1 AND sleutel = $2`, [project.id, k.sleutel, k.label, JSON.stringify(k.waarde), k.eenheid ?? null, k.bron, verwerking, gebruiker]);
      t.bijgewerkt++;
    } else {
      await c.query(`INSERT INTO gegeven (project_id, kantoor_id, sleutel, label, waarde, eenheid, herkomst, status, verwerking_id, bron, gewijzigd_door)
        VALUES ($1, $2, $3, $4, $5, $6, 'brochure', 'overgenomen', $7, $8, $9)`,
        [project.id, project.kantoor_id, k.sleutel, k.label, JSON.stringify(k.waarde), k.eenheid ?? null, verwerking, k.bron, gebruiker]);
      t.aangevuld++;
    }
    await spiegelProject(c, project.id, k.sleutel, k.waarde);
  }
  await audit(c, { gebruiker, actie: 'gegevens_aanvullen', tabel: 'gegeven', id: project.id, nieuw: t });
  return t;
}

/** Controleert en normaliseert een handmatige waarde. */
export function valideerWaarde(sleutel: string, waarde: unknown, eenheid?: string | null): { ok: true; waarde: unknown } | { ok: false; fout: string } {
  if (waarde == null || (typeof waarde === 'string' && !waarde.trim())) return { ok: false, fout: 'Vul een waarde in' };
  if (sleutel === 'postcode') {
    const p = normaliseerPostcode(String(waarde));
    return p ? { ok: true, waarde: p } : { ok: false, fout: 'Gebruik 1234 AB' };
  }
  if (sleutel === 'woningtype') return (WONINGTYPEN as readonly string[]).includes(String(waarde)) ? { ok: true, waarde } : { ok: false, fout: 'Kies een woningtype uit de lijst' };
  if (eenheid === 'm²' || eenheid === 'm³') {
    const n = Number(String(waarde).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 && n < 1e7 ? { ok: true, waarde: n } : { ok: false, fout: `Geef een getal (${eenheid})` };
  }
  const s = String(waarde).trim();
  if (s.length > 2000) return { ok: false, fout: 'Te lang (maximaal 2000 tekens)' };
  return { ok: true, waarde: s };
}

/**
 * Een handeling op één gegeven.
 *   goedkeuren        de huidige waarde bevestigen (herkomst blijft)
 *   corrigeren        handmatige waarde; altijd goedgekeurd, bron 'handmatig'
 *   brochure          de waarde uit de laatste import overnemen; over een goedgekeurde waarde
 *                     alleen met bevestigd = true
 */
export async function bewerkGegeven(c: pg.PoolClient, gebruiker: string, project: { id: string; kantoor_id: string },
  sleutel: string, h: { actie: string; waarde?: unknown; label?: string; eenheid?: string | null; bevestigd?: boolean }, extractie: Kandidaat | null) {
  const oud = (await c.query('SELECT * FROM gegeven WHERE project_id = $1 AND sleutel = $2', [project.id, sleutel])).rows[0] ?? null;
  let nieuw;
  if (h.actie === 'goedkeuren') {
    if (!oud) return { fout: 'onbekend' as const };
    nieuw = (await c.query(`UPDATE gegeven SET status = 'goedgekeurd', gewijzigd_door = $3, gewijzigd_op = now() WHERE project_id = $1 AND sleutel = $2 RETURNING *`,
      [project.id, sleutel, gebruiker])).rows[0];
  } else if (h.actie === 'corrigeren') {
    const label = oud?.label ?? extractie?.label ?? (isBasis(sleutel) ? BASIS[sleutel] : h.label?.trim());
    if (!label) return { fout: 'label' as const };
    const eenheid = h.eenheid !== undefined ? h.eenheid : (oud?.eenheid ?? extractie?.eenheid ?? null);
    const v = valideerWaarde(sleutel, h.waarde, eenheid);
    if (!v.ok) return { fout: 'waarde' as const, melding: v.fout };
    nieuw = (await c.query(`INSERT INTO gegeven (project_id, kantoor_id, sleutel, label, waarde, eenheid, herkomst, status, bron, gewijzigd_door)
      VALUES ($1, $2, $3, $4, $5, $6, 'handmatig', 'goedgekeurd', $7, $8)
      ON CONFLICT (project_id, sleutel) DO UPDATE SET waarde = EXCLUDED.waarde, eenheid = EXCLUDED.eenheid, herkomst = 'handmatig', status = 'goedgekeurd',
        bron = EXCLUDED.bron, verwerking_id = NULL, gewijzigd_door = EXCLUDED.gewijzigd_door, gewijzigd_op = now() RETURNING *`,
      [project.id, project.kantoor_id, sleutel, label, JSON.stringify(v.waarde), eenheid, `handmatig ${new Date().toLocaleDateString('nl-NL')}`, gebruiker])).rows[0];
  } else if (h.actie === 'brochure') {
    if (!extractie) return { fout: 'geen_extractie' as const };
    if (oud?.status === 'goedgekeurd' && h.bevestigd !== true) return { fout: 'bevestiging' as const };
    nieuw = (await c.query(`INSERT INTO gegeven (project_id, kantoor_id, sleutel, label, waarde, eenheid, herkomst, status, bron, gewijzigd_door)
      VALUES ($1, $2, $3, $4, $5, $6, 'brochure', 'goedgekeurd', $7, $8)
      ON CONFLICT (project_id, sleutel) DO UPDATE SET waarde = EXCLUDED.waarde, eenheid = EXCLUDED.eenheid, herkomst = 'brochure', status = 'goedgekeurd',
        bron = EXCLUDED.bron, gewijzigd_door = EXCLUDED.gewijzigd_door, gewijzigd_op = now() RETURNING *`,
      [project.id, project.kantoor_id, sleutel, extractie.label, JSON.stringify(extractie.waarde), extractie.eenheid ?? null, extractie.bron, gebruiker])).rows[0];
  } else return { fout: 'actie' as const };
  if (!nieuw) return { fout: 'geweigerd' as const };
  await spiegelProject(c, project.id, sleutel, nieuw.waarde);
  await audit(c, { gebruiker, actie: `gegeven_${h.actie}`, tabel: 'gegeven', id: `${project.id}/${sleutel}`, oud, nieuw });
  return { gegeven: nieuw };
}

/** Wijzigingen via het projectformulier: een gewijzigd basisveld wordt een handmatig (goedgekeurd) gegeven. */
export async function vanFormulier(c: pg.PoolClient, gebruiker: string, project: { id: string; kantoor_id: string }, oud: Record<string, unknown> | null, nieuw: Record<string, unknown>) {
  for (const s of Object.keys(BASIS) as Basis[]) {
    if (oud && oud[s] === nieuw[s]) continue;
    if (nieuw[s] == null) { if (oud) await c.query('DELETE FROM gegeven WHERE project_id = $1 AND sleutel = $2', [project.id, s]); continue; }
    await c.query(`INSERT INTO gegeven (project_id, kantoor_id, sleutel, label, waarde, herkomst, status, bron, gewijzigd_door)
      VALUES ($1, $2, $3, $4, $5, 'handmatig', 'goedgekeurd', 'projectformulier', $6)
      ON CONFLICT (project_id, sleutel) DO UPDATE SET waarde = EXCLUDED.waarde, herkomst = 'handmatig', status = 'goedgekeurd', bron = 'projectformulier',
        verwerking_id = NULL, gewijzigd_door = EXCLUDED.gewijzigd_door, gewijzigd_op = now()`,
      [project.id, project.kantoor_id, s, BASIS[s], JSON.stringify(nieuw[s]), gebruiker]);
  }
}
