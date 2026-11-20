// Aanvullende keuzes van de makelaar (stap 3A.2): gewenste domeinnaam (met beschikbaarheidscontrole),
// homepagefoto en een optionele aanvraag voor de zon- en schaduwvisualisatie.
//
// Geen nieuwe tabellen of workflow:
//  - homepagefoto  = het bestaande openingsbeeld (project.openingsbeeld_id, besluit 'openingsbeeld'),
//                    dat al naar de conceptgenerator gaat (export: kolom 'hero');
//  - domeinwens    = besluit 'domeinwens' in het bestaande besluitenlog. Het definitieve domein
//                    (project.domein) blijft bij Rhadix/kantoorbeheer en blokkeert het concept niet;
//  - zon/schaduw   = besluit 'zonschaduw' in hetzelfde log, met foto en adres als uitgangspunt.
// Het besluitenlog valt onder de bestaande RLS: alleen het eigen kantoor (en platformbeheer).
import type pg from 'pg';
import { overzicht } from './aanlevering.ts';
import { legVast } from './besluiten.ts';
import { beoordeling } from './controle.ts';
import { config } from './config.ts';
import { HERO_MINIMUM } from './fasen.ts';

// ── Domeinnaam ──────────────────────────────────────────────────────────────

const label = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Voorstel uit straat en huisnummer: "Beusemkolkweg 16" → "beusemkolkweg16.nl" (zonder plaatsnaam). De makelaar
 * kan het wijzigen; een bezette naam blokkeert niets. Zonder bruikbaar adres of langer dan 63 tekens: null.
 */
export function domeinVoorstel(adres: string | null | undefined): string | null {
  if (!adres) return null;
  const l = label(adres);
  return l.length >= 2 && l.length <= 63 ? `${l}.nl` : null;
}

const NL_DOMEIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.nl$/;
export const geldigNlDomein = (d: string) => NL_DOMEIN.test(d) && !/^..--/.test(d);

export type Uitkomst = { status: 'beschikbaar' | 'bezet' | 'onbekend'; bron: string; op: string; reden?: string };

// SIDN (beheerder van .nl) beperkt het aantal opvragingen streng. Daarom: minimaal 5 s tussen
// opvragingen vanuit deze server en een uitslag 10 minuten onthouden. Bij een weigering of
// storing: 'onbekend' (nooit een geraden uitslag).
const cache = new Map<string, { u: Uitkomst; tot: number }>();
let volgendeVrij = 0;

export async function controleerDomein(domein: string, haal: typeof fetch = fetch): Promise<Uitkomst> {
  const bron = 'SIDN RDAP (.nl-register)';
  const nu = Date.now();
  const c = cache.get(domein);
  if (c && c.tot > nu) return c.u;
  if (nu < volgendeVrij) return { status: 'onbekend', bron, op: new Date().toISOString(), reden: 'Even geduld: probeer het over enkele seconden opnieuw.' };
  volgendeVrij = nu + 5000;
  let u: Uitkomst;
  try {
    const r = await haal(`${config.rdapNl}/domain/${encodeURIComponent(domein)}`, { headers: { accept: 'application/rdap+json' }, signal: AbortSignal.timeout(8000) });
    if (r.status === 404) u = { status: 'beschikbaar', bron, op: new Date().toISOString() };
    else if (r.status === 200) u = { status: 'bezet', bron, op: new Date().toISOString() };
    else u = { status: 'onbekend', bron, op: new Date().toISOString(), reden: r.status === 429 ? 'Het register beperkt het aantal controles; probeer het over een minuut opnieuw.' : `Het register gaf geen bruikbaar antwoord (${r.status}).` };
  } catch {
    u = { status: 'onbekend', bron, op: new Date().toISOString(), reden: 'Het register is nu niet bereikbaar.' };
  }
  if (u.status !== 'onbekend') cache.set(domein, { u, tot: nu + 10 * 60e3 });
  return u;
}
export const wisDomeinCache = () => { cache.clear(); volgendeVrij = 0; };

// ── Lezen ───────────────────────────────────────────────────────────────────

type Rij = Record<string, any>;

/** Alles wat het keuzescherm nodig heeft, zonder technische velden. */
export async function leesKeuzes(c: pg.PoolClient, projectId: string) {
  const o = await overzicht(c, projectId);
  if (!o) return null;
  const b = await beoordeling(c, projectId);
  const p = o.project as Rij;
  const besluiten = (await c.query(`SELECT DISTINCT ON (onderwerp) onderwerp, handeling, waarde, op FROM besluit
    WHERE project_id = $1 AND onderwerp IN ('domeinwens', 'zonschaduw') ORDER BY onderwerp, op DESC, id DESC`, [projectId])).rows;
  const laatste = (onderwerp: string) => besluiten.find((x) => x.onderwerp === onderwerp) ?? null;

  // Foto's in brochurevolgorde, met paginanummer en volgnummer op die pagina.
  const fotos = (o.bestanden as Rij[]).filter((x) => x.soort === 'foto' && !x.vervallen && !x.dubbel_van)
    .sort((x, y) => (x.pagina ?? 9999) - (y.pagina ?? 9999) || String(x.originele_naam).localeCompare(String(y.originele_naam)));
  const perPagina = new Map<number, number>();
  for (const f of fotos) if (f.pagina != null) perPagina.set(f.pagina, (perPagina.get(f.pagina) ?? 0) + 1);
  const teller = new Map<number, number>();
  const kwaliteit = new Map<string, string>((b?.beslissingen.openingsbeeld_kandidaten ?? []).map((x: Rij) => [x.id, x.kwaliteit]));

  const wens = laatste('domeinwens');
  const zon = laatste('zonschaduw');
  return {
    project: { id: p.id, naam: p.naam, adres: p.adres, postcode: p.postcode, plaats: p.plaats, woningtype: p.woningtype, status: p.status },
    domein: {
      voorstel: domeinVoorstel(p.adres),
      wens: wens ? { domein: wens.waarde?.domein ?? null, uitkomst: wens.waarde?.uitkomst ?? null, op: wens.op } : null,
      definitief: p.domein ?? null,
    },
    openingsbeeld: {
      gekozen: (b?.beslissingen.openingsbeeld?.id as string | undefined) ?? null,   // bestaande beoordeling (bron: project.openingsbeeld_id)
      voorstel: b?.beslissingen.openingsbeeld_voorstel ?? null,
      norm: b?.beslissingen.openingsbeeld_norm ?? null,
      minimum: HERO_MINIMUM,
    },
    zonschaduw: zon ? { gewenst: !!zon.waarde?.gewenst, bestand_id: zon.waarde?.bestand_id ?? null, adres: zon.waarde?.adres ?? null, op: zon.op } : null,
    fotos: fotos.map((f) => {
      const n = f.pagina != null ? (teller.set(f.pagina, (teller.get(f.pagina) ?? 0) + 1), teller.get(f.pagina)!) : null;
      return { id: f.id as string, pagina: (f.pagina as number | null) ?? null, nummer: n, aantal_op_pagina: f.pagina != null ? perPagina.get(f.pagina)! : null,
        herkomst: f.herkomst as string, breedte: f.breedte as number, hoogte: f.hoogte as number, geschikt_als_homepagefoto: kwaliteit.has(f.id),
        /** 'goed' = volgens de norm; 'beperkt' = kiesbaar met een waarschuwing; null = niet kiesbaar (staand of te klein). */
        kwaliteit: (kwaliteit.get(f.id) as 'goed' | 'beperkt' | undefined) ?? null };
    }),
  };
}

// ── Vastleggen ─────────────────────────────────────────────────────────────

export async function legDomeinwens(c: pg.PoolClient, gebruiker: string, projectId: string, domein: string, uitkomst: Uitkomst | null) {
  await legVast(c, { project: projectId, door: gebruiker, onderwerp: 'domeinwens', handeling: uitkomst ? `gecontroleerd: ${uitkomst.status}` : 'opgegeven',
    waarde: { domein, uitkomst, gereserveerd: false } });
}

export async function legZonschaduw(c: pg.PoolClient, gebruiker: string, projectId: string, gewenst: boolean, bestandId: string | null) {
  const p = (await c.query('SELECT adres, postcode, plaats FROM project WHERE id = $1', [projectId])).rows[0];
  if (!p) return { fout: 'onbekend' as const };
  if (gewenst) {
    if (!bestandId) return { fout: 'foto' as const };
    const f = (await c.query(`SELECT 1 FROM bestand WHERE id = $1 AND project_id = $2 AND soort = 'foto' AND NOT vervallen`, [bestandId, projectId])).rows[0];
    if (!f) return { fout: 'foto' as const };
  }
  const adres = [p.adres, [p.postcode, p.plaats].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;
  await legVast(c, { project: projectId, door: gebruiker, onderwerp: 'zonschaduw', handeling: gewenst ? 'aangevraagd' : 'niet gewenst',
    waarde: { gewenst, bestand_id: gewenst ? bestandId : null, adres, locatie_bron: 'adres uit de brochure-import (te controleren door Rhadix)' } });
  return { ok: true as const };
}
