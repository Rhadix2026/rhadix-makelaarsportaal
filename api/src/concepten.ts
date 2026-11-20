// Stap 6: conceptgeneratie en preview. Een vrijgegeven woning wordt met de bestaande generator
// (automatische compositie, mp bouw) lokaal gebouwd en met de kwaliteitscontrole van Design
// System 1.0 (mp kwaliteit) getoetst. Elke generatie is een nieuwe, onveranderlijke versie in de
// studio-opslag; de productie-instantie van de generator wordt niet gewijzigd. Geen publicatie.
import type { Voortgang } from './voortgang.ts';
import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type pg from 'pg';
import { audit } from './db.ts';
import { legVast } from './besluiten.ts';
import { beoordeling, exporteer, uitgangspunten, vingerafdruk } from './controle.ts';
import { dienIn, openOpConcept, puntenVanConcept } from './verbeterpunten.ts';
import { opslagPad } from './opslag.ts';
import { config } from './config.ts';
import { actief } from './tijd.ts';
import { deelConceptIn } from './indeling.ts';

type Rij = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const AMBITIE_MS = 15 * 60e3; // vanaf volledige aanlevering tot eerste concept, zonder redactie

/** Mag er (opnieuw) gegenereerd worden? Alleen na vrijgave, met alle verplichte controles afgerond. */
export async function magGenereren(c: pg.PoolClient, projectId: string) {
  const b = await beoordeling(c, projectId);
  if (!b) return { ok: false, reden: 'Woningproject niet gevonden' };
  if (!b.vrijgave.vrijgegeven) return { ok: false, reden: 'De woning is nog niet vrijgegeven voor conceptgeneratie (beoordeling, fase 4)' };
  if (!b.klaar) return { ok: false, reden: `Niet alle verplichte controles zijn afgerond: ${b.checklist.filter((x) => x.verplicht && !x.ok).map((x) => x.titel).join('; ')}` };
  return { ok: true, reden: null, beoordeling: b };
}

export async function vraagConcept(c: pg.PoolClient, gebruiker: string, projectId: string) {
  // Eerst de lopende verwerking: anders meldt magGenereren() een onduidelijke reden ("geen verwerking meer bezig").
  const lopend = (await c.query("SELECT id FROM verwerking WHERE project_id = $1 AND status IN ('wachtrij', 'bezig')", [projectId])).rows[0];
  if (lopend) return { fout: 'lopend' as const, reden: 'Er loopt al een verwerking voor dit project' };
  const m = await magGenereren(c, projectId);
  if (!m.ok) return { fout: 'niet_klaar' as const, reden: m.reden };
  const p = (await c.query('SELECT kantoor_id FROM project WHERE id = $1', [projectId])).rows[0];
  const nr = (await c.query('SELECT coalesce(max(volgnummer), 0) + 1 AS n FROM verwerking WHERE project_id = $1', [projectId])).rows[0].n;
  const v = (await c.query(`INSERT INTO verwerking (project_id, kantoor_id, soort, volgnummer, aangevraagd_door, vingerafdruk)
    VALUES ($1, $2, 'conceptgeneratie', $3, $4, $5) RETURNING id, status, volgnummer`, [projectId, p.kantoor_id, nr, gebruiker, m.beoordeling!.vingerafdruk])).rows[0];
  await audit(c, { gebruiker, actie: 'verwerking_conceptgeneratie', tabel: 'verwerking', id: v.id });
  return { verwerking: v };
}

/** Voorbereiding (in de studio): export van de vastgelegde gegevens en de bekende classificaties. */
export async function bereidVoor(c: pg.PoolClient, v: Rij) {
  const p = (await c.query('SELECT slug, ontwerpsysteem, profiel FROM project WHERE id = $1', [v.project_id])).rows[0];
  const versie = (await c.query('SELECT coalesce(max(versie), 0) + 1 AS n FROM concept WHERE project_id = $1', [v.project_id])).rows[0].n;
  const map = `projecten/${v.project_id}/concepten/v${versie}`;
  const invoerVinger = await vingerafdruk(c, v.project_id);
  const exp = await exporteer(c, v.project_id, opslagPad(`${map}/aanlevering`));
  // Classificatie uit de aanlevering hergebruiken (geen tweede SigLIP-run voor dezelfde foto's).
  const ids = exp.bestanden.map((b: { id: string }) => b.id);
  const cl = new Map((await c.query('SELECT id, classificatie FROM bestand WHERE id = ANY($1) AND classificatie IS NOT NULL', [ids])).rows.map((r) => [r.id, r.classificatie]));
  const classificaties = Object.fromEntries(exp.bestanden.filter((b: { id: string }) => cl.has(b.id)).map((b: { id: string; pad: string }) => [b.pad, cl.get(b.id)]));
  return {
    meta: { versie, map, invoerVinger, slug: p.slug, profiel: p.profiel, ontwerpsysteem: p.ontwerpsysteem },
    invoer: { concept: { aanlevering: opslagPad(`${map}/aanlevering`), woning: opslagPad(`${map}/woning/${p.slug}`), site: opslagPad(`${map}/site`),
      ontwerpsysteem: p.ontwerpsysteem, classificaties, classificeer: config.classificatie } },
  };
}

/** Na de generatie: de conceptversie vastleggen, met kwaliteitsrapport en metingen. */
export async function registreer(c: pg.PoolClient, v: Rij, meta: Rij, r: Rij, duur: number, eind: Voortgang | null = null) {
  const gebruiker = v.aangevraagd_door as string;
  const metingen = await meet(c, v.project_id, duur, r);
  const basis = await uitgangspunten(c, v.project_id);
  const token = randomBytes(32).toString('base64url');
  const concept = (await c.query(`INSERT INTO concept (project_id, kantoor_id, versie, verwerking_id, map, invoer_vingerafdruk, build_vingerafdruk, ontwerpsysteem, profiel,
      generator_commit, bouw, kwaliteit, metingen, voorbeeld_token, aangemaakt_door, uitgangspunten)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id, versie`,
    [v.project_id, v.kantoor_id, meta.versie, v.id, meta.map, meta.invoerVinger, r.bouw.vingerafdruk, r.bouw.ontwerpsysteem.versie, r.bouw.profiel,
      r.generator_commit, JSON.stringify(r.bouw), JSON.stringify(r.kwaliteit ?? null), JSON.stringify(metingen), token, gebruiker, JSON.stringify(basis)])).rows[0];
  await c.query(`UPDATE verwerking SET status = 'klaar', klaar_op = now(), duur_ms = $2, stappen = $3, generator_commit = $4, rapport = $5, voortgang = coalesce($6, voortgang) WHERE id = $1`,
    [v.id, duur, JSON.stringify(r.tijden_ms), r.generator_commit, JSON.stringify({ concept: concept.id, versie: concept.versie }), eind && JSON.stringify(eind)]);
  // Een concept staat klaar voor de interne beoordeling (geen publicatie).
  await c.query("UPDATE project SET status = 'interne_review', gewijzigd_op = now() WHERE id = $1", [v.project_id]);
  await legVast(c, { project: v.project_id, door: gebruiker, onderwerp: `concept v${concept.versie}`, handeling: 'gegenereerd',
    waarde: { ontwerpsysteem: r.bouw.ontwerpsysteem.versie, profiel: r.bouw.profiel, duur_ms: duur, blokkerend: r.kwaliteit?.blokkerend?.length ?? null } });
  return concept;
}

/**
 * Metingen, afzonderlijk: machinetijd, actieve gebruikerstijd (uit interacties, met
 * inactiviteitsgrens) en kalenderdoorlooptijd (inclusief stilstand). Versie 2; versies van vóór
 * migratie 008 houden hun oorspronkelijke metingen (zie metingen.versie).
 */
async function meet(c: pg.PoolClient, projectId: string, duur: number, r: Rij) {
  const t = (s: string | Date | null | undefined) => (s ? new Date(s).getTime() : null);
  const eerste = (await c.query("SELECT min(geupload_op) AS t FROM bestand WHERE project_id = $1 AND herkomst = 'upload'", [projectId])).rows[0].t;
  const imp = (await c.query("SELECT duur_ms, klaar_op FROM verwerking WHERE project_id = $1 AND soort = 'brochure-import' AND status = 'klaar' ORDER BY volgnummer DESC LIMIT 1", [projectId])).rows[0];
  const eersteImport = (await c.query("SELECT klaar_op FROM verwerking WHERE project_id = $1 AND soort = 'brochure-import' AND status = 'klaar' ORDER BY volgnummer LIMIT 1", [projectId])).rows[0];
  const kc = (await c.query("SELECT coalesce(sum(duur_ms), 0)::int AS ms, count(*)::int AS n FROM verwerking WHERE project_id = $1 AND soort = 'kwaliteitscontrole'", [projectId])).rows[0];
  const p = (await c.query('SELECT vrijgave FROM project WHERE id = $1', [projectId])).rows[0];
  const g = (await c.query(`SELECT count(*) FILTER (WHERE herkomst = 'handmatig')::int AS gecorrigeerd, count(*) FILTER (WHERE status = 'afgewezen')::int AS afgewezen,
    count(*) FILTER (WHERE besluit IS NOT NULL)::int AS besloten FROM gegeven WHERE project_id = $1`, [projectId])).rows[0];
  const besluiten = (await c.query("SELECT count(*)::int AS n FROM besluit WHERE project_id = $1 AND onderwerp NOT LIKE 'concept %'", [projectId])).rows[0].n;
  const eerderConcept = (await c.query('SELECT count(*)::int AS n FROM concept WHERE project_id = $1', [projectId])).rows[0].n;
  const nu = new Date();
  const machine = (imp?.duur_ms ?? 0) + kc.ms + duur;
  const actiefTotaal = await actief(c, projectId, nu);
  const actiefTotVrijgave = p.vrijgave?.op ? await actief(c, projectId, new Date(p.vrijgave.op)) : null;
  const samen = machine + actiefTotaal.ms;
  return {
    versie: 2,
    aanlevering_import: { import_ms: imp?.duur_ms ?? null, upload_tot_import_ms: eerste && eersteImport ? t(eersteImport.klaar_op)! - t(eerste)! : null },
    conceptgeneratie: { totaal_ms: duur, stappen: r.tijden_ms, kwaliteitscontroles_ms: kc.ms },
    actief: { totaal: actiefTotaal, tot_vrijgave: actiefTotVrijgave, besluiten },
    kalender: {
      ms: eerste ? nu.getTime() - t(eerste)! : null, import_tot_vrijgave_ms: eersteImport && p.vrijgave?.op ? t(p.vrijgave.op)! - t(eersteImport.klaar_op)! : null,
      toelichting: 'kloktijd van de eerste upload tot dit concept, inclusief pauzes en stilstand; geen maat voor de inzet',
    },
    correcties: { gegevens_gecorrigeerd: g.gecorrigeerd, gegevens_afgewezen: g.afgewezen, tegenstrijdigheden_besloten: g.besloten, compositie: r.bouw?.rapport?.correcties ?? 0 },
    totaal: {
      machine_ms: machine, ambitie_ms: AMBITIE_MS, binnen_ambitie_machine: machine <= AMBITIE_MS,
      toelichting_machine: 'import + kwaliteitscontroles + conceptgeneratie, zonder menselijke handelingen',
      machine_en_actief_ms: samen,
      // Alleen te beoordelen als de actieve tijd betrouwbaar is geregistreerd; anders niet vast te stellen.
      binnen_ambitie: actiefTotaal.betrouwbaar ? samen <= AMBITIE_MS : null,
      eerste_concept: eerderConcept === 0,
    },
  };
}

export async function lijstConcepten(c: pg.PoolClient, projectId: string) {
  return (await c.query(`SELECT k.id, k.versie, k.status, k.ontwerpsysteem, k.profiel, k.generator_commit, k.aangemaakt_op, k.beoordeeld_op, k.motivering,
      k.metingen, k.invoer_vingerafdruk, k.build_vingerafdruk, k.voorbeeld_token, g.naam AS aangemaakt_door, b.naam AS beoordeeld_door,
      -- Verbeterpunten uit de actieve registratie (tabel verbeterpunt; concept.verbeterpunten is een bevroren archief).
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'onderdeel', v.onderdeel, 'tekst', v.tekst, 'op', v.ingediend_op, 'status', v.status)
         ORDER BY v.ingediend_op, v.id), '[]') FROM verbeterpunt v WHERE v.concept_id = k.id) AS verbeterpunten,
      (SELECT count(*)::int FROM verbeterpunt v WHERE v.concept_id = k.id AND v.status IN ('OPEN', 'IN_BEHANDELING')) AS open_verbeterpunten,
      jsonb_build_object('blokkerend', jsonb_array_length(coalesce(k.kwaliteit->'blokkerend', '[]')), 'waarschuwingen', jsonb_array_length(coalesce(k.kwaliteit->'waarschuwingen', '[]'))) AS kwaliteit_kort
    FROM concept k LEFT JOIN gebruiker g ON g.id = k.aangemaakt_door LEFT JOIN gebruiker b ON b.id = k.beoordeeld_door
    WHERE k.project_id = $1 ORDER BY k.versie DESC`, [projectId])).rows;
}

export async function leesConcept(c: pg.PoolClient, id: string) {
  const k = (await c.query(`SELECT k.*, g.naam AS aangemaakt_door_naam, b.naam AS beoordeeld_door_naam FROM concept k LEFT JOIN gebruiker g ON g.id = k.aangemaakt_door
    LEFT JOIN gebruiker b ON b.id = k.beoordeeld_door WHERE k.id = $1`, [id])).rows[0] ?? null;
  if (!k) return null;
  // Alleen presentatie: de opgeslagen kwaliteit en metingen blijven ongewijzigd. Voor versies van
  // vóór de tijdregistratie wordt de actieve tijd achteraf afgeleid en als zodanig gemarkeerd.
  const achteraf = k.metingen?.versie === 2 ? null : { ...(await actief(c, k.project_id, new Date(k.aangemaakt_op))), afgeleid: 'achteraf berekend bij het bekijken, niet opgeslagen bij de versie' };
  // verbeterpunten: uit de actieve registratie (zelfde vorm als vroeger, aangevuld met status en afhandeling).
  const punten = await puntenVanConcept(c, id);
  const { verbeterpunten: _archief, ...rest } = k; void _archief;
  return { ...rest, verbeterpunten: punten, open_verbeterpunten: punten.filter((p) => p.status === 'OPEN' || p.status === 'IN_BEHANDELING').length,
    indeling: deelConceptIn(k.kwaliteit), tijd_achteraf: achteraf };
}

/** Beoordeling van een concept: accepteren, of verbeterpunten vastleggen. De versie zelf blijft ongewijzigd. */
export async function beoordeelConcept(c: pg.PoolClient, gebruiker: string, id: string, b: { besluit?: string; motivering?: string; verbeterpunten?: unknown }) {
  const k = await leesConcept(c, id);
  if (!k) return { fout: 'onbekend' as const };
  const motivering = typeof b.motivering === 'string' ? b.motivering.trim() : '';
  if (b.besluit === 'geaccepteerd') {
    // Definitieve acceptatie niet zolang er op deze versie punten OPEN of IN_BEHANDELING zijn (de database bewaakt dit ook).
    const open = await openOpConcept(c, id);
    if (open.length) return { fout: 'open' as const, open };
    await c.query(`UPDATE concept SET status = 'geaccepteerd', beoordeeld_door = $2, beoordeeld_op = now(), motivering = $3 WHERE id = $1`, [id, gebruiker, motivering || null]);
    await legVast(c, { project: k.project_id, door: gebruiker, onderwerp: `concept v${k.versie}`, handeling: 'geaccepteerd', motivering });
    await audit(c, { gebruiker, actie: 'concept_geaccepteerd', tabel: 'concept', id, nieuw: { motivering } });
  } else if (b.besluit === 'verbeterpunten') {
    // Zelfde handeling als altijd, nu in de actieve registratie (tabel verbeterpunt) in plaats van de jsonb-kolom.
    const r = await dienIn(c, gebruiker, id, b.verbeterpunten, motivering);
    if ('fout' in r) return { fout: r.fout === 'teveel' ? 'teveel' as const : 'punten' as const };
    await c.query('UPDATE concept SET beoordeeld_door = $2, beoordeeld_op = now(), motivering = $3 WHERE id = $1', [id, gebruiker, motivering || null]);
    await legVast(c, { project: k.project_id, door: gebruiker, onderwerp: `concept v${k.versie}`, handeling: 'verbeterpunten vastgelegd',
      waarde: { verbeterpunten: r.ids.length }, motivering });
    await audit(c, { gebruiker, actie: 'concept_verbeterpunten', tabel: 'concept', id, nieuw: { motivering, verbeterpunten: r.ids } });
  } else return { fout: 'besluit' as const };
  return { concept: await leesConcept(c, id) };
}

/** Bestand uit een gegenereerde conceptsite (lokale preview). */
export function conceptBestand(map: string, rel: string) {
  const site = opslagPad(`${map}/site`);
  const pad = normalize(join(site, rel || 'index.html'));
  if (pad !== site && !pad.startsWith(site + sep)) return null;
  const doel = existsSync(pad) && statSync(pad).isDirectory() ? join(pad, 'index.html') : pad;
  if (!existsSync(doel)) return null;
  const TYPE: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg',
    '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.json': 'application/json' };
  return { pad: doel, type: TYPE[extname(doel).toLowerCase()] ?? 'application/octet-stream' };
}
