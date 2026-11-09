// Stap 5: broncontrole, kwaliteitscontrole en vrijgave voor conceptgeneratie.
//
// De kwaliteitscontrole bouwt niets na: de studio zet de vastgelegde gegevens om naar het
// aanleverformaat van de generator (woning.json, teksten.md, fotos.csv, fotos/, plattegronden/,
// logo) en laat daarop de bestaande controles lopen:
//   controleerAanlevering()                  volledigheid, beelden, rechten, adres, profiel
//   naarManifest() + manifestschema          zou de generator dit accepteren
//   controleerFeiten()                       maten in de teksten tegen de feiten
//   controleerTaal(tekstenMetHerkomst())     taal en herkomst van de teksten
// Vrijgave = gereed voor een eerste concept; nooit publicatie. Er wordt niets gegenereerd.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type pg from 'pg';
import { audit } from './db.ts';
import { legVast, leesBesluiten } from './besluiten.ts';
import { generatorCommit, generatorModule, generatorVersie, huisstijlFuncties, profielen, valideerManifest } from './generator.ts';
import { laatsteImport, overzicht } from './aanlevering.ts';
import { opslagPad } from './opslag.ts';
import { deelControleIn } from './indeling.ts';
import { VOOR_PUBLICATIE } from './fasen.ts';

type Rij = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Vingerafdruk van alles wat in de export en de controle meetelt. */
export async function vingerafdruk(c: pg.PoolClient, projectId: string) {
  const p = (await c.query(`SELECT naam, slug, adres, postcode, plaats, woningtype, profiel, domein, conceptadres, rechten->'bevestigd' AS rechten, openingsbeeld_id, kantoor_id
    FROM project WHERE id = $1`, [projectId])).rows[0];
  const g = (await c.query('SELECT sleutel, waarde, eenheid, status FROM gegeven WHERE project_id = $1 ORDER BY sleutel', [projectId])).rows;
  const b = (await c.query('SELECT id, sha256, dubbel_van FROM bestand WHERE project_id = $1 AND NOT vervallen ORDER BY id', [projectId])).rows;
  const k = (await c.query('SELECT merknaam, telefoon, email, website, adresregels, merkkleur, detailkleur, logo_id FROM kantoor WHERE id = $1', [p?.kantoor_id])).rows[0];
  const imp = await laatsteImport(c, projectId);
  return createHash('sha256').update(JSON.stringify({ p, g, b, k, imp: imp?.id ?? null })).digest('hex');
}

const csvRij = (...w: (string | undefined | null)[]) => w.map((x) => (x ?? '').replace(/[;\n]/g, ' ')).join(';');

/** Database → aanleveringsmap in het formaat van de generator (het contract voor stap 6). */
export async function exporteer(c: pg.PoolClient, projectId: string, map: string) {
  const o = await overzicht(c, projectId);
  if (!o) throw new Error('project niet gevonden');
  const imp = await laatsteImport(c, projectId);
  if (!imp) throw new Error('nog geen brochure-import');
  const p = (await c.query('SELECT * FROM project WHERE id = $1', [projectId])).rows[0];
  const k = (await c.query('SELECT * FROM kantoor WHERE id = $1', [p.kantoor_id])).rows[0];
  const importMap = opslagPad(`projecten/${projectId}/import/${imp.volgnummer}`);
  rmSync(map, { recursive: true, force: true });
  mkdirSync(join(map, 'fotos'), { recursive: true });

  // Alt-teksten en bijschriften van de import (neutraal; de redactie en de classificatie verbeteren ze later).
  const importCsv = new Map(readFileSync(join(importMap, 'fotos.csv'), 'utf8').split('\n').slice(1).filter(Boolean)
    .map((r) => { const w = r.split(';'); return [w[0], { alt: w[1], bijschrift: w[2] }]; }));
  const hoofdstukken: { id: string; titel: string }[] = imp.rapport.hoofdstukken;
  const titel = (id: string) => hoofdstukken.find((h) => h.id === id)?.titel ?? id;
  const adres = [p.adres, p.plaats].filter(Boolean).join(' in ');

  // Foto's: de volgorde en het hoofdstuk van de brochure; een losse foto neemt de plaats in van
  // het brochurebeeld dat hij vervangt. Losse foto's zonder tegenhanger komen achteraan.
  // Het opslagpad is intern (staat niet in het overzicht voor de browser).
  const pad = new Map((await c.query('SELECT id, opslag FROM bestand WHERE project_id = $1', [projectId])).rows.map((r) => [r.id, r.opslag as string]));
  const actief: Rij[] = o.bestanden.filter((b: Rij) => !b.vervallen).map((b: Rij) => ({ ...b, opslag: pad.get(b.id)! }));
  const brochure = actief.filter((b: Rij) => b.soort === 'foto' && b.herkomst === 'brochure').sort((a: Rij, b: Rij) => a.originele_naam.localeCompare(b.originele_naam, 'nl', { numeric: true }));
  const losse = actief.filter((b: Rij) => b.soort === 'foto' && b.herkomst === 'upload');
  const reeks: { b: Rij; hoofdstuk: string }[] = [];
  const geplaatst = new Set<string>();
  for (const b of brochure) {
    if (!b.dubbel_van) { reeks.push({ b, hoofdstuk: b.hoofdstuk }); continue; }
    const vervanger = losse.find((x: Rij) => x.id === b.dubbel_van);
    if (vervanger && !geplaatst.has(vervanger.id)) { reeks.push({ b: vervanger, hoofdstuk: b.hoofdstuk }); geplaatst.add(vervanger.id); }
  }
  for (const x of losse.filter((x: Rij) => !x.dubbel_van && !geplaatst.has(x.id))) reeks.push({ b: x, hoofdstuk: hoofdstukken[0]?.id ?? 'fotos-los' });
  const rijen = ['bestand;alt;bijschrift;hero;publiceren;focus'];
  const bestanden: { pad: string; id: string }[] = [];
  reeks.forEach(({ b, hoofdstuk }, i) => {
    const naam = `${String(i + 1).padStart(2, '0')}-${b.herkomst === 'upload' ? 'los' : `p${String(b.pagina).padStart(2, '0')}`}${extname(b.opslag).toLowerCase()}`;
    mkdirSync(join(map, 'fotos', hoofdstuk), { recursive: true });
    copyFileSync(opslagPad(b.opslag), join(map, 'fotos', hoofdstuk, naam));
    const alt = (b.herkomst === 'brochure' && importCsv.get(b.originele_naam)?.alt) || `Foto ${i + 1} bij '${titel(hoofdstuk)}', ${adres || p.naam}`;
    rijen.push(csvRij(`fotos/${hoofdstuk}/${naam}`, alt, '', p.openingsbeeld_id === b.id ? 'ja' : '', '', ''));
    bestanden.push({ pad: `fotos/${hoofdstuk}/${naam}`, id: b.id });
  });
  const plattegronden = actief.filter((b: Rij) => b.soort === 'plattegrond');
  if (plattegronden.length) mkdirSync(join(map, 'plattegronden'), { recursive: true });
  for (const b of plattegronden) {
    const naam = b.originele_naam.replace(/^plattegronden\//, '');
    copyFileSync(opslagPad(b.opslag), join(map, 'plattegronden', naam));
    const r = importCsv.get(b.originele_naam);
    rijen.push(csvRij(`plattegronden/${naam}`, r?.alt ?? `Plattegrond van ${p.adres ?? p.naam}`, r?.bijschrift ?? '', '', '', ''));
  }
  writeFileSync(join(map, 'fotos.csv'), rijen.join('\n') + '\n');
  copyFileSync(join(importMap, 'teksten.md'), join(map, 'teksten.md'));

  // Logo: dat van het kantoor, anders het logo uit de brochure.
  let logo: string | null = null;
  const logoBestand = k.logo_id ? (await c.query('SELECT opslag FROM bestand WHERE id = $1', [k.logo_id])).rows[0]
    : o.brochure_logo ? { opslag: pad.get(o.brochure_logo.id)! } : null;
  if (logoBestand) { logo = `logo${extname(logoBestand.opslag).toLowerCase()}`; copyFileSync(opslagPad(logoBestand.opslag), join(map, logo)); }

  // Huisstijl van het kantoor, met dezelfde contrastregels als de import.
  let huisstijl = null;
  if (k.merkkleur && p.profiel) {
    const h = await huisstijlFuncties();
    const v = h.huisstijlVoorstel([{ kleur: k.merkkleur, aandeel: 1 }, ...(k.detailkleur ? [{ kleur: k.detailkleur, aandeel: 0.5 }] : [])], h.laadProfiel(p.profiel));
    if (v) huisstijl = { bron: `kantoor ${k.merknaam} (${k.huisstijl_herkomst === 'logo' ? 'uit het logo' : 'handmatig'})`, licht: v.licht, donker: v.donker, merk: v.merk, detail: k.detailkleur ?? v.detail, favicon: v.favicon };
  }

  // Feiten: alleen vastgelegde (niet afgewezen); goedgekeurd door ons = bevestigd.
  // Niet publiceren (financiële gegevens): wel vastgelegd, niet in de export naar de generator.
  const vast = o.gegevens.filter((g: Rij) => g.vastgelegd && g.vastgelegd.status !== 'afgewezen' && g.vastgelegd.publiceren !== false);
  const feiten = vast.filter((g: Rij) => g.sleutel.startsWith('feit.')).map((g: Rij) => ({
    sleutel: g.sleutel.slice(5), label: g.label, waarde: g.vastgelegd.waarde, ...(g.vastgelegd.eenheid ? { eenheid: g.vastgelegd.eenheid } : {}),
    ...(g.extractie?.toelichting && g.vastgelegd.herkomst === 'brochure' ? { toelichting: g.extractie.toelichting } : {}),
    bron: g.vastgelegd.herkomst === 'handmatig' ? `${g.vastgelegd.bron ?? 'handmatig'} (studio)` : (g.vastgelegd.bron ?? 'brochure'),
    verificatie: g.vastgelegd.status === 'goedgekeurd' ? 'bevestigd' : 'onbevestigd', zekerheid: g.extractie?.zekerheid ?? 'hoog',
  }));
  const disclaimer = vast.find((g: Rij) => g.sleutel === 'disclaimer')?.vastgelegd.waarde;
  const telefoon = k.telefoon as string | null;
  const woning = {
    slug: p.slug, naam: p.naam, adres: p.adres ?? undefined, ...(p.postcode ? { postcode: p.postcode } : {}), plaats: p.plaats ?? undefined,
    ...(p.profiel ? { profiel: p.profiel } : {}),
    ...(huisstijl ? { huisstijl } : {}),
    makelaar: { naam: k.merknaam, ...(k.adresregels?.length ? { adresregels: k.adresregels } : {}), ...(telefoon ? { telefoon, telefoon_int: '+31' + telefoon.replace(/\D/g, '').replace(/^31/, '').replace(/^0/, '') } : {}),
      ...(k.email ? { email: k.email } : {}), ...(k.website ? { website: k.website } : {}), ...(logo ? { logo } : {}) },
    site: {
      // Zonder definitief domein krijgt het interne concept altijd het tijdelijke, onbereikbare adres
      // <slug>.invalid (het concept wordt niet gepubliceerd). Het definitieve domein is verplicht vóór publicatie.
      canonical: p.domein ? `https://${p.domein}/` : `https://${p.slug}.invalid/`,
      titel: [p.adres ?? p.naam, p.plaats].filter(Boolean).join(', '), index: false, ...(disclaimer ? { disclaimer } : {}),
    },
    feiten,
    herkomst: { soort: 'brochure', bestand: imp.rapport.bron, sha256: imp.rapport.sha256 },
    rechten: p.rechten?.bevestigd ? { bevestigd: true, toelichting: p.rechten.toelichting } : { bevestigd: false },
  };
  writeFileSync(join(map, 'woning.json'), JSON.stringify(woning, null, 2) + '\n');
  return { fotos: reeks.length, plattegronden: plattegronden.length, logo: !!logo, feiten: feiten.length, huisstijl: !!huisstijl, bestanden };
}

/** Voert de kwaliteitscontrole uit en bewaart haar als verwerking (soort kwaliteitscontrole). */
export async function kwaliteitscontrole(c: pg.PoolClient, gebruiker: string, projectId: string) {
  const p = (await c.query('SELECT id, kantoor_id FROM project WHERE id = $1', [projectId])).rows[0];
  if (!p) return { fout: 'onbekend' as const };
  if (!(await laatsteImport(c, projectId))) return { fout: 'geen_import' as const };
  const t0 = Date.now();
  const nr = (await c.query('SELECT coalesce(max(volgnummer), 0) + 1 AS n FROM verwerking WHERE project_id = $1', [projectId])).rows[0].n;
  const map = opslagPad(`projecten/${projectId}/controle/${nr}`);
  const vinger = await vingerafdruk(c, projectId);
  const exp = await exporteer(c, projectId, map);
  const { controleerAanlevering, naarManifest } = await generatorModule('packages/aanlevering/index.mjs');
  const qa = await generatorModule('packages/qa/index.mjs');
  const taal = await generatorModule('packages/qa/taal.mjs');
  const a = await controleerAanlevering(map);
  const { bestanden: _b, ...expKort } = exp; void _b;
  const rapport: Rij = { export: expKort, aanlevering: { ok: a.ok, fouten: a.fouten, waarschuwingen: a.waarschuwingen, samenvatting: a.samenvatting } };
  try {
    // Het manifest dat mp aanleveren zou maken (zonder compositie), getoetst aan het schema van de generator.
    const { manifest } = naarManifest(a.gegevens, generatorVersie(), null);
    rapport.manifest = { fouten: a.gegevens.woning?.site?.canonical ? valideerManifest(manifest) : ['site.canonical ontbreekt; het manifest kan nog niet worden gemaakt'] };
    // Feitencontrole op de verhaalteksten (dezelfde functie als na het bouwen, nu vóór de compositie).
    const f = qa.controleerFeiten({ ...manifest, compositie: manifest.verhaal, site: { ...manifest.site, index: false } });
    rapport.feiten = { getoetst: f.getoetst, fouten: f.fouten, meldingen: f.meldingen };
    const tl = taal.controleerTaal(taal.tekstenMetHerkomst(manifest, []), { feiten: manifest.feiten });
    rapport.taal = { blokkerend: tl.blokkerend, waarschuwingen: tl.waarschuwingen, meetwaarden: tl.meetwaarden };
    // Bedragen in de teksten (prijzen en lasten publiceren we niet zonder bewuste keuze): ter beoordeling.
    const financieel = (await c.query("SELECT label, waarde FROM gegeven WHERE project_id = $1 AND NOT publiceren AND status <> 'afgewezen'", [projectId])).rows;
    rapport.bedragen = taal.tekstenMetHerkomst(manifest, []).flatMap((t: { tekst: string; pad: string }) =>
      [...t.tekst.matchAll(/[^.;\n]*€\s?(\d[\d.,]*)[^.;\n]*/g)].map((m) => {
        const feit = financieel.find((f) => Number(String(m[1]).replace(/\./g, '').replace(',', '.')) === Number(f.waarde));
        return { tekst: m[0].trim(), feit: feit?.label ?? null };
      }));
  } catch (e) {
    rapport.manifest = { fouten: [`manifest niet te maken: ${(e as Error).message.split('\n')[0]}`] };
  }
  const v = (await c.query(`INSERT INTO verwerking (project_id, kantoor_id, soort, volgnummer, status, aangevraagd_door, gestart_op, klaar_op, duur_ms, rapport, controle, generator_commit, vingerafdruk)
    VALUES ($1, $2, 'kwaliteitscontrole', $3, 'klaar', $4, now(), now(), $5, $6, $7, $8, $9) RETURNING id, volgnummer, klaar_op, duur_ms`,
    [projectId, p.kantoor_id, nr, gebruiker, Date.now() - t0, JSON.stringify(rapport), JSON.stringify(rapport.aanlevering), generatorCommit(), vinger])).rows[0];
  await audit(c, { gebruiker, actie: 'kwaliteitscontrole', tabel: 'verwerking', id: v.id, nieuw: { fouten: a.fouten.length, waarschuwingen: a.waarschuwingen.length } });
  return { controle: v };
}

// ── Indeling van de controleresultaten ──────────────────────────────────────
const INFO = /slot met titel|wordt alleen tekst|standaardzin|alleen in "Alle foto's"|geen # hero/;
const VERTAAL: [RegExp, string][] = [
  [/rechten\.bevestigd ontbreekt/, 'Publicatierechten nog niet bevestigd (verplicht vóór publicatie; blokkeert het interne concept niet)'],
  [/site\.canonical/, 'Adres van de website ontbreekt (domein of tijdelijk conceptadres)'],
  [/'profiel' ontbreekt/, 'Presentatieprofiel ontbreekt'],
  [/makelaar heeft geen e-mail en geen telefoon/, 'Het kantoor heeft geen telefoon en geen e-mail: vul de kantoorgegevens aan (op het aanleverscherm kan dat uit de brochure)'],
  [/makelaar\.naam ontbreekt/, 'De naam van het makelaarskantoor ontbreekt'],
  [/'adres' ontbreekt/, 'Straat en huisnummer ontbreken'], [/'plaats' ontbreekt/, 'Plaats ontbreekt'],
  [/geen liggende foto van minimaal (\d+) px/, 'Geen liggende foto van minimaal $1 px voor het openingsbeeld'],
];
// Paden uit het manifest leesbaar maken: 'compositie.hoofdstukken[1].alineas[2].prose' → 'tekst: hoofdstuk 2, alinea 3'.
const pad = (t: string) => t.replace(/(?:compositie|verhaal)\.hoofdstukken\[(\d+)\]\.alineas\[(\d+)\](?:\.lijst\[(\d+)\])?(?:\.prose)?/g,
  (_m, h, a, l) => `hoofdstuk ${+h + 1}, alinea ${+a + 1}${l != null ? `, opsomming ${+l + 1}` : ''}`);
const leesbaar = (f: string) => { for (const [rx, t] of VERTAAL) if (rx.test(f)) return f.replace(/^.*$/, () => t.replace('$1', f.match(rx)?.[1] ?? '')); return f; };

export function deelIn(r: Rij | null) {
  const uit = { blokkerend: [] as { bron: string; tekst: string }[], aandacht: [] as { bron: string; tekst: string }[], info: [] as { bron: string; tekst: string }[] };
  if (!r) return uit;
  for (const f of r.aanlevering?.fouten ?? []) (VOOR_PUBLICATIE.test(f) ? uit.aandacht : uit.blokkerend).push({ bron: 'aanleveringscontrole', tekst: leesbaar(f) });
  for (const w of r.aanlevering?.waarschuwingen ?? []) (INFO.test(w) || /kleiner dan \d+ px/.test(w) ? uit.info : uit.aandacht).push({ bron: 'aanleveringscontrole', tekst: w.replace(/^teksten\.md: /, 'Teksten: ') });
  for (const f of r.manifest?.fouten ?? []) if (!/canonical/.test(f) || !(r.aanlevering?.fouten ?? []).some((x: string) => /canonical/.test(x))) uit.blokkerend.push({ bron: 'manifestschema', tekst: f });
  for (const f of r.feiten?.fouten ?? []) uit.blokkerend.push({ bron: 'feitencontrole', tekst: pad(f) });
  for (const m of r.feiten?.meldingen ?? []) uit.aandacht.push({ bron: 'feitencontrole', tekst: pad(m) });
  for (const b of r.bedragen ?? []) {
    const t = typeof b === 'string' ? { tekst: b, feit: null } : b;
    if (t.feit) uit.info.push({ bron: 'bedragen', tekst: `'${t.tekst}' is vastgelegd als feit '${t.feit}' (niet automatisch gepubliceerd). De zin staat ongewijzigd in de brochuretekst; de makelaar bepaalt wat er op de website komt.` });
    else uit.aandacht.push({ bron: 'bedragen', tekst: `Bedrag in de tekst: '${t.tekst}'. Leg het vast als feit of controleer of het gepubliceerd mag worden.` });
  }
  for (const b of r.taal?.blokkerend ?? []) uit.blokkerend.push({ bron: 'taalcontrole', tekst: b.melding });
  for (const w of r.taal?.waarschuwingen ?? []) uit.aandacht.push({ bron: `taalcontrole (${w.controle})`, tekst: pad(w.melding) });
  if (r.feiten) uit.info.push({ bron: 'feitencontrole', tekst: `${r.feiten.getoetst} maten in de teksten getoetst aan de feiten` });
  if (r.export) uit.info.push({ bron: 'export', tekst: `${r.export.fotos} foto's, ${r.export.plattegronden} plattegronden, ${r.export.feiten} feiten${r.export.logo ? ', logo' : ''}${r.export.huisstijl ? ', huisstijl' : ''}` });
  return uit;
}

// ── Status: fasen, broncontrole, checklist en vrijgave ──────────────────────
// Snelle beoordeling: de bron overnemen als uitgangspunt. Dit is uitdrukkelijk géén inhoudelijke
// bevestiging: de gegevens behouden hun status 'overgenomen' en gaan als onbevestigd mee.
const OVERNAME = 'overgenomen als uitgangspunt';
export const OVERNAME_VERKLARING = 'Neem de aangeleverde brochuregegevens en overige broninformatie over als uitgangspunt voor het eerste concept.';

export async function beoordeling(c: pg.PoolClient, projectId: string) {
  const o = await overzicht(c, projectId);
  if (!o) return null;
  const p = (await c.query('SELECT slug, rechten, conceptadres, openingsbeeld_id, vrijgave, domein, profiel, status FROM project WHERE id = $1', [projectId])).rows[0];
  const vinger = await vingerafdruk(c, projectId);
  const kc = (await c.query(`SELECT id, volgnummer, klaar_op, duur_ms, rapport, vingerafdruk, generator_commit, aangevraagd_door FROM verwerking
    WHERE project_id = $1 AND soort = 'kwaliteitscontrole' ORDER BY volgnummer DESC LIMIT 1`, [projectId])).rows[0] ?? null;
  const resultaat = deelIn(kc?.rapport ?? null);
  const besluiten = await leesBesluiten(c, projectId);
  const eisen = (await generatorModule('packages/aanlevering/index.mjs')) as { EIS: Rij; EIS_BROCHURE: Rij };

  // Broncontrole.
  const g = o.gegevens as Rij[];
  const telling = {
    totaal: g.length,
    overgenomen: g.filter((x) => x.vastgelegd?.status === 'overgenomen').length,
    gecontroleerd: g.filter((x) => x.vastgelegd?.status === 'goedgekeurd' && x.vastgelegd.herkomst === 'brochure').length,
    gecorrigeerd: g.filter((x) => x.vastgelegd?.herkomst === 'handmatig').length,
    afgewezen: g.filter((x) => x.vastgelegd?.status === 'afgewezen').length,
    tegenstrijdig: g.filter((x) => x.conflict).length,
    opgelost: g.filter((x) => x.conflict && x.vastgelegd?.besluit).length,
    inhoudelijk: g.filter((x) => x.conflict?.ernst === 'conflict').length,
    inhoudelijk_opgelost: g.filter((x) => x.conflict?.ernst === 'conflict' && x.vastgelegd?.besluit).length,
    ontbrekend: g.filter((x) => !x.vastgelegd).length,
  };
  const teBeoordelen = g.filter((x) => x.vastgelegd?.status === 'overgenomen' || x.signalen.some((s: string) => s === 'tegenstrijdigheid' || s === 'terminologie')
    || (['adres', 'plaats'].includes(x.sleutel) && (!x.vastgelegd || x.vastgelegd.status === 'afgewezen')));
  const sleutelsTeBeoordelen = new Set(teBeoordelen.map((x) => x.sleutel));

  // Openingsbeeld: gekozen, in gebruik en groot genoeg (norm van de generator; brochure-aanlevering = brochurenorm).
  const fotos = (o.bestanden as Rij[]).filter((b) => b.soort === 'foto' && !b.vervallen && !b.dubbel_van);
  const heroNorm = eisen.EIS_BROCHURE.heroBreedte as number;
  const geschiktHero = fotos.filter((b) => b.breedte / b.hoogte >= 1.2 && b.breedte >= heroNorm);
  const hero = fotos.find((b) => b.id === p.openingsbeeld_id) ?? null;
  // Voorstel van de import: de omslagfoto van de brochure (eerste foto), als die geschikt is.
  const importVoorstel = geschiktHero.find((b) => b.herkomst === 'brochure' && /^fotos\/[^/]+\/01-/.test(b.originele_naam)) ?? null;

  // Fotokwaliteit: zijn er originelen nodig, dan is een bewuste beslissing nodig om met brochurebeelden een eerste concept te maken.
  const fotoset = createHash('sha1').update(fotos.map((b) => b.sha256).sort().join()).digest('hex').slice(0, 12);
  const fotoBesluit = besluiten.find((b) => b.onderwerp === 'fotokwaliteit');
  const fotoAkkoord = o.fotokwaliteit.originelen_nodig === 0 && o.fotokwaliteit.losse_onder_norm === 0
    || (fotoBesluit?.handeling === 'geaccepteerd voor eerste concept' && fotoBesluit.waarde?.fotoset === fotoset);

  // Bronovername (snelle beoordeling): geldt alleen voor de bronversie (import) waarvoor zij is bevestigd.
  const overnameBesluit = besluiten.find((b) => b.onderwerp === 'bronovername') ?? null;
  const overname = overnameBesluit?.handeling === OVERNAME && overnameBesluit.waarde?.import === o.import?.id ? overnameBesluit : null;

  const lopend = (o.verwerkingen as Rij[]).some((v) => v.soort !== 'kwaliteitscontrole' && ['wachtrij', 'bezig'].includes(v.status));
  const actueel = !!kc && kc.vingerafdruk === vinger;
  // Verplicht (blokkeert de conceptgeneratie): kritische gegevens, onopgeloste inhoudelijke
  // tegenstrijdigheden en de keuzes die de generator nodig heeft. Aanbevolen punten blokkeren niet,
  // maar blijven zichtbaar. Publicatie krijgt later eigen, strengere controles.
  const punt = (fase: number, code: string, titel: string, ok: boolean, actie: string, verplicht = true) => ({ fase, code, titel, ok, verplicht, actie: ok ? null : actie });
  const checklist = [
    punt(1, 'import', 'Brochure aangeleverd en geïmporteerd', !!o.import, 'Lever de brochure aan en start de import.'),
    punt(1, 'verwerking', 'Geen verwerking meer bezig', !lopend, 'Wacht tot de verwerking klaar is.'),
    punt(2, 'bron', 'Broninformatie overgenomen als uitgangspunt of afzonderlijk beoordeeld', telling.overgenomen === 0 || !!overname,
      'Bevestig dat de brochuregegevens als uitgangspunt voor het eerste concept worden overgenomen (snelle beoordeling), of beoordeel de gegevens afzonderlijk.'),
    // Fase-afhankelijk: voor een intern concept blokkeren tegenstrijdigheden niet. De gebruikte
    // (brochure)waarde gaat als onbevestigd mee en blijft zichtbaar; voor publicatie is een besluit verplicht.
    punt(2, 'tegenstrijdigheden', 'Inhoudelijke tegenstrijdigheden besloten', telling.inhoudelijk_opgelost === telling.inhoudelijk,
      `${telling.inhoudelijk - telling.inhoudelijk_opgelost} inhoudelijke tegenstrijdigheid/tegenstrijdigheden open: het concept gebruikt de vastgelegde waarde als onbevestigd. Vóór publicatie is een besluit verplicht.`, false),
    punt(2, 'gegevens', 'Alle gegevens afzonderlijk gecontroleerd', telling.overgenomen === 0, overname
      ? `${telling.overgenomen} gegeven(s) overgenomen als uitgangspunt, niet afzonderlijk gecontroleerd; ze gaan als onbevestigd mee. Controle vóór publicatie.`
      : `${telling.overgenomen} gegeven(s) nog niet beoordeeld; ze gaan als onbevestigd mee in het concept.`, false),
    punt(2, 'terminologie', 'Terminologische afwijkingen beoordeeld', telling.opgelost - telling.inhoudelijk_opgelost === telling.tegenstrijdig - telling.inhoudelijk,
      'Beoordeel de mogelijke terminologische afwijking(en).', false),
    punt(2, 'verplicht', 'Straat, huisnummer en plaats vastgelegd', ['adres', 'plaats'].every((s) => g.some((x) => x.sleutel === s && x.vastgelegd && x.vastgelegd.status !== 'afgewezen')), 'Vul straat, huisnummer en plaats aan.'),
    // Fase-afhankelijk: het interne concept is afgeschermd en wordt niet gepubliceerd. Publicatierechten en het
    // definitieve domein blokkeren het daarom niet; vóór publicatie zijn beide verplicht.
    punt(3, 'rechten', 'Publicatierechten foto\'s en teksten bevestigd', !!p.rechten?.bevestigd,
      'Nog niet bevestigd: blokkeert het interne concept niet. Vóór publicatie verplicht, met een korte toelichting.', false),
    punt(3, 'profiel', 'Presentatieprofiel gekozen', !!p.profiel, 'Kies het presentatieprofiel.'),
    punt(3, 'websiteadres', 'Definitief websiteadres vastgelegd', !!p.domein,
      `Het interne concept krijgt het tijdelijke adres ${p.slug}.invalid. Vóór publicatie is het definitieve domein verplicht.`, false),
    punt(3, 'openingsbeeld', 'Openingsbeeld gekozen', !!hero && geschiktHero.some((b) => b.id === hero.id), geschiktHero.length ? 'Kies het openingsbeeld uit de geschikte foto\'s.' : `Geen foto is geschikt (liggend, ≥ ${heroNorm} px): lever een origineel aan.`),
    punt(3, 'fotokwaliteit', 'Fotokwaliteit beoordeeld', fotoAkkoord, 'Originele foto\'s ontbreken; het concept gebruikt de brochurebeelden.', false),
    punt(3, 'kwaliteitscontrole', 'Kwaliteitscontrole uitgevoerd op de huidige stand, zonder blokkades', actueel && resultaat.blokkerend.length === 0,
      !kc ? 'Voer de kwaliteitscontrole uit.' : !actueel ? 'Er is iets gewijzigd: voer de kwaliteitscontrole opnieuw uit.' : `Los ${resultaat.blokkerend.length} blokkade(s) op en voer de controle opnieuw uit.`),
  ];
  // Vrijgegeven blijft gelden na het genereren (status interne review of correctie); een wijziging
  // vóór de generatie laat de vrijgave vervallen (trigger), daarna bewaakt de vingerafdruk de actualiteit.
  const vrijgegeven = o.project.status !== 'aanlevering_incompleet' && !!p.vrijgave?.op && !p.vrijgave?.vervallen_op;
  const klaar = checklist.filter((x) => x.verplicht).every((x) => x.ok);
  const faseStatus = (n: number) => {
    const punten = checklist.filter((x) => x.fase === n);
    const open = punten.filter((x) => !x.ok && x.verplicht).length;
    const aanbevolen = punten.filter((x) => !x.ok && !x.verplicht).length;
    const eerder = checklist.filter((x) => x.fase < n && x.verplicht).every((x) => x.ok);
    return { open, aanbevolen, status: open === 0 ? 'gereed' : eerder ? 'open' : 'wacht' };
  };
  const fasen = [
    { nr: 1, naam: 'Aanlevering', ...faseStatus(1) },
    { nr: 2, naam: 'Broncontrole', ...faseStatus(2) },
    { nr: 3, naam: 'Kwaliteitscontrole', ...faseStatus(3) },
    { nr: 4, naam: 'Vrijgave voor conceptgeneratie', open: vrijgegeven ? 0 : 1, aanbevolen: 0, status: vrijgegeven ? 'gereed' : klaar ? 'open' : 'wacht' },
  ];
  return {
    project: o.project, fasen, checklist, klaar, vingerafdruk: vinger,
    broncontrole: { telling, te_beoordelen: teBeoordelen, vastgesteld: g.filter((x) => !sleutelsTeBeoordelen.has(x.sleutel)) },
    kwaliteit: kc && { id: kc.id, volgnummer: kc.volgnummer, klaar_op: kc.klaar_op, duur_ms: kc.duur_ms, generator_commit: kc.generator_commit, actueel, resultaat, indeling: deelControleIn(resultaat), taal: kc.rapport.taal?.meetwaarden ?? [] },
    meldingen: o.meldingen, fotokwaliteit: o.fotokwaliteit,
    beslissingen: {
      rechten: p.rechten, profiel: p.profiel, profiel_voorstel: o.import?.profiel ?? null, domein: p.domein, conceptadres: p.conceptadres,
      openingsbeeld: hero, openingsbeeld_norm: heroNorm, openingsbeeld_kandidaten: geschiktHero, openingsbeeld_voorstel: importVoorstel?.id ?? null,
      fotokwaliteit: { nodig: !(o.fotokwaliteit.originelen_nodig === 0 && o.fotokwaliteit.losse_onder_norm === 0), akkoord: fotoAkkoord, besluit: fotoBesluit ?? null, fotoset },
    },
    vrijgave: { ...(p.vrijgave ?? {}), vrijgegeven, actueel: vrijgegeven && p.vrijgave?.vingerafdruk === vinger },
    bronovername: {
      geldig: !!overname, besluit: overname, verklaring: OVERNAME_VERKLARING,
      // Een eerdere overname voor een andere bronversie (bijvoorbeeld vóór een nieuwe import) geldt niet meer.
      verouderd: overnameBesluit?.handeling === OVERNAME && !overname,
      bron: o.import ? { import: o.import.id, volgnummer: o.import.volgnummer, bestand: o.import.bron ?? null, sha256: o.import.sha256 ?? null } : null,
    },
    besluiten,
  };
}

/**
 * Waarop een concept rust, vastgelegd bij het genereren: de bronovername en de open onzekerheden
 * (gebruikte waarde, de bronnen die elkaar tegenspreken). De studio lost niets zelf op en vult
 * niets aan; wat ontbreekt blijft ontbreken.
 */
export async function uitgangspunten(c: pg.PoolClient, projectId: string) {
  const st = await beoordeling(c, projectId);
  if (!st) return null;
  const g = [...st.broncontrole.te_beoordelen, ...st.broncontrole.vastgesteld] as Rij[];
  const waarde = (x: Rij) => (x.vastgelegd ? `${x.vastgelegd.waarde}${x.vastgelegd.eenheid ? ` ${x.vastgelegd.eenheid}` : ''}` : null);
  return {
    bronovername: st.bronovername.besluit ? { door: st.bronovername.besluit.door, op: st.bronovername.besluit.op, ...st.bronovername.besluit.waarde } : null,
    onzekerheden: g.filter((x) => x.conflict && !x.vastgelegd?.besluit && x.vastgelegd?.status !== 'afgewezen').map((x) => ({
      sleutel: x.sleutel, gegeven: x.label, soort: x.conflict.ernst === 'conflict' ? 'tegenstrijdigheid' : 'terminologie',
      gebruikte_waarde: waarde(x), verificatie: x.vastgelegd?.status === 'goedgekeurd' ? 'bevestigd' : 'onbevestigd', bronnen: x.conflict.bronnen, bron: x.vastgelegd?.bron ?? null,
    })),
    onbevestigd: g.filter((x) => x.vastgelegd?.status === 'overgenomen').map((x) => x.label),
    ontbrekend: g.filter((x) => !x.vastgelegd).map((x) => x.label),
    gecontroleerd: st.broncontrole.telling.gecontroleerd + st.broncontrole.telling.gecorrigeerd,
    // Intern concept: wat vóór publicatie nog verplicht is.
    voor_publicatie: {
      publicatierechten: st.beslissingen.rechten?.bevestigd ? 'bevestigd' : 'niet bevestigd',
      websiteadres: st.beslissingen.domein ? `https://${st.beslissingen.domein}/` : `tijdelijk: https://${st.project.slug}.invalid/ (niet bereikbaar)`,
    },
  };
}

/** Een beslissing op projectniveau. Elke beslissing komt in het besluitenlog. */
export async function beslis(c: pg.PoolClient, gebruiker: string, projectId: string, onderwerp: string, b: Rij) {
  const st = await beoordeling(c, projectId);
  if (!st) return { fout: 'onbekend' as const };
  const motivering = typeof b.motivering === 'string' ? b.motivering.trim() : '';
  const log = (handeling: string, waarde?: unknown) => legVast(c, { project: projectId, door: gebruiker, onderwerp, handeling, waarde, motivering });
  const zet = (sql: string, v: unknown[]) => c.query(`UPDATE project SET ${sql}, gewijzigd_op = now() WHERE id = $1`, [projectId, ...v]);
  if (onderwerp === 'bronovername') {
    const imp = await laatsteImport(c, projectId);
    if (!imp) return { fout: 'waarde' as const, melding: 'Er is nog geen brochure-import om over te nemen' };
    if (b.bevestigd === true) {
      const g = [...st.broncontrole.te_beoordelen, ...st.broncontrole.vastgesteld] as Rij[];
      const open = (ernst: string) => g.filter((x) => x.conflict?.ernst === ernst && !x.vastgelegd?.besluit).map((x) => x.label);
      // Wie, wanneer (besluitenlog) en welke bronversie: import, bestand en sha256 van de brochure.
      await log(OVERNAME, {
        import: imp.id, volgnummer: imp.volgnummer, bestand: imp.rapport?.bron ?? null, sha256: imp.rapport?.sha256 ?? null, generator_commit: imp.generator_commit,
        verklaring: OVERNAME_VERKLARING, betekenis: 'uitgangspunt voor het eerste concept; geen inhoudelijke bevestiging of individuele verificatie van de feiten',
        overgenomen: st.broncontrole.telling.overgenomen, open_tegenstrijdigheden: open('conflict'), open_terminologie: open('onduidelijk'),
      });
    } else if (b.bevestigd === false) await log('overname ingetrokken', { import: imp.id });
    else return { fout: 'waarde' as const, melding: 'Bevestig of trek de overname in' };
  } else if (onderwerp === 'rechten') {
    if (b.bevestigd === true) {
      if (motivering.length < 3) return { fout: 'motivering' as const };
      await zet('rechten = $2', [JSON.stringify({ bevestigd: true, toelichting: motivering, door: gebruiker, op: new Date().toISOString() })]);
      await log('bevestigd');
    } else { await zet('rechten = NULL', []); await log('ingetrokken'); }
  } else if (onderwerp === 'profiel') {
    if (!(await profielen()).includes(String(b.profiel))) return { fout: 'waarde' as const, melding: 'Onbekend presentatieprofiel' };
    await zet('profiel = $2', [b.profiel]); await log('gekozen', { profiel: b.profiel, voorstel: st.beslissingen.profiel_voorstel?.waarde ?? null });
  } else if (onderwerp === 'websiteadres') {
    if (b.conceptadres === true) { await zet('conceptadres = true', []); await log('tijdelijk conceptadres', { adres: `${st.project.slug}.invalid` }); }
    else {
      const d = String(b.domein ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)) return { fout: 'waarde' as const, melding: 'Geen geldige domeinnaam' };
      await zet('domein = $2, conceptadres = false', [d]); await log('domein vastgelegd', { domein: d });
    }
  } else if (onderwerp === 'openingsbeeld') {
    if (!st.beslissingen.openingsbeeld_kandidaten.some((x: Rij) => x.id === b.bestand_id)) return { fout: 'waarde' as const, melding: `Kies een liggende foto van minimaal ${st.beslissingen.openingsbeeld_norm} px` };
    await zet('openingsbeeld_id = $2', [b.bestand_id]);
    const f = st.beslissingen.openingsbeeld_kandidaten.find((x: Rij) => x.id === b.bestand_id)!;
    await log('gekozen', { bestand: b.bestand_id, beeld: f.herkomst === 'brochure' ? `brochure p. ${f.pagina}` : 'losse foto', maat: `${f.breedte}×${f.hoogte}` });
  } else if (onderwerp === 'fotokwaliteit') {
    if (motivering.length < 3) return { fout: 'motivering' as const };
    await log('geaccepteerd voor eerste concept', { fotoset: st.beslissingen.fotokwaliteit.fotoset, originelen_nodig: st.fotokwaliteit.originelen_nodig, geschikt: st.fotokwaliteit.geschikt });
  } else if (onderwerp === 'vrijgave') {
    if (!st.klaar) return { fout: 'niet_klaar' as const, open: st.checklist.filter((x) => !x.ok && x.verplicht) };
    // Vrijgave voor conceptgeneratie; nooit publicatie. Er wordt niets gegenereerd.
    await zet(`status = 'klaar_voor_productie', vrijgave = $2`, [JSON.stringify({ door: gebruiker, op: new Date().toISOString(), motivering: motivering || null,
      vingerafdruk: st.vingerafdruk, kwaliteitscontrole: st.kwaliteit?.id, betekenis: 'gereed voor een eerste concept; geen publicatie' })]);
    await log('vrijgegeven voor conceptgeneratie', { vingerafdruk: st.vingerafdruk.slice(0, 12), kwaliteitscontrole: st.kwaliteit?.volgnummer });
  } else if (onderwerp === 'intrekken') {
    if (motivering.length < 3) return { fout: 'motivering' as const };
    await zet(`status = 'aanlevering_incompleet', vrijgave = coalesce(vrijgave, '{}'::jsonb) || $2`, [JSON.stringify({ vervallen_op: new Date().toISOString(), vervallen_door: 'ingetrokken' })]);
    await log('vrijgave ingetrokken');
  } else return { fout: 'onderwerp' as const };
  await audit(c, { gebruiker, actie: `beslissing_${onderwerp}`, tabel: 'project', id: projectId, nieuw: { ...b } });
  return { beoordeling: await beoordeling(c, projectId) };
}


/**
 * Snelle beoordeling: in één handeling de bron overnemen als uitgangspunt, de verplichte keuzes
 * vastleggen (met voorstellen van de import als standaard), de kwaliteitscontrole uitvoeren en
 * vrijgeven als alles verplichte in orde is. Gebruikt uitsluitend de bestaande beslissingen; elke
 * stap komt afzonderlijk in het besluitenlog. Eerst wordt alle invoer gecontroleerd, daarna pas
 * vastgelegd. De gegevens zelf blijven 'overgenomen' (geen individuele verificatie).
 */
export async function snelleBeoordeling(c: pg.PoolClient, gebruiker: string, projectId: string, b: Rij) {
  const st = await beoordeling(c, projectId);
  if (!st) return { fout: 'onbekend' as const };
  if (b.overnemen !== true) return { fout: 'waarde' as const, melding: 'Bevestig dat de broninformatie als uitgangspunt wordt overgenomen' };
  if (!st.bronovername.bron) return { fout: 'waarde' as const, melding: 'Er is nog geen brochure-import om over te nemen' };
  const tekst = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
  const bs = st.beslissingen;
  const plan: [string, Rij, string][] = [];
  if (!st.bronovername.geldig) plan.push(['bronovername', { bevestigd: true, motivering: tekst(b.motivering) || 'snelle beoordeling' }, 'broninformatie overgenomen als uitgangspunt']);
  // Publicatierechten: optioneel voor het interne concept (vóór publicatie verplicht). Alleen bevestigen met toelichting.
  if (!bs.rechten?.bevestigd && tekst(b.rechten)) {
    if (tekst(b.rechten).length < 3) return { fout: 'waarde' as const, melding: 'Licht toe waarop de publicatierechten berusten' };
    plan.push(['rechten', { bevestigd: true, motivering: tekst(b.rechten) }, 'publicatierechten bevestigd']);
  }
  if (!bs.profiel) {
    const profiel = tekst(b.profiel) || bs.profiel_voorstel?.waarde;
    if (!profiel) return { fout: 'waarde' as const, melding: 'Kies een presentatieprofiel' };
    if (!(await profielen()).includes(profiel)) return { fout: 'waarde' as const, melding: 'Onbekend presentatieprofiel' };
    plan.push(['profiel', { profiel, motivering: 'snelle beoordeling' }, `profiel ${profiel}`]);
  }
  if (!bs.domein && !bs.conceptadres) plan.push(['websiteadres', tekst(b.domein) ? { domein: tekst(b.domein) } : { conceptadres: true, motivering: 'snelle beoordeling' }, tekst(b.domein) ? `domein ${tekst(b.domein)}` : 'tijdelijk conceptadres']);
  if (!st.checklist.find((x) => x.code === 'openingsbeeld')?.ok) {
    const id = tekst(b.openingsbeeld) || bs.openingsbeeld_voorstel;
    if (!id || !bs.openingsbeeld_kandidaten.some((x: Rij) => x.id === id)) return { fout: 'waarde' as const, melding: 'Kies een geschikt openingsbeeld' };
    plan.push(['openingsbeeld', { bestand_id: id, motivering: 'snelle beoordeling' }, 'openingsbeeld gekozen']);
  }
  // Fotokwaliteit is aanbevolen, niet verplicht: alleen vastleggen als er een toelichting is.
  if (bs.fotokwaliteit.nodig && !bs.fotokwaliteit.akkoord && tekst(b.fotokwaliteit).length >= 3)
    plan.push(['fotokwaliteit', { motivering: tekst(b.fotokwaliteit) }, 'fotokwaliteit geaccepteerd voor het eerste concept']);

  const gedaan: string[] = [];
  for (const [onderwerp, data, wat] of plan) {
    const r = await beslis(c, gebruiker, projectId, onderwerp, data);
    if ('fout' in r) throw new Error(`snelle beoordeling: ${onderwerp} geweigerd na de controle vooraf`);
    gedaan.push(wat);
  }
  let na = (await beoordeling(c, projectId))!;
  if (!na.kwaliteit?.actueel) { await kwaliteitscontrole(c, gebruiker, projectId); gedaan.push('kwaliteitscontrole uitgevoerd'); na = (await beoordeling(c, projectId))!; }
  if (na.klaar && !na.vrijgave.vrijgegeven) {
    await beslis(c, gebruiker, projectId, 'vrijgave', { motivering: tekst(b.motivering) || 'snelle beoordeling' });
    gedaan.push('vrijgegeven voor conceptgeneratie'); na = (await beoordeling(c, projectId))!;
  }
  return { beoordeling: na, gedaan, open: na.checklist.filter((x) => x.verplicht && !x.ok) };
}
