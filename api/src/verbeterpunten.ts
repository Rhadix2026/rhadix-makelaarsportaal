// Verbeterpunten als eenvoudige takenworkflow (migratie 015, docs/ONTWERP-VERBETERPUNTEN-WORKFLOW.md).
// De tabel verbeterpunt is de enige actieve registratie. Indienen mag iedereen die in het kantoor werkt
// (via app.verbeterpunten_indienen); behandelen alleen platformbeheer. Een nieuwe conceptversie rondt
// niets af. Elke handeling komt in het bestaande besluitenlog (onderwerp 'verbeterpunten vN') en in de audit.
import type pg from 'pg';
import { audit } from './db.ts';
import { legVast } from './besluiten.ts';

export const STATUSSEN = ['OPEN', 'IN_BEHANDELING', 'KLAAR', 'GEANNULEERD'] as const;
export const OPEN = ['OPEN', 'IN_BEHANDELING'];
type Rij = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Namen: de rijregels op gebruiker tonen een kantoorgebruiker alleen zichzelf (en platformbeheer iedereen).
// Een onbekende naam wordt daarom 'Rhadix' (behandeling) of 'een collega' (indiener) in de interface.
const VELDEN = `v.id, v.project_id, v.concept_id, k.versie, v.onderdeel, v.tekst, v.status, v.herkomst,
  v.ingediend_door, gi.naam AS ingediend_door_naam, v.ingediend_op, v.behandelaar, gb.naam AS behandelaar_naam,
  v.reactie, v.afgehandeld_door, ga.naam AS afgehandeld_door_naam, v.afgehandeld_op, v.verwerkt_in, kv.versie AS verwerkt_in_versie, v.bijgewerkt_op`;
const VAN = `FROM verbeterpunt v JOIN concept k ON k.id = v.concept_id LEFT JOIN concept kv ON kv.id = v.verwerkt_in
  LEFT JOIN gebruiker gi ON gi.id = v.ingediend_door LEFT JOIN gebruiker gb ON gb.id = v.behandelaar LEFT JOIN gebruiker ga ON ga.id = v.afgehandeld_door`;

export async function puntenVanProject(c: pg.PoolClient, projectId: string) {
  return (await c.query(`SELECT ${VELDEN} ${VAN} WHERE v.project_id = $1 ORDER BY k.versie DESC, v.ingediend_op, v.id`, [projectId])).rows;
}
export async function puntenVanConcept(c: pg.PoolClient, conceptId: string) {
  return (await c.query(`SELECT ${VELDEN} ${VAN} WHERE v.concept_id = $1 ORDER BY v.ingediend_op, v.id`, [conceptId])).rows;
}
export async function puntenOpen(c: pg.PoolClient) {
  return (await c.query(`SELECT ${VELDEN}, p.naam AS project_naam, p.adres, p.plaats, kt.merknaam AS kantoor,
      (SELECT array_agg(x.versie ORDER BY x.versie) FROM concept x WHERE x.project_id = v.project_id) AS versies ${VAN}
    JOIN project p ON p.id = v.project_id JOIN kantoor kt ON kt.id = v.kantoor_id
    WHERE v.status IN ('OPEN', 'IN_BEHANDELING') ORDER BY v.ingediend_op, v.id`)).rows;
}
/** Open punten (OPEN of IN_BEHANDELING) op een versie: die blokkeren de definitieve acceptatie. */
export async function openOpConcept(c: pg.PoolClient, conceptId: string) {
  return (await c.query(`SELECT id, onderdeel, tekst, status FROM verbeterpunt WHERE concept_id = $1 AND status IN ('OPEN', 'IN_BEHANDELING')
    ORDER BY ingediend_op, id`, [conceptId])).rows;
}

const schoon = (punten: unknown) => (Array.isArray(punten) ? punten : [])
  .map((x) => ({ onderdeel: String((x as Rij)?.onderdeel ?? 'algemeen').trim().slice(0, 60) || 'algemeen', tekst: String((x as Rij)?.tekst ?? '').trim().slice(0, 1000) }))
  .filter((x) => x.tekst.length >= 3);

/** Een of meer punten indienen op een conceptversie (makelaar, kantoorbeheerder of platformbeheer). */
export async function dienIn(c: pg.PoolClient, gebruiker: string, conceptId: string, invoer: unknown, motivering = '') {
  const punten = schoon(invoer);
  if (!punten.length) return { fout: 'punten' as const };
  if (punten.length > 20) return { fout: 'teveel' as const };
  const k = (await c.query('SELECT id, project_id, versie FROM concept WHERE id = $1', [conceptId])).rows[0];
  if (!k) return { fout: 'onbekend' as const };
  const ids = (await c.query('SELECT app.verbeterpunten_indienen($1, $2) AS id', [conceptId, JSON.stringify(punten)])).rows.map((r) => r.id as string);
  await legVast(c, { project: k.project_id, door: gebruiker, onderwerp: `verbeterpunten v${k.versie}`, handeling: `ingediend (${ids.length})`,
    waarde: { punten: punten.map((p, i) => ({ id: ids[i], ...p })) }, motivering });
  await audit(c, { gebruiker, actie: 'verbeterpunten_ingediend', tabel: 'verbeterpunt', id: conceptId, nieuw: { ids, punten } });
  return { ids, punten: await puntenVanConcept(c, conceptId) };
}

/**
 * Behandelen (alleen platformbeheer; de rijregels en kolomrechten dwingen dat ook af):
 *   IN_BEHANDELING  in behandeling nemen (behandelaar = de aanvrager)
 *   OPEN            terugzetten
 *   (geen status)   alleen beantwoorden: reactie bijwerken
 *   KLAAR           afronden: verwerkt in een latere versie (verplicht) met toelichting (verplicht)
 *   GEANNULEERD     gemotiveerd annuleren (motivering verplicht)
 */
export async function behandel(c: pg.PoolClient, gebruiker: string, id: string, b: { status?: string; reactie?: string; verwerkt_in_versie?: number }) {
  const v = (await c.query(`SELECT v.*, k.versie FROM verbeterpunt v JOIN concept k ON k.id = v.concept_id WHERE v.id = $1`, [id])).rows[0];
  if (!v) return { fout: 'onbekend' as const };
  if (!OPEN.includes(v.status)) return { fout: 'definitief' as const };
  const reactie = typeof b.reactie === 'string' ? b.reactie.trim().slice(0, 2000) : undefined;
  const status = b.status ? String(b.status).toUpperCase() : undefined;
  if (status && !(STATUSSEN as readonly string[]).includes(status)) return { fout: 'status' as const };
  if (!status && reactie === undefined) return { fout: 'leeg' as const };
  let verwerktIn: string | null = null, verwerktVersie: number | null = null;
  if (status === 'KLAAR') {
    if (!reactie || reactie.length < 3) return { fout: 'toelichting' as const };
    const n = Number(b.verwerkt_in_versie);
    const kv = Number.isInteger(n) ? (await c.query('SELECT id, versie FROM concept WHERE project_id = $1 AND versie = $2', [v.project_id, n])).rows[0] : null;
    if (!kv || kv.versie <= v.versie) return { fout: 'versie' as const };
    verwerktIn = kv.id; verwerktVersie = kv.versie;
  }
  if (status === 'GEANNULEERD' && (!reactie || reactie.length < 3)) return { fout: 'motivering' as const };
  const zet: string[] = []; const w: unknown[] = [id];
  const set = (kol: string, waarde: unknown) => { w.push(waarde); zet.push(`${kol} = $${w.length}`); };
  if (reactie !== undefined) set('reactie', reactie || null);
  if (status) {
    set('status', status);
    if (status === 'IN_BEHANDELING') set('behandelaar', gebruiker);
    if (status === 'KLAAR' || status === 'GEANNULEERD') { set('afgehandeld_door', gebruiker); zet.push('afgehandeld_op = now()'); }
    if (status === 'KLAAR') set('verwerkt_in', verwerktIn);
  }
  await c.query(`UPDATE verbeterpunt SET ${zet.join(', ')} WHERE id = $1`, w);
  const handeling = status === 'KLAAR' ? `afgerond in v${verwerktVersie}` : status === 'GEANNULEERD' ? 'geannuleerd'
    : status === 'IN_BEHANDELING' ? 'in behandeling' : status === 'OPEN' ? 'teruggezet naar open' : 'beantwoord';
  await legVast(c, { project: v.project_id, door: gebruiker, onderwerp: `verbeterpunten v${v.versie}`, handeling,
    waarde: { punt: id, tekst: v.tekst, ...(reactie ? { reactie } : {}), ...(verwerktVersie ? { verwerkt_in: `v${verwerktVersie}` } : {}) },
    motivering: status === 'GEANNULEERD' ? reactie : null });
  await audit(c, { gebruiker, actie: `verbeterpunt_${(status ?? 'beantwoord').toLowerCase()}`, tabel: 'verbeterpunt', id,
    oud: { status: v.status, reactie: v.reactie }, nieuw: { status: status ?? v.status, reactie, verwerkt_in: verwerktIn } });
  return { punt: (await c.query(`SELECT ${VELDEN} ${VAN} WHERE v.id = $1`, [id])).rows[0] };
}
