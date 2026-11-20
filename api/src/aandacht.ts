// Aandachtspunten voor de inlogmelding en het aandachtspaneel (migratie 016, docs/VOORSTEL-AANDACHTSPANEEL.md).
//
// Bron is uitsluitend de bestaande registratie (tabel verbeterpunt, statussen, rijregels): geen tweede
// takenadministratie. Alles wordt berekend onder de rijregels van de aanvrager, dus nooit over een andere
// organisatie. Het antwoord bestaat uit blokken per soort, zodat later andere workflowacties (bijvoorbeeld
// concepten klaar voor beoordeling) als extra blok kunnen worden toegevoegd zonder het scherm te wijzigen.
//
// Per rol (bepaald op de server, niet in de interface):
//   platformbeheer    alle kantoren; het paneel is de WERKVOORRAAD: alleen OPEN/IN_BEHANDELING;
//                     nieuw = een open punt dat na de laatste inzage is ingediend (alleen een markering)
//   kantoorbeheerder  punten van het eigen kantoor (waar hij kantoorbeheerder is) en zijn eigen punten
//   makelaar          alleen zijn eigen ingediende punten
//   (kantoor)         nieuw = een reactie of afhandeling door Rhadix na de laatste inzage
// Drie categorieën: nieuw sinds de laatste inzage, open (OPEN/IN_BEHANDELING), afgehandeld (KLAAR/GEANNULEERD).
// De regels in het paneel zijn voor elke rol uitsluitend open punten; 'gezien' verwijdert alleen de markering
// 'nieuw' en verandert nooit de werkvoorraad, de aantallen open of de status van een punt. Voor kantoor en
// makelaar komen nieuwe afhandelingen door Rhadix in een apart blok (melding), los van de werkvoorraad.
import type pg from 'pg';

export const ONDERWERPEN = ['verbeterpunten'] as const;
export type Rol = 'platformbeheer' | 'kantoorbeheerder' | 'makelaar';

export async function rolVan(c: pg.PoolClient, platformbeheer: boolean): Promise<Rol | null> {
  if (platformbeheer) return 'platformbeheer';
  const r = (await c.query(`SELECT bool_or(rol = 'kantoorbeheerder') AS kb, count(*)::int AS n FROM lidmaatschap WHERE gebruiker_id = app.huidige_gebruiker()`)).rows[0];
  return r.n ? (r.kb ? 'kantoorbeheerder' : 'makelaar') : null;
}

// Welke punten tellen voor deze rol (bovenop de rijregels, die andere organisaties al uitsluiten).
const SCOPE: Record<Rol, string> = {
  platformbeheer: 'true',
  kantoorbeheerder: '(app.is_kantoorbeheer(v.kantoor_id) OR v.ingediend_door = app.huidige_gebruiker())',
  makelaar: 'v.ingediend_door = app.huidige_gebruiker()',
};
// Wat telt als nieuw ten opzichte van het tijdstip van de laatste inzage ($1, NULL = nog nooit bekeken).
const NIEUW: Record<Rol, string> = {
  platformbeheer: `(v.status IN ('OPEN', 'IN_BEHANDELING') AND ($1::timestamptz IS NULL OR v.ingediend_op > $1))`,
  kantoorbeheerder: `((v.reactie IS NOT NULL OR v.status <> 'OPEN') AND ($1::timestamptz IS NULL OR v.bijgewerkt_op > $1))`,
  makelaar: `((v.reactie IS NOT NULL OR v.status <> 'OPEN') AND ($1::timestamptz IS NULL OR v.bijgewerkt_op > $1))`,
};
const OPEN = `v.status IN ('OPEN', 'IN_BEHANDELING')`;

async function gezienOp(c: pg.PoolClient, onderwerp: string): Promise<string | null> {
  return (await c.query('SELECT gezien_op FROM gezien WHERE gebruiker_id = app.huidige_gebruiker() AND onderwerp = $1', [onderwerp])).rows[0]?.gezien_op ?? null;
}

/**
 * Het blok 'verbeterpunten': aantallen per categorie, de werkvoorraad (alleen open punten, nieuw gemarkeerd en
 * eerst, dan het oudste) en voor kantoor/makelaar apart de afhandelingen door Rhadix sinds de laatste inzage.
 */
export async function blokVerbeterpunten(c: pg.PoolClient, rol: Rol, max = 8) {
  const g = await gezienOp(c, 'verbeterpunten');
  const telling = (await c.query(`SELECT count(*) FILTER (WHERE ${NIEUW[rol]})::int AS nieuw, count(*) FILTER (WHERE ${OPEN})::int AS open,
      count(*) FILTER (WHERE NOT (${OPEN}))::int AS afgehandeld,
      count(*) FILTER (WHERE NOT (${OPEN}) AND ($1::timestamptz IS NULL OR v.afgehandeld_op > $1))::int AS afgehandeld_nieuw
    FROM verbeterpunt v WHERE ${SCOPE[rol]}`, [g])).rows[0];
  const kolommen = `v.id, v.project_id, v.concept_id, k.versie, v.onderdeel, left(v.tekst, 80) AS tekst, v.status,
      v.ingediend_op, v.bijgewerkt_op, v.afgehandeld_op, kv.versie AS verwerkt_in_versie, (v.reactie IS NOT NULL) AS heeft_reactie,
      ${NIEUW[rol]} AS nieuw, p.adres, p.plaats, p.naam AS project_naam${rol === 'platformbeheer' ? ', kt.merknaam AS kantoor' : ''}`;
  const van = `FROM verbeterpunt v JOIN concept k ON k.id = v.concept_id LEFT JOIN concept kv ON kv.id = v.verwerkt_in
      JOIN project p ON p.id = v.project_id JOIN kantoor kt ON kt.id = v.kantoor_id`;
  // Werkvoorraad: uitsluitend OPEN/IN_BEHANDELING, voor elke rol. Nieuw gemarkeerd en eerst, dan het oudste.
  const items = (await c.query(`SELECT ${kolommen} ${van}
    WHERE ${SCOPE[rol]} AND ${OPEN}
    ORDER BY (${NIEUW[rol]}) DESC, v.ingediend_op, v.id LIMIT $2`, [g, max + 1])).rows;
  // Kantoor en makelaar: afhandelingen door Rhadix sinds de laatste inzage, als aparte melding (geen werkvoorraad).
  const afgehandeld = rol === 'platformbeheer' ? [] : (await c.query(`SELECT ${kolommen} ${van}
    WHERE ${SCOPE[rol]} AND NOT (${OPEN}) AND ($1::timestamptz IS NULL OR v.afgehandeld_op > $1)
    ORDER BY v.afgehandeld_op DESC, v.id LIMIT $2`, [g, max])).rows;
  return { soort: 'verbeterpunten' as const, titel: 'Verbeterpunten', rol, gezien_op: g, ...telling, meer: items.length > max, items: items.slice(0, max), afgehandeld_items: afgehandeld };
}

/** Alle blokken voor de aanvrager (nu alleen verbeterpunten). */
export async function aandacht(c: pg.PoolClient, platformbeheer: boolean, max = 8) {
  const rol = await rolVan(c, platformbeheer);
  if (!rol) return { rol: null, soorten: [] };
  return { rol, soorten: [await blokVerbeterpunten(c, rol, max)] };
}

/** De volledige, voor de rol relevante lijst (pagina 'Verbeterpunten' voor kantoor en makelaar), alle categorieën. */
export async function relevanteVerbeterpunten(c: pg.PoolClient, rol: Rol) {
  const g = await gezienOp(c, 'verbeterpunten');
  const rijen = (await c.query(`SELECT v.id, v.project_id, v.concept_id, k.versie, v.onderdeel, v.tekst, v.status, v.reactie, v.ingediend_op, v.bijgewerkt_op,
      v.afgehandeld_op, kv.versie AS verwerkt_in_versie, ${NIEUW[rol]} AS nieuw, p.adres, p.plaats, p.naam AS project_naam,
      (v.ingediend_door = app.huidige_gebruiker()) AS eigen
    FROM verbeterpunt v JOIN concept k ON k.id = v.concept_id LEFT JOIN concept kv ON kv.id = v.verwerkt_in JOIN project p ON p.id = v.project_id
    WHERE ${SCOPE[rol]} ORDER BY (${NIEUW[rol]}) DESC, v.bijgewerkt_op DESC, v.id LIMIT 500`, [g])).rows;
  return { rol, gezien_op: g, punten: rijen };
}

/** Bewust bekeken: alleen het tijdstip van de aanvrager; verandert niets aan de punten zelf. */
export async function markeerGezien(c: pg.PoolClient, onderwerp: string) {
  if (!(ONDERWERPEN as readonly string[]).includes(onderwerp)) return { fout: 'onderwerp' as const };
  const r = (await c.query(`INSERT INTO gezien (gebruiker_id, onderwerp) VALUES (app.huidige_gebruiker(), $1)
    ON CONFLICT (gebruiker_id, onderwerp) DO UPDATE SET gezien_op = now() RETURNING gezien_op`, [onderwerp])).rows[0];
  return { gezien_op: r.gezien_op as string };
}
