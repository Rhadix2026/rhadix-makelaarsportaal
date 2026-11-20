// Kantoorthema's in de interface (stap 2). De koppeling kantoor → thema staat op de server
// (STUDIO_KANTOORTHEMAS); hier alleen wat elk thema toont. Logo's staan ongewijzigd in /themas/<thema>/.
import './themas/morskieft.css';

export type ThemaInfo = { naam: string; logo: string; logoAlt: string; label: string };

export const THEMAS: Record<string, ThemaInfo> = {
  morskieft: { naam: 'Morskieft', logo: '/themas/morskieft/logo.svg', logoAlt: 'Morskieft – De Twentsche Makelaar', label: 'Makelaarsportaal' },
};

export const themaInfo = (t: string | null | undefined): ThemaInfo | null =>
  t && Object.prototype.hasOwnProperty.call(THEMAS, t) ? THEMAS[t] : null;

/** Zet (of wist) het thema op <html data-thema="…">; de CSS geldt alleen daaronder. */
export function zetThema(t: string | null | undefined) {
  const el = document.documentElement;
  if (themaInfo(t)) el.dataset.thema = t!; else delete el.dataset.thema;
}

/** Merk uit de URL van het inlogscherm (?merk=morskieft), alleen een bekend thema. */
export function merkUitUrl(): string | null {
  const m = new URLSearchParams(location.search).get('merk');
  return themaInfo(m) ? m : null;
}
