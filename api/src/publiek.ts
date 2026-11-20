// Wat er op de publieke objectwebsite komt (stap 3A.4). Alleen afgeleid van wat al vastligt: het adres en
// de koppen uit de brochure. Er wordt niets verzonnen; elke aanpassing staat in de lijst `wijzigingen`.

/**
 * Publieke naam van het object: het objectadres (straat en huisnummer). De projectnaam is intern (bijvoorbeeld
 * 'bossie') en komt nooit op de website. Een expliciet gekozen commerciële objectnaam gaat voor, zodra die
 * bestaat (nu nog geen veld in het datamodel).
 */
export function publiekeNaam(p: { adres?: string | null; plaats?: string | null; objectnaam?: string | null }): string {
  return p.objectnaam?.trim() || p.adres?.trim() || p.plaats?.trim() || 'Woning';
}

// Bijgebouwen en andere delen die een brochure als eigen hoofdstuk beschrijft.
const DEEL = /\b(kantoor|kantoorgebouw|bijgebouw|schuur|gastenverblijf|praktijk(?:ruimte)?|werkplaats|stal|garage|vakantiewoning|recreatiewoning|bedrijfsruimte)\b/i;
// Een kale verdiepingskop zonder eigen onderwerp.
const VERDIEPING = /^(?:indeling\s+)?(begane grond|verdieping|eerste verdieping|tweede verdieping|zolder|zolderverdieping|kelder|souterrain)$/i;
// "Wonen in" zonder vervolg: de plaats ontbreekt in de kop (staat in de brochure vaak als beeld).
const AFGEBROKEN = /^wonen\s+(in|aan|op|bij|rond)$/i;
const hoofdletter = (t: string) => t.replace(/^\p{Ll}/u, (c) => c.toUpperCase());

type Hoofdstuk = { id: string; regel: number; nav: number | null; titel: number | null };

/**
 * Navigatielabels en koppen begrijpelijk maken voor kopers, op basis van de bestaande koppen en de volgorde
 * van de brochure (teksten.md van de import):
 *  - "Indeling eerste en tweede verdieping" → navigatie "Verdiepingen" (was afgekapt tot "Eerste en tweede");
 *  - een hoofdstuk over een bijgebouw ("Indeling begane grond kantoor") → navigatie "Kantoor";
 *  - een kale verdiepingskop direct na zo'n hoofdstuk ("Verdieping") hoort daarbij: kop "Verdieping kantoor",
 *    geen eigen navigatielink;
 *  - een afgebroken kop ("Wonen in") → kop "Wonen in de omgeving van <plaats>", navigatie "Omgeving".
 * Overige koppen blijven ongewijzigd.
 */
export function navigatieVoorKopers(md: string, plaats?: string | null) {
  const r = md.split('\n');
  const hs: Hoofdstuk[] = [];
  let h: Hoofdstuk | null = null;
  r.forEach((x, i) => {
    if (/^# /.test(x)) { h = /^# hoofdstuk /.test(x) ? { id: x.slice(12).trim(), regel: i, nav: null, titel: null } : null; if (h) hs.push(h); return; }
    if (!h) return;
    if (/^nav:/.test(x) && h.nav == null) h.nav = i;
    else if (/^titel:/.test(x) && h.titel == null) h.titel = i;
  });
  const waarde = (i: number | null) => (i == null ? '' : r[i].replace(/^\w+:\s*/, '').trim());
  const wijzigingen: { hoofdstuk: string; was: string; wordt: string }[] = [];
  const zet = (x: Hoofdstuk, veld: 'nav' | 'titel', nieuw: string | null) => {
    const i = x[veld];
    const oud = waarde(i);
    if (nieuw === null) {
      if (i == null) return;
      r[i] = '\u0000';   // regel vervalt: geen eigen navigatielink
      wijzigingen.push({ hoofdstuk: x.id, was: `${veld}: ${oud}`, wordt: `${veld}: (geen)` });
    } else if (nieuw !== oud) {
      if (i == null) r[x.regel] += `\n${veld}: ${nieuw}`;   // geen regel: direct onder de kop toevoegen
      else r[i] = `${veld}: ${nieuw}`;
      wijzigingen.push({ hoofdstuk: x.id, was: `${veld}: ${oud}`, wordt: `${veld}: ${nieuw}` });
    }
  };
  let vorigDeel: string | null = null;
  for (const x of hs) {
    const titel = waarde(x.titel);
    const deel = titel.match(DEEL)?.[1]?.toLowerCase() ?? null;
    const kaal = titel.match(VERDIEPING);
    if (kaal && vorigDeel) {
      zet(x, 'titel', `${hoofdletter(kaal[1].toLowerCase())} ${vorigDeel}`);
      zet(x, 'nav', null);
      continue;                       // hoort bij het vorige deel; dat blijft het 'vorige deel'
    }
    vorigDeel = deel;
    if (deel) { zet(x, 'nav', hoofdletter(deel === 'kantoorgebouw' ? 'kantoor' : deel)); continue; }
    if (/\bverdieping\b/i.test(titel) && /\sen\s/i.test(titel)) { zet(x, 'nav', 'Verdiepingen'); continue; }
    if (AFGEBROKEN.test(titel)) {
      zet(x, 'titel', plaats ? `Wonen in de omgeving van ${plaats}` : 'Omgeving');
      zet(x, 'nav', 'Omgeving');
    }
  }
  return { md: r.filter((x) => x !== '\u0000').join('\n'), wijzigingen };
}

/**
 * Tijdelijk, onbereikbaar adres van een intern concept (zolang er geen definitief domein is). Bewust níet de slug:
 * die is afgeleid van de interne projectnaam en zou in canonical en og:url van de pagina terechtkomen.
 */
export const tijdelijkAdres = (projectId: string) => `concept-${projectId.replace(/-/g, '').slice(0, 10)}.invalid`;
