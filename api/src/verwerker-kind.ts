// Kindproces van de verwerking: draait de bestaande brochure-import, de aanleveringscontrole en de
// lokale beeldclassificatie van de generator, buiten de API (die blijft zo bereikbaar; de
// classificatie blokkeert een proces tientallen seconden). Raakt de database niet.
//
// Invoer (stdin, JSON): { pdf?, uit?, fotos: [{ id, pad }], classificeer }
// Uitvoer (stdout, JSON): { rapport?, controle?, beelden: [...], classificatie: {...}, tijden_ms }
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { config } from './config.ts';
import { sharp } from './generator.ts';

const gen = (rel: string) => import(pathToFileURL(join(config.generator, rel)).href);

type Invoer = { pdf?: string; uit?: string; fotos: { id: string; pad: string }[]; classificeer: boolean };

async function dhash(bytes: Buffer) {
  // Zelfde dHash als packages/media en packages/aanlevering (9×8 grijs, na EXIF-rotatie).
  const { data } = await sharp(bytes).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let bits = ''; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += data[y * 9 + x] > data[y * 9 + x + 1] ? '1' : '0';
  return BigInt('0b' + bits).toString(16).padStart(16, '0');
}

async function main() {
  const invoer: Invoer = JSON.parse(readFileSync(0, 'utf8'));
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
