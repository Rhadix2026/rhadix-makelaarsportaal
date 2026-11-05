// Indeling van kwaliteitsmeldingen voor de gebruiker: per categorie (fotografie, inhoud en feiten,
// tekstkwaliteit, vormgeving en techniek), met per melding waarvoor actie nodig is
// (conceptgeneratie, publicatie of geen) en een korte tekst; de technische details (controle,
// paden, selectors) apart. Alleen presentatie: de opgeslagen rapporten blijven ongewijzigd.
import type { Actie } from './beoordeling.ts';

export type Categorie = 'fotografie' | 'inhoud' | 'tekst' | 'vormgeving';
export const CATEGORIEEN: { code: Categorie; naam: string }[] = [
  { code: 'fotografie', naam: 'Fotografie' }, { code: 'inhoud', naam: 'Inhoud en feiten' },
  { code: 'tekst', naam: 'Tekstkwaliteit' }, { code: 'vormgeving', naam: 'Vormgeving en techniek' },
];
export type Ingedeeld = { categorie: Categorie; actie: Actie; tekst: string; detail: string | null; bron: string };

// Categorie: eerst op de controle (bron), dan op de tekst; de eerste passende regel geldt.
const BRON: [RegExp, Categorie][] = [
  [/^(balans|tekstbreedte|schaal|huisstijl|h2|ontwerp|manifestschema|export)/i, 'vormgeving'],
  [/^(fotocategorie|foto|beeld)/i, 'fotografie'], [/^(taal|tekst\b|zinslengte|lange alinea)/i, 'tekst'], [/^(feit|bedragen|onderdelen)/i, 'inhoud'],
];
const CATEGORIE: [RegExp, Categorie][] = [
  [/foto|beeld|alt-tekst|openingsbeeld|classificatie|bijna-dubbel|px voor het openingsbeeld|resolutie/i, 'fotografie'],
  [/zinslengte|lange alinea|taal|tekst\b|standaardtekst|standaardzin|leesbaarheid|terminolog|spelling/i, 'tekst'],
  [/feit|bedrag|onderdelen|ontbreekt|gegeven|tegenstrijdig|kamers|oppervlak|rechten|adres|profiel|makelaar|kantoor/i, 'inhoud'],
];
// Stijladviezen: geen actie nodig voor concept of publicatie (informatief).
const INFORMATIEF = /tekstbreedte|tekens per regel|balans|zinslengte|lange alinea|huisstijlkleuren|neutraal profiel|standaardzin|slot met titel|wordt alleen tekst|alleen in "Alle foto's"|^ontbreekt: /i;

/** Splitst de technische staart (manifestpaden, selectors, modelnamen) af van de leesbare tekst. */
export function splits(tekst: string): { tekst: string; detail: string | null } {
  const m = tekst.match(/^(.*?)(?:\s+(?:in|op)\s+((?:compositie|verhaal|woning|site)[[.].*)|:\s+(#.*)|\s+\(((?:google|[\w-]+\/[\w-]+)[^)]*)\))$/);
  if (!m) return { tekst, detail: null };
  // Een advies na de selector ('#x p — tekst splitsen …') hoort bij de leesbare tekst.
  const [detail, advies] = (m[2] ?? m[3] ?? m[4] ?? '').split(' — ');
  return { tekst: [m[1].trim(), advies?.trim()].filter(Boolean).join(': '), detail: detail.trim() || null };
}

export function deelMeldingIn(bron: string, tekst: string, actie: Actie): Ingedeeld {
  const { tekst: t, detail } = splits(tekst);
  const kort = /^zinslengte/i.test(bron) ? `Lange zin: ${t}` : /^lange alinea/i.test(bron) ? `Lange alinea: ${t}` : t;
  const categorie = BRON.find(([rx]) => rx.test(bron))?.[1] ?? CATEGORIE.find(([rx]) => rx.test(kort))?.[1] ?? 'vormgeving';
  return { categorie, actie: actie === 'publicatie' && (INFORMATIEF.test(bron) || INFORMATIEF.test(kort)) ? 'geen' : actie, tekst: kort, detail, bron };
}

export function samenvatting(items: Ingedeeld[]) {
  return CATEGORIEEN.map((c) => {
    const x = items.filter((i) => i.categorie === c.code);
    return { ...c, conceptgeneratie: x.filter((i) => i.actie === 'conceptgeneratie').length, publicatie: x.filter((i) => i.actie === 'publicatie').length, geen: x.filter((i) => i.actie === 'geen').length };
  });
}

/** Het kwaliteitsrapport van een concept (mp kwaliteit). Het concept bestaat al: blokkerend geldt voor publicatie. */
export function deelConceptIn(k: { blokkerend?: { controle: string; melding: string }[]; waarschuwingen?: { controle: string; melding: string }[] } | null) {
  if (!k) return null;
  const items = [
    ...(k.blokkerend ?? []).map((b) => deelMeldingIn(b.controle, b.melding, 'publicatie')),
    ...(k.waarschuwingen ?? []).map((w) => deelMeldingIn(w.controle, w.melding, 'publicatie')),
  ];
  return { samenvatting: samenvatting(items), meldingen: items };
}

/** De kwaliteitscontrole vóór de vrijgave: blokkades gelden voor de conceptgeneratie. */
export function deelControleIn(r: Record<'blokkerend' | 'aandacht' | 'info', { bron: string; tekst: string }[]>) {
  const items = [
    ...r.blokkerend.map((m) => deelMeldingIn(m.bron, m.tekst, 'conceptgeneratie')),
    ...r.aandacht.map((m) => deelMeldingIn(m.bron, m.tekst, 'publicatie')),
    ...r.info.map((m) => deelMeldingIn(m.bron, m.tekst, 'geen')),
  ];
  return { samenvatting: samenvatting(items), meldingen: items };
}
