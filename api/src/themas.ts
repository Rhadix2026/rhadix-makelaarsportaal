// Kantoorthema's: de huisstijl van een makelaarskantoor in het portaal (stap 2, Morskieft).
// Alleen opmaak, vastgelegd in de code (web/src/themas/, web/public/themas/). Welk kantoor welk
// thema krijgt, staat in de omgevingsinstelling STUDIO_KANTOORTHEMAS ("slug=thema,slug=thema"),
// zodat er geen databasegegevens wijzigen en elke omgeving (test/productie) haar eigen koppeling heeft.

export const THEMAS = ['morskieft'] as const;
export type Thema = (typeof THEMAS)[number];

export const isThema = (s: unknown): s is Thema => typeof s === 'string' && (THEMAS as readonly string[]).includes(s);

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "rhadix-testmakelaars=morskieft,morskieft=morskieft" → Map(slug → thema). Fout = niet starten. */
export function leesKantoorthemas(waarde: string | undefined): Map<string, Thema> {
  const m = new Map<string, Thema>();
  for (const deel of (waarde ?? '').split(',').map((d) => d.trim()).filter(Boolean)) {
    const [slug, thema, rest] = deel.split('=').map((s) => s.trim());
    if (rest !== undefined || !slug || !SLUG.test(slug) || !isThema(thema))
      throw new Error(`STUDIO_KANTOORTHEMAS: ongeldig onderdeel "${deel}" (verwacht slug=thema, thema's: ${THEMAS.join(', ')})`);
    m.set(slug, thema);
  }
  return m;
}

/** Thema van een gebruiker: alleen als al diens kantoren hetzelfde thema hebben (platformbeheer: geen). */
export function themaVoor(platformbeheer: boolean, kantoorslugs: string[], koppeling: Map<string, Thema>): Thema | null {
  if (platformbeheer || kantoorslugs.length === 0) return null;
  const t = new Set(kantoorslugs.map((s) => koppeling.get(s) ?? null));
  if (t.size !== 1) return null;
  return [...t][0];
}
