// Adapter naar de bestaande generator (productie-instantie: een lokale kloon op een vaste commit).
// De studio bouwt hier niets na: hij leest de instantie en roept later de bestaande mp-opdrachten
// aan. In stap 1 alleen lezen: versie, ontwerpsysteem, profielen, opdrachten en of de lokale
// beeldclassificatie en Chromium beschikbaar zijn.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './config.ts';

/** De commit waarop de studio is getest; een andere commit wordt gemeld, niet geweigerd. */
export const VERWACHTE_COMMIT = '4eb7f2cc3f91cb1171120bc6c5657b773aef31ae';

const G = config.generator;
const importeer = (rel: string) => import(pathToFileURL(join(G, rel)).href);
const git = (...args: string[]) => execFileSync('git', ['-C', G, ...args], { encoding: 'utf8' }).trim();

/** De stijlprofielen van de generator (packages/tokens/profielen); de studio kopieert ze niet. */
export async function profielen(): Promise<string[]> {
  return readdirSync(join(G, 'packages', 'tokens', 'profielen'))
    .filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
}

/** Profielen met hun omschrijving, rechtstreeks uit de profielbestanden van de generator. */
export async function profielCatalogus(): Promise<{ naam: string; omschrijving: string }[]> {
  return (await profielen()).map((naam) => {
    const p = JSON.parse(readFileSync(join(G, 'packages', 'tokens', 'profielen', `${naam}.json`), 'utf8'));
    return { naam, omschrijving: String(p.omschrijving ?? '').replace(/\s*\(zie docs\/[^)]*\)/, '') };
  });
}

/** De standaard-ontwerpsysteemversie voor nieuwe woningen, uit de generator (versies.mjs). */
export async function standaardOntwerpsysteem(): Promise<string> {
  const { standaardVersie } = await importeer('packages/tokens/versies.mjs');
  return standaardVersie();
}

export async function generatorStatus() {
  if (!existsSync(join(G, 'tools', 'mp.mjs'))) return { gevonden: false, pad: G };

  const commit = git('rev-parse', 'HEAD');
  const gewijzigd = git('status', '--porcelain').split('\n').filter(Boolean).length;
  const mp = readFileSync(join(G, 'tools', 'mp.mjs'), 'utf8');
  const versie = mp.match(/const GENERATOR_VERSIE = '([^']+)'/)?.[1] ?? null;
  const opdrachten = [...mp.matchAll(/opdracht === '([a-z-]+)'/g)].map((m) => m[1]);

  const { VERSIES, standaardVersie } = await importeer('packages/tokens/versies.mjs');
  const { SIGLIP } = await importeer('packages/ai/siglip.mjs');
  const siglip = SIGLIP.beschikbaar() as { ok: boolean; ontbreekt: string[] };

  return {
    gevonden: true,
    pad: G,
    commit,
    commit_verwacht: commit === VERWACHTE_COMMIT,
    werkmap_schoon: gewijzigd === 0,
    versie,
    node: readFileSync(join(G, '.nvmrc'), 'utf8').trim(),
    opdrachten,
    ontwerpsysteem: {
      standaard: standaardVersie() as string,
      versies: Object.entries(VERSIES as Record<string, { status: string; omschrijving?: string }>)
        .map(([v, x]) => ({ versie: v, status: x.status, omschrijving: x.omschrijving ?? null })),
    },
    profielen: await profielen(),
    beeldclassificatie: { beschikbaar: siglip.ok, model: SIGLIP.model as string, ontbreekt: siglip.ontbreekt },
    chromium: chromiumStatus(),
  };
}

function chromiumStatus() {
  // Zelfde locatie als de generator gebruikt (PLAYWRIGHT_BROWSERS_PATH=.cache/ms-playwright).
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(G, '.cache', 'ms-playwright');
  try {
    const require = createRequire(join(G, 'package.json'));
    const { chromium } = require('playwright');
    const pad: string = chromium.executablePath();
    return { beschikbaar: existsSync(pad), versie: require('playwright/package.json').version as string };
  } catch (e) {
    return { beschikbaar: false, fout: (e as Error).message };
  }
}

// ── Stap 4: bestaande functies voor import, beelden, huisstijl en controle ──
// Rechtstreeks uit de productie-instantie geïmporteerd; de studio implementeert ze niet opnieuw.
// sharp komt uit dezelfde instantie, zodat beeldbewerking exact gelijk is aan die van de generator.
export const generatorRequire = createRequire(join(G, 'package.json'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sharp = generatorRequire('sharp') as (input?: Buffer | string, opties?: object) => any;

type Kleur = { kleur: string; aandeel: number };
export type HuisstijlVoorstel = { bron: string; merk: string; detail: string; licht: Record<string, string>; donker: Record<string, string>; favicon: string };

export async function huisstijlFuncties() {
  const h = await importeer('packages/import/huisstijl.mjs');
  const t = await importeer('packages/tokens/index.mjs');
  return {
    logoKleuren: h.logoKleuren as (bytes: Buffer) => Promise<Kleur[]>,
    huisstijlVoorstel: h.huisstijlVoorstel as (kleuren: Kleur[], profiel: unknown) => HuisstijlVoorstel | null,
    laadProfiel: t.laadProfiel as (naam: string) => { kleuren: { licht: Record<string, string>; donker: Record<string, string> } },
    contrast: t.contrast as (a: string, b: string) => number,
  };
}

export async function hamming(a: string, b: string): Promise<number> {
  const { hamming: h } = await importeer('packages/media/index.mjs');
  return h(a, b);
}

export async function leesTeksten(md: string) {
  const { leesTeksten: l } = await importeer('packages/aanlevering/index.mjs');
  return l(md) as { verhaal: { hoofdstukken: { id: string; titel?: string; nav?: string; alineas?: ({ prose?: string; lijst?: string[]; accent?: string })[] }[] }; fouten: string[] };
}

export function generatorCommit() { return git('rev-parse', 'HEAD'); }
