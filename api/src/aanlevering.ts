// Aanlevering: bestanden aanleveren (brochure, losse foto's), de brochure-import en de
// beeldindeling als verwerking in een wachtrij (één tegelijk), dubbele foto's, het overzicht
// voor de controle en het opslaan van de aanlevering (zonder website te genereren).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import { config, ROOT } from './config.ts';
import { alsGebruiker, audit, pool } from './db.ts';
import { aanleverEisen, generatorCommit, hamming, leesTeksten } from './generator.ts';
import { fotokwaliteit, meldingen, signalen, SIGNAAL_TEKST, vergelijkMakelaar } from './beoordeling.ts';
import { beeldInfo, bewaar, herkenType, MAX_GROOTTE, opslagPad, sha256 } from './opslag.ts';
import { kandidaten, vulAan, type Conflict, type Kandidaat } from './gegevens.ts';
import { leesProject } from './projecten.ts';

const BESTAND_VELDEN = `id, project_id, kantoor_id, soort, herkomst, verwerking_id, originele_naam, mime, grootte, sha256, breedte, hoogte,
  pagina, hoofdstuk, dubbel_van, dubbel_reden, classificatie, vervallen, geupload_op`;

// ── Bestanden aanleveren ────────────────────────────────────────────────────
export type UploadFout = { fout: 'type' | 'grootte' | 'beeld' | 'onbekend' | 'leeg'; melding: string };

export async function leverAan(c: pg.PoolClient, gebruiker: string, projectId: string, soort: 'brochure' | 'foto', naam: string, b: Buffer)
  : Promise<UploadFout | { bestand: Record<string, unknown>; al_aanwezig: boolean }> {
  const p = await leesProject(c, projectId);
  if (!p) return { fout: 'onbekend', melding: 'Woningproject niet gevonden' };
  if (!b.length) return { fout: 'leeg', melding: 'Leeg bestand' };
  if (b.length > MAX_GROOTTE[soort]) return { fout: 'grootte', melding: `Te groot (maximaal ${MAX_GROOTTE[soort] / 1024 / 1024} MB)` };
  const t = herkenType(b);
  if (soort === 'brochure' && t?.mime !== 'application/pdf') return { fout: 'type', melding: 'Alleen een PDF-brochure' };
  if (soort === 'foto' && t?.mime === 'image/heic') return { fout: 'type', melding: 'HEIC wordt niet ondersteund; lever de foto als JPEG aan' };
  if (soort === 'foto' && !['image/jpeg', 'image/png', 'image/webp', 'image/tiff'].includes(t?.mime ?? '')) return { fout: 'type', melding: 'Alleen JPEG, PNG, WebP of TIFF' };
  const hash = sha256(b);
  const dubbel = (await c.query(`SELECT ${BESTAND_VELDEN} FROM bestand WHERE project_id = $1 AND sha256 = $2 AND herkomst = 'upload'`, [projectId, hash])).rows[0];
  if (dubbel) {
    if (dubbel.vervallen) await c.query('UPDATE bestand SET vervallen = false WHERE id = $1', [dubbel.id]);
    return { bestand: { ...dubbel, vervallen: false }, al_aanwezig: true };
  }
  let info: { breedte: number | null; hoogte: number | null; dhash: string | null } = { breedte: null, hoogte: null, dhash: null };
  if (soort === 'foto') {
    try { info = await beeldInfo(b); } catch { return { fout: 'beeld', melding: 'Niet te lezen als foto' }; }
  }
  const rel = bewaar(`projecten/${projectId}/bron/${hash}.${t!.ext}`, b);
  const r = (await c.query(`INSERT INTO bestand (kantoor_id, project_id, soort, herkomst, originele_naam, mime, grootte, sha256, breedte, hoogte, dhash, opslag, geupload_door)
    VALUES ($1, $2, $3, 'upload', $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING ${BESTAND_VELDEN}`,
    [p.kantoor_id, projectId, soort, naam.slice(0, 200) || `${soort}.${t!.ext}`, t!.mime, b.length, hash, info.breedte, info.hoogte, info.dhash, rel, gebruiker])).rows[0];
  // Een nieuwe brochure vervangt de vorige als bron voor de volgende import (de oude blijft bewaard).
  if (soort === 'brochure') await c.query("UPDATE bestand SET vervallen = true WHERE project_id = $1 AND soort = 'brochure' AND id <> $2", [projectId, r.id]);
  if (soort === 'foto') await bepaalDubbelen(c, projectId);
  await audit(c, { gebruiker, actie: 'aanleveren', tabel: 'bestand', id: r.id, nieuw: { soort, naam: r.originele_naam, sha256: hash, grootte: b.length } });
  return { bestand: r, al_aanwezig: false };
}

/** Uit de aanlevering halen (bestand blijft bewaard, wordt niet meer gebruikt). */
export async function trekIn(c: pg.PoolClient, gebruiker: string, id: string) {
  const r = (await c.query("UPDATE bestand SET vervallen = true WHERE id = $1 AND herkomst = 'upload' AND project_id IS NOT NULL RETURNING project_id, soort", [id])).rows[0];
  if (!r) return false;
  if (r.soort === 'foto') await bepaalDubbelen(c, r.project_id);
  await audit(c, { gebruiker, actie: 'intrekken', tabel: 'bestand', id });
  return true;
}

/**
 * Dubbele foto's (dHash, zelfde drempel als de generator: ≤ 6 bits verschil). Per groep blijft het
 * beeld met de meeste pixels; bij gelijke kwaliteit gaat de losse foto voor op die uit de brochure.
 */
export async function bepaalDubbelen(c: pg.PoolClient, projectId: string) {
  const fotos = (await c.query(`SELECT id, herkomst, originele_naam, breedte, hoogte, dhash, pagina FROM bestand
    WHERE project_id = $1 AND soort = 'foto' AND NOT vervallen AND dhash IS NOT NULL`, [projectId])).rows;
  fotos.sort((a, b) => b.breedte * b.hoogte - a.breedte * a.hoogte || (a.herkomst === 'upload' ? -1 : 1) - (b.herkomst === 'upload' ? -1 : 1));
  const gehouden: typeof fotos = [];
  const besluit = new Map<string, { van: string | null; reden: string | null }>();
  for (const f of fotos) {
    let van = null;
    for (const g of gehouden) if ((await hamming(f.dhash, g.dhash)) <= 6) { van = g; break; }
    if (van) besluit.set(f.id, { van: van.id, reden: `zelfde beeld als ${van.herkomst === 'upload' ? `losse foto '${van.originele_naam}'` : `brochurefoto p. ${van.pagina}`} (${van.breedte}×${van.hoogte}, betere kwaliteit)` });
    else { gehouden.push(f); besluit.set(f.id, { van: null, reden: null }); }
  }
  for (const [id, b] of besluit) await c.query('UPDATE bestand SET dubbel_van = $2, dubbel_reden = $3 WHERE id = $1', [id, b.van, b.reden]);
  await c.query("UPDATE bestand SET dubbel_van = NULL, dubbel_reden = NULL WHERE project_id = $1 AND soort = 'foto' AND vervallen", [projectId]);
}

// ── Verwerkingen: wachtrij met één verwerker ────────────────────────────────
export async function vraagVerwerking(c: pg.PoolClient, gebruiker: string, projectId: string, soort: 'brochure-import' | 'foto-indeling') {
  const p = await leesProject(c, projectId);
  if (!p) return { fout: 'onbekend' as const };
  const lopend = (await c.query("SELECT id FROM verwerking WHERE project_id = $1 AND status IN ('wachtrij', 'bezig')", [projectId])).rows[0];
  if (lopend) return { fout: 'lopend' as const };
  let bestand = null;
  if (soort === 'brochure-import') {
    bestand = (await c.query("SELECT id FROM bestand WHERE project_id = $1 AND soort = 'brochure' AND herkomst = 'upload' AND NOT vervallen ORDER BY geupload_op DESC LIMIT 1", [projectId])).rows[0];
    if (!bestand) return { fout: 'geen_brochure' as const };
  } else {
    const n = (await c.query("SELECT count(*)::int AS n FROM bestand WHERE project_id = $1 AND soort = 'foto' AND NOT vervallen AND dubbel_van IS NULL", [projectId])).rows[0].n;
    if (!n) return { fout: 'geen_fotos' as const };
  }
  const nr = (await c.query('SELECT coalesce(max(volgnummer), 0) + 1 AS n FROM verwerking WHERE project_id = $1', [projectId])).rows[0].n;
  const v = (await c.query(`INSERT INTO verwerking (project_id, kantoor_id, soort, volgnummer, bestand_id, aangevraagd_door) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, status, volgnummer`,
    [projectId, p.kantoor_id, soort, nr, bestand?.id ?? null, gebruiker])).rows[0];
  await audit(c, { gebruiker, actie: `verwerking_${soort}`, tabel: 'verwerking', id: v.id });
  return { verwerking: v };
}

/** Draait het kindproces met de generatorfuncties; geeft de JSON-uitvoer terug. */
function draaiKind(invoer: object): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return new Promise((resolve, reject) => {
    const k = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'api', 'src', 'verwerker-kind.ts')], { cwd: ROOT, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let uit = '', fout = '';
    k.stdout.on('data', (d) => (uit += d)); k.stderr.on('data', (d) => (fout += d));
    k.on('error', reject);
    k.on('close', (code) => {
      if (code !== 0) return reject(new Error(fout.split('\n').filter(Boolean).slice(0, 3).join(' | ') || `kindproces stopte met code ${code}`));
      try { resolve(JSON.parse(uit)); } catch { reject(new Error('onleesbare uitvoer van de verwerking')); }
    });
    k.stdin.end(JSON.stringify(invoer));
  });
}

let actief: Promise<void> | null = null;

/** Neemt de oudste wachtende verwerking en voert die uit; één tegelijk (ook over processen: SKIP LOCKED). */
export async function verwerkVolgende(): Promise<boolean> {
  const v = (await pool.query(`UPDATE verwerking SET status = 'bezig', gestart_op = now()
    WHERE id = (SELECT id FROM verwerking WHERE status = 'wachtrij' AND NOT EXISTS (SELECT 1 FROM verwerking WHERE status = 'bezig')
      ORDER BY aangevraagd_op FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`)).rows[0];
  if (!v) return false;
  const t0 = Date.now();
  try {
    // Losse foto's gaan altijd mee in de classificatie; die uit de brochure komen bij een import uit de nieuwe importmap.
    const fotos = (await pool.query(`SELECT id, opslag FROM bestand WHERE project_id = $1 AND soort = 'foto' AND herkomst = 'upload' AND NOT vervallen AND dubbel_van IS NULL`,
      [v.project_id])).rows;
    let invoer: object;
    let uitmap: string | null = null;
    if (v.soort === 'brochure-import') {
      const b = (await pool.query('SELECT opslag FROM bestand WHERE id = $1', [v.bestand_id])).rows[0];
      uitmap = `projecten/${v.project_id}/import/${v.volgnummer}`;
      rmSync(opslagPad(uitmap), { recursive: true, force: true });
      mkdirSync(opslagPad(uitmap), { recursive: true });
      invoer = { pdf: opslagPad(b.opslag), uit: opslagPad(uitmap), fotos: fotos.map((f) => ({ id: f.id, pad: opslagPad(f.opslag) })), classificeer: config.classificatie };
    } else {
      const brochure = (await pool.query(`SELECT id, opslag FROM bestand WHERE project_id = $1 AND soort = 'foto' AND herkomst = 'brochure' AND NOT vervallen AND dubbel_van IS NULL`, [v.project_id])).rows;
      invoer = { fotos: [...fotos, ...brochure].map((f) => ({ id: f.id, pad: opslagPad(f.opslag) })), classificeer: config.classificatie };
    }
    const r = await draaiKind(invoer);
    await alsGebruiker(v.aangevraagd_door, (c) => verwerkUitkomst(c, v, uitmap, r, Date.now() - t0));
  } catch (e) {
    await pool.query("UPDATE verwerking SET status = 'mislukt', fout = $2, klaar_op = now(), duur_ms = $3 WHERE id = $1", [v.id, (e as Error).message.slice(0, 2000), Date.now() - t0]);
  }
  return true;
}

/** Start de verwerker als hij niet al draait; loopt door tot de wachtrij leeg is. */
export function wekVerwerker() {
  if (actief) return actief;
  actief = (async () => { try { while (await verwerkVolgende()); } finally { actief = null; } })();
  return actief;
}

/** Bij het starten: een verwerking die 'bezig' bleef staan (API gestopt) is mislukt. */
export async function herstelVerwerkingen() {
  await pool.query("UPDATE verwerking SET status = 'mislukt', fout = 'onderbroken: de studio is tijdens de verwerking gestopt', klaar_op = now() WHERE status = 'bezig'");
}

async function verwerkUitkomst(c: pg.PoolClient, v: Record<string, any>, uitmap: string | null, r: Record<string, any>, duur: number) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const gebruiker = v.aangevraagd_door as string;
  const stappen: Record<string, unknown> = { ...(r.rapport?.tijden_ms ? { import_delen: r.rapport.tijden_ms } : {}), ...r.tijden_ms };
  let samenvatting: Record<string, unknown> = {};
  if (v.soort === 'brochure-import') {
    const rapport = r.rapport;
    // De vraagprijs is een historisch brochuregegeven en wordt nooit gepubliceerd: niet bewaren.
    if (rapport.gegevens?.vraagprijs) {
      rapport.vraagprijs_gevonden = { pagina: rapport.gegevens.vraagprijs.pagina, toelichting: 'niet overgenomen; wordt nooit gepubliceerd' };
      delete rapport.gegevens.vraagprijs;
    }
    // Beelden uit een eerdere import vervallen; de nieuwe komen ervoor in de plaats.
    await c.query("UPDATE bestand SET vervallen = true WHERE project_id = $1 AND herkomst = 'brochure' AND NOT vervallen", [v.project_id]);
    const ids = new Map<string, string>();
    for (const b of r.beelden) {
      const n = (await c.query(`INSERT INTO bestand (kantoor_id, project_id, soort, herkomst, verwerking_id, originele_naam, mime, grootte, sha256, breedte, hoogte, dhash,
        pagina, hoofdstuk, opslag, geupload_door) VALUES ($1, $2, $3, 'brochure', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
        [v.kantoor_id, v.project_id, b.soort, v.id, b.bestand, b.mime, b.grootte, b.sha256, b.breedte, b.hoogte, b.dhash, b.pagina, b.hoofdstuk,
          `${uitmap}/${b.bestand}`, gebruiker])).rows[0];
      ids.set(`brochure:${b.bestand}`, n.id);
    }
    if (r.classificatie?.resultaten) r.classificatie.resultaten = Object.fromEntries(Object.entries(r.classificatie.resultaten).map(([k, x]) => [ids.get(k) ?? k, x]));
    const project = await leesProject(c, v.project_id);
    samenvatting = await vulAan(c, gebruiker, project, v.id, kandidaten(rapport));
    await c.query('UPDATE verwerking SET rapport = $2, controle = $3 WHERE id = $1', [v.id, JSON.stringify(rapport), JSON.stringify(r.controle)]);
  }
  if (r.classificatie?.beschikbaar) {
    for (const [id, x] of Object.entries(r.classificatie.resultaten as Record<string, object>))
      await c.query('UPDATE bestand SET classificatie = $2 WHERE id = $1', [id, JSON.stringify({ ...x, model: r.classificatie.model })]);
  }
  await bepaalDubbelen(c, v.project_id);
  stappen.classificatie_beschikbaar = r.classificatie?.beschikbaar ?? null;
  stappen.gegevens = samenvatting;
  await c.query(`UPDATE verwerking SET status = 'klaar', klaar_op = now(), duur_ms = $2, stappen = $3, generator_commit = $4 WHERE id = $1`,
    [v.id, duur, JSON.stringify(stappen), generatorCommit()]);
  await c.query('UPDATE project SET gewijzigd_op = now() WHERE id = $1', [v.project_id]);
  await audit(c, { gebruiker, actie: `verwerking_klaar`, tabel: 'verwerking', id: v.id, nieuw: { soort: v.soort, duur_ms: duur, ...samenvatting } });
}

// ── Overzicht voor het aanleverscherm ───────────────────────────────────────
export async function laatsteImport(c: pg.PoolClient, projectId: string) {
  return (await c.query(`SELECT * FROM verwerking WHERE project_id = $1 AND soort = 'brochure-import' AND status = 'klaar' ORDER BY volgnummer DESC LIMIT 1`, [projectId])).rows[0] ?? null;
}

export async function extractieVoor(c: pg.PoolClient, projectId: string, sleutel: string): Promise<Kandidaat | null> {
  const imp = await laatsteImport(c, projectId);
  return imp ? kandidaten(imp.rapport).find((k) => k.sleutel === sleutel) ?? null : null;
}

export async function conflictVoor(c: pg.PoolClient, projectId: string, sleutel: string): Promise<Conflict | null> {
  const imp = await laatsteImport(c, projectId);
  const x = (imp?.rapport.conflicten ?? []).find((k: { gegeven: string }) => `feit.${k.gegeven}` === sleutel);
  return x ? { ernst: x.ernst, bronnen: x.bronnen } : null;
}

export async function overzicht(c: pg.PoolClient, projectId: string) {
  const project = await leesProject(c, projectId);
  if (!project) return null;
  const bestanden = (await c.query(`SELECT ${BESTAND_VELDEN} FROM bestand WHERE project_id = $1 ORDER BY soort, herkomst DESC, pagina NULLS FIRST, geupload_op`, [projectId])).rows;
  const verwerkingen = (await c.query(`SELECT id, soort, volgnummer, status, aangevraagd_op, gestart_op, klaar_op, duur_ms, stappen, fout, generator_commit
    FROM verwerking WHERE project_id = $1 ORDER BY volgnummer DESC LIMIT 10`, [projectId])).rows;
  const imp = await laatsteImport(c, projectId);
  const vast = new Map((await c.query('SELECT * FROM gegeven WHERE project_id = $1', [projectId])).rows.map((r) => [r.sleutel, r]));
  const kand = imp ? kandidaten(imp.rapport) : [];
  const conflicten = new Map<string, { ernst: string; bronnen: string[] }>(
    (imp?.rapport.conflicten ?? []).map((x: { gegeven: string; ernst: string; bronnen: string[] }) => [`feit.${x.gegeven}`, { ernst: x.ernst, bronnen: x.bronnen }]));
  const sleutels = [...new Set([...['adres', 'postcode', 'plaats', 'woningtype'], ...kand.map((k) => k.sleutel), ...vast.keys()])];
  const importKlaar = imp ? new Date(imp.klaar_op) : null;
  const gegevens = sleutels.map((s) => {
    const e = kand.find((k) => k.sleutel === s) ?? null;
    const g = vast.get(s) ?? null;
    const regel = {
      sleutel: s, label: g?.label ?? e?.label ?? s,
      extractie: e, vastgelegd: g,
      afwijking: !!(e && g && JSON.stringify(e.waarde) !== JSON.stringify(g.waarde)),
      conflict: conflicten.get(s) ?? null,
    };
    const sig = signalen(regel, importKlaar);
    // Bulkgoedkeuring alleen voor overgenomen gegevens zonder enig signaal.
    return { ...regel, signalen: sig, bulk: g?.status === 'overgenomen' && !sig.length && !regel.conflict };
  });
  let teksten: unknown[] = [];
  const brochureLogo = bestanden.find((b) => b.soort === 'logo' && b.herkomst === 'brochure' && !b.vervallen) ?? null;
  if (imp) {
    try {
      const md = readFileSync(opslagPad(`projecten/${projectId}/import/${imp.volgnummer}/teksten.md`), 'utf8');
      teksten = (await leesTeksten(md)).verhaal.hoofdstukken.map((h) => ({ id: h.id, titel: h.titel, alineas: h.alineas ?? [] }));
    } catch { teksten = []; }
  }
  const aanleveringen = (await c.query(`SELECT a.versie, a.opgeslagen_op, g.naam AS door, a.inhoud->'samenvatting' AS samenvatting
    FROM aanlevering a JOIN gebruiker g ON g.id = a.opgeslagen_door WHERE a.project_id = $1 ORDER BY a.versie DESC`, [projectId])).rows;
  const kantoor = (await c.query('SELECT id, merknaam, juridische_naam, telefoon, email, website, adresregels, logo_id FROM kantoor WHERE id = $1', [project.kantoor_id])).rows[0];
  // Handmatige correcties: alles wat wij zelf hebben vastgelegd of bevestigd na de laatste import.
  const ingrepen = (await c.query(`SELECT actie, count(*)::int AS n FROM auditregel WHERE tabel = 'gegeven' AND rij_id LIKE $1 AND actie LIKE 'gegeven\\_%' GROUP BY actie`,
    [`${projectId}/%`])).rows;
  const foto = fotokwaliteit(bestanden, await aanleverEisen());
  const makelaar = vergelijkMakelaar(imp?.rapport.gegevens.makelaar?.waarde, kantoor);
  return {
    project, kantoor, bestanden, verwerkingen, gegevens, teksten, aanleveringen, brochure_logo: brochureLogo, fotokwaliteit: foto, makelaar,
    meldingen: meldingen({ gegevens, project, imp, foto, makelaar }),
    import: imp && {
      id: imp.id, volgnummer: imp.volgnummer, klaar_op: imp.klaar_op, duur_ms: imp.duur_ms, stappen: imp.stappen, generator_commit: imp.generator_commit,
      paginas: imp.rapport.paginas, telling: imp.rapport.telling, hoofdstukken: imp.rapport.hoofdstukken, ontbreekt: imp.rapport.ontbreekt,
      conflicten: imp.rapport.conflicten, open_punten: imp.rapport.open_punten, uitgesloten: imp.rapport.uitgesloten, meldingen: imp.rapport.meldingen,
      makelaar: imp.rapport.gegevens.makelaar ?? null, profiel: imp.rapport.gegevens.profiel ?? null, huisstijl: imp.rapport.gegevens.huisstijl ?? null,
      vraagprijs_gevonden: imp.rapport.vraagprijs_gevonden ?? null, controle: imp.controle,
    },
    ingrepen,
  };
}

/**
 * Bulkgoedkeuring: keurt in één handeling alle overgenomen gegevens goed die geen enkel signaal
 * hebben (geen tegenstrijdigheid, terminologische afwijking, afwijking of lagere zekerheid).
 * De selectie gebeurt hier, niet in de browser. Geeft ook de uitgesloten gegevens met reden.
 */
export async function bulkGoedkeuren(c: pg.PoolClient, gebruiker: string, projectId: string) {
  const o = await overzicht(c, projectId);
  if (!o) return null;
  const wel = o.gegevens.filter((g) => g.bulk);
  const niet = o.gegevens.filter((g) => g.vastgelegd?.status === 'overgenomen' && !g.bulk)
    .map((g) => ({ sleutel: g.sleutel, label: g.label, reden: g.signalen.map((x) => SIGNAAL_TEKST[x]).join(', ') || 'tegenstrijdigheid besloten, controle nodig' }));
  if (wel.length) await c.query(`UPDATE gegeven SET status = 'goedgekeurd', gewijzigd_door = $3, gewijzigd_op = now()
    WHERE project_id = $1 AND sleutel = ANY($2) AND status = 'overgenomen'`, [projectId, wel.map((g) => g.sleutel), gebruiker]);
  await audit(c, { gebruiker, actie: 'gegeven_bulkgoedkeuring', tabel: 'gegeven', id: `${projectId}/*`, nieuw: { goedgekeurd: wel.map((g) => g.sleutel), uitgesloten: niet } });
  return { goedgekeurd: wel.length, uitgesloten: niet };
}

// ── Aanlevering opslaan (momentopname; genereert geen website) ──────────────
export async function slaOp(c: pg.PoolClient, gebruiker: string, projectId: string) {
  const o = await overzicht(c, projectId);
  if (!o) return { fout: 'onbekend' as const };
  if (o.verwerkingen.some((v) => ['wachtrij', 'bezig'].includes(v.status))) return { fout: 'lopend' as const };
  const actief = o.bestanden.filter((b) => !b.vervallen);
  const inhoud = {
    samenvatting: {
      brochure: actief.some((b) => b.soort === 'brochure'), losse_fotos: actief.filter((b) => b.soort === 'foto' && b.herkomst === 'upload').length,
      brochurefotos: actief.filter((b) => b.soort === 'foto' && b.herkomst === 'brochure').length,
      dubbel: actief.filter((b) => b.dubbel_van).length, plattegronden: actief.filter((b) => b.soort === 'plattegrond').length,
      gegevens: o.gegevens.filter((g) => g.vastgelegd).length, goedgekeurd: o.gegevens.filter((g) => g.vastgelegd?.status === 'goedgekeurd').length,
      open: o.gegevens.filter((g) => g.vastgelegd?.status === 'overgenomen').length, afwijkingen: o.gegevens.filter((g) => g.afwijking).length,
      conflicten: o.gegevens.filter((g) => g.conflict).length,
    },
    import: o.import ? { id: o.import.id, volgnummer: o.import.volgnummer, generator_commit: o.import.generator_commit } : null,
    gegevens: o.gegevens.filter((g) => g.vastgelegd).map((g) => ({ sleutel: g.sleutel, label: g.label, waarde: g.vastgelegd.waarde, eenheid: g.vastgelegd.eenheid,
      herkomst: g.vastgelegd.herkomst, status: g.vastgelegd.status, bron: g.vastgelegd.bron })),
    bestanden: actief.map((b) => ({ id: b.id, soort: b.soort, herkomst: b.herkomst, sha256: b.sha256, gebruikt: !b.dubbel_van })),
  };
  const versie = (await c.query('SELECT coalesce(max(versie), 0) + 1 AS n FROM aanlevering WHERE project_id = $1', [projectId])).rows[0].n;
  const r = (await c.query(`INSERT INTO aanlevering (project_id, kantoor_id, versie, verwerking_id, inhoud, opgeslagen_door) VALUES ($1, $2, $3, $4, $5, $6) RETURNING versie, opgeslagen_op`,
    [projectId, o.project.kantoor_id, versie, o.import?.id ?? null, JSON.stringify(inhoud), gebruiker])).rows[0];
  await audit(c, { gebruiker, actie: 'aanlevering_opslaan', tabel: 'aanlevering', id: projectId, nieuw: { versie, ...inhoud.samenvatting } });
  return { aanlevering: { ...r, samenvatting: inhoud.samenvatting } };
}

