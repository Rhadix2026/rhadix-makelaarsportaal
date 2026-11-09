// Kindproces van de verwerking: draait de bestaande brochure-import, de aanleveringscontrole en de
// lokale beeldclassificatie van de generator, buiten de API (die blijft zo bereikbaar; de
// classificatie blokkeert een proces tientallen seconden). Raakt de database niet.
//
// Invoer (stdin, JSON): { pdf?, uit?, fotos: [{ id, pad }], classificeer }
// Uitvoer (stdout, JSON): { rapport?, controle?, beelden: [...], classificatie: {...}, tijden_ms }
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.ts';
import { VOOR_PUBLICATIE } from './fasen.ts';
import { generatorCommit, generatorVersie, sharp, valideerManifest } from './generator.ts';

const gen = (rel: string) => import(pathToFileURL(join(config.generator, rel)).href);

type Invoer = { pdf?: string; uit?: string; fotos: { id: string; pad: string }[]; classificeer: boolean; concept?: Concept };
type Concept = { aanlevering: string; woning: string; site: string; ontwerpsysteem: string; classificaties: Record<string, Record<string, unknown>>; classificeer: boolean };

/** Een mp-opdracht in de productie-instantie (cwd daar; schrijft alleen in genegeerde mappen en in --uit). */
function mp(args: string[]): Promise<{ code: number; uit: string; ms: number }> {
  const t = performance.now();
  return new Promise((resolve, reject) => {
    const k = spawn(process.execPath, [join(config.generator, 'tools', 'mp.mjs'), ...args], { cwd: config.generator,
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(config.generator, '.cache', 'ms-playwright'), ASTRO_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let uit = '';
    k.stdout.on('data', (d) => (uit += d)); k.stderr.on('data', (d) => (uit += d));
    k.on('error', reject);
    k.on('close', (code) => resolve({ code: code ?? 1, uit, ms: Math.round(performance.now() - t) }));
  });
}

/**
 * Conceptgeneratie met de bestaande generator:
 *   1. controleerAanlevering() en naarManifest() op de export (wat `mp aanleveren` doet, maar met de
 *      woningmap in de studio-opslag in plaats van woningen/<slug> van de productie-instantie);
 *   2. de classificatie uit de aanlevering in het manifest + altUitCategorie() (wat `mp classificeer` doet);
 *   3. `mp bouw <woningmap> --uit <site>`: automatische compositie, renderen, QA;
 *   4. `mp kwaliteit <woningmap> --uit <site>`: kwaliteitsrapport Design System 1.0.
 */
async function concept(k: Concept) {
  const tijden: Record<string, number> = {};
  let t = performance.now();
  const { controleerAanlevering, naarManifest } = await gen('packages/aanlevering/index.mjs');
  const { altUitCategorie } = await gen('packages/ai/index.mjs');
  const a = await controleerAanlevering(k.aanlevering);
  // De generator controleert ook wat pas vóór publicatie verplicht is (bevestigde publicatierechten). Voor het
  // interne, afgeschermde concept mag alleen die melding openstaan; elke andere fout blijft de generatie stoppen.
  const fouten = (a.fouten as string[]).filter((f) => !VOOR_PUBLICATIE.test(f));
  if (fouten.length) throw new Error(`aanlevering onvolledig: ${fouten.join('; ')}`);
  const { manifest, kopie } = naarManifest(a.gegevens, generatorVersie(), null);
  // De versie die bij het aanmaken van het project is vastgezet.
  if (k.ontwerpsysteem && k.ontwerpsysteem !== '0') manifest.ontwerpsysteem = k.ontwerpsysteem;
  tijden.aanleveren = Math.round(performance.now() - t);

  t = performance.now();
  const fotos = manifest.media.filter((m: { soort: string; publiceren?: boolean }) => m.soort === 'foto' && m.publiceren !== false);
  let hergebruikt = 0;
  const zonder: { m: Record<string, unknown>; pad: string }[] = [];
  for (const m of fotos) {
    const c = k.classificaties[m.bron];
    if (c) { const { categorie, score, alternatief, alt_score, marge, controle, model } = c as Record<string, unknown>; m.classificatie = { categorie, score, alternatief, alt_score, marge, controle, model }; hergebruikt++; }
    else zonder.push({ m, pad: join(k.aanlevering, m.bron) });
  }
  if (zonder.length && k.classificeer) {
    const { SIGLIP } = await gen('packages/ai/siglip.mjs');
    const r = SIGLIP.classificeerBeelden(zonder.map((x) => x.pad));
    if (!r.niet_beschikbaar) r.resultaten.forEach((x: Record<string, unknown>, i: number) => {
      const { categorie, score, alternatief, alt_score, marge, controle } = x;
      zonder[i].m.classificatie = { categorie, score, alternatief, alt_score, marge, controle, model: `${r.model}@${String(r.revisie).slice(0, 7)}` };
    });
  }
  const alts = altUitCategorie(manifest.media, manifest.woning.naam);
  tijden.classificatie = Math.round(performance.now() - t);

  t = performance.now();
  rmSync(k.woning, { recursive: true, force: true });
  mkdirSync(join(k.woning, 'media', 'foto'), { recursive: true });
  for (const x of kopie as { van: string; naar: string }[]) { mkdirSync(dirname(join(k.woning, x.naar)), { recursive: true }); cpSync(join(k.aanlevering, x.van), join(k.woning, x.naar)); }
  writeFileSync(join(k.woning, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const schema = valideerManifest(manifest);
  if (schema.length) throw new Error(`manifest ongeldig: ${schema.join('; ')}`);
  tijden.woningmap = Math.round(performance.now() - t);

  const bouw = await mp(['bouw', k.woning, '--uit', k.site]);
  tijden.bouw = bouw.ms;
  if (!existsSync(`${k.site}.bouw.json`)) throw new Error(`mp bouw mislukt: ${bouw.uit.split('\n').filter((r) => /✗|Error|fout/i.test(r)).slice(0, 4).join(' | ') || `code ${bouw.code}`}`);
  const kw = await mp(['kwaliteit', k.woning, '--uit', k.site]);
  tijden.kwaliteit = kw.ms;
  // De runbestanden die mp in de productie-instantie achterlaat (.cache/<slug>-*, metingen/<slug>-*) bevatten
  // woninggegevens: verplaatsen naar de conceptmap, zodat de productie-instantie geen klantgegevens bewaart.
  const slug = k.woning.split('/').pop()!;
  const log = join(dirname(k.site), 'generator-log');
  mkdirSync(log, { recursive: true });
  for (const sub of ['.cache', 'metingen']) {
    const d = join(config.generator, sub);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((x) => x.startsWith(`${slug}-`))) { cpSync(join(d, f), join(log, `${sub.replace('.', '')}-${f}`)); rmSync(join(d, f), { force: true }); }
  }
  const b = JSON.parse(readFileSync(`${k.site}.bouw.json`, 'utf8'));
  const kwaliteit = existsSync(`${k.site}.kwaliteit.json`) ? JSON.parse(readFileSync(`${k.site}.kwaliteit.json`, 'utf8')) : null;
  const q = b.rapport.qa ?? {};
  return {
    generator_commit: generatorCommit(), tijden_ms: tijden,
    classificatie: { hergebruikt, nieuw: zonder.length, alt_uit_categorie: alts },
    bouw: { vingerafdruk: b.vingerafdruk, gebouwd: b.gebouwd, generator: b.generator, ontwerpsysteem: b.ontwerpsysteem, profiel: b.profiel, lettertypepaar: b.lettertypepaar ?? null,
      rapport: { modus: b.rapport.modus, totaal_ms: b.rapport.totaal_ms, correcties: b.rapport.correcties ?? 0, besluiten: b.rapport.besluiten ?? [], regels: b.rapport.regels ?? [],
        waarschuwingen: b.rapport.waarschuwingen ?? [], qa: { feiten: q.feiten, site: q.site, bijna_dubbel: q.bijna_dubbel, presentatie: q.presentatie } },
      onderdelen: (b.compositie ?? []).map((c: { blok: string; variant?: string }) => `${c.blok}${c.variant ? `:${c.variant}` : ''}`), exit: bouw.code },
    kwaliteit: kwaliteit && { blokkerend: kwaliteit.blokkerend, meetwaarden: kwaliteit.meetwaarden, waarschuwingen: kwaliteit.waarschuwingen, menselijk: kwaliteit.menselijk,
      publiceerbaar: kwaliteit.publiceerbaar, redenen: kwaliteit.redenen, ontwerpsysteem: kwaliteit.ontwerpsysteem, exit: kw.code },
  };
}

async function dhash(bytes: Buffer) {
  // Zelfde dHash als packages/media en packages/aanlevering (9×8 grijs, na EXIF-rotatie).
  const { data } = await sharp(bytes).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = ''; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += data[y * 9 + x] > data[y * 9 + x + 1] ? '1' : '0';
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}

async function main() {
  const invoer: Invoer = JSON.parse(readFileSync(0, 'utf8'));
  if (invoer.concept) { process.stdout.write(JSON.stringify(await concept(invoer.concept))); return; }
  const tijden: Record<string, number> = {};
  const uit: Record<string, unknown> = { beelden: [], classificatie: null };

  if (invoer.pdf && invoer.uit) {
    const { importeer } = await gen('packages/import/index.mjs');
    const { controleerAanlevering } = await gen('packages/aanlevering/index.mjs');
    let t = performance.now();
    // Tijdelijke slug volgens het ontwerp (import-…): nooit een echte woningmap in de generator.
    const rapport = await importeer(invoer.pdf, { uit: invoer.uit, slug: `import-${createHash('sha1').update(invoer.uit).digest('hex').slice(0, 8)}` });
    tijden.import = Math.round(performance.now() - t);
    t = performance.now();
    const c = await controleerAanlevering(invoer.uit);
    tijden.controle = Math.round(performance.now() - t);
    uit.rapport = rapport;
    uit.controle = { ok: c.ok, fouten: c.fouten, waarschuwingen: c.waarschuwingen, samenvatting: c.samenvatting };
    // Kenmerken van de beelden die de import heeft weggeschreven (origineel uit de PDF).
    const beelden = [];
    for (const b of rapport.beelden as { bestand: string | null; soort: string; pagina: number; origineel?: boolean; omslag?: boolean }[]) {
      if (!b.bestand) continue;
      const bytes = readFileSync(join(invoer.uit, b.bestand));
      const md = await sharp(bytes).metadata();
      const draai = (md.orientation ?? 1) >= 5;
      beelden.push({ ...b, sha256: createHash('sha256').update(bytes).digest('hex'), grootte: bytes.length,
        breedte: draai ? md.height : md.width, hoogte: draai ? md.width : md.height,
        mime: md.format === 'png' ? 'image/png' : 'image/jpeg', dhash: b.soort === 'logo' ? null : await dhash(bytes),
        hoofdstuk: b.bestand.startsWith('fotos/') ? b.bestand.split('/')[1] : null });
    }
    uit.beelden = beelden;
    if (invoer.classificeer) invoer.fotos.push(...beelden.filter((b) => b.soort === 'foto').map((b) => ({ id: `brochure:${b.bestand}`, pad: join(invoer.uit!, b.bestand!) })));
  }

  if (invoer.classificeer && invoer.fotos.length) {
    const { SIGLIP } = await gen('packages/ai/siglip.mjs');
    const t = performance.now();
    const r = SIGLIP.classificeerBeelden(invoer.fotos.map((f) => f.pad));
    tijden.classificatie = Math.round(performance.now() - t);
    if (r.niet_beschikbaar) uit.classificatie = { beschikbaar: false, ontbreekt: r.niet_beschikbaar };
    else uit.classificatie = { beschikbaar: true, model: `${r.model}@${String(r.revisie).slice(0, 7)}`, laden_s: r.tijd_s?.laden, per_beeld_s: r.tijd_s?.per_beeld,
      resultaten: Object.fromEntries(r.resultaten.map((x: Record<string, unknown>, i: number) => [invoer.fotos[i].id,
        { categorie: x.categorie, score: x.score, alternatief: x.alternatief, alt_score: x.alt_score, marge: x.marge, controle: x.controle }])) };
  }
  uit.tijden_ms = tijden;
  process.stdout.write(JSON.stringify(uit));
}

main().catch((e) => { process.stderr.write(String(e?.stack ?? e)); process.exit(1); });
