// Beoordeling van een aanlevering: signalen per gegeven, meldingen in drie niveaus en de
// fotokwaliteit. Alleen afleiding uit wat er al is (import, vastgelegde gegevens, bestanden);
// de normen voor beelden komen uit de generator (EIS in packages/aanlevering).
//
//   blokkerend   moet opgelost zijn voordat er gegenereerd kan worden
//   aandacht     vraagt een menselijke beoordeling
//   info         ter kennisgeving, geen handeling nodig
import { soortConflict, type Conflict, type Kandidaat } from './gegevens.ts';

export type Niveau = 'blokkerend' | 'aandacht' | 'info';
export type Melding = { niveau: Niveau; titel: string; tekst?: string; sleutel?: string };
export type Signaal = 'tegenstrijdigheid' | 'terminologie' | 'afwijking' | 'onzeker';
export const SIGNAAL_TEKST: Record<Signaal, string> = {
  tegenstrijdigheid: 'inhoudelijke tegenstrijdigheid', terminologie: 'mogelijke terminologische afwijking',
  afwijking: 'wijkt af van de brochure', onzeker: 'lagere zekerheid',
};

type Vast = { waarde: unknown; eenheid: string | null; herkomst: string; status: string; besluit: { soort: string; motivering: string } | null; gewijzigd_op: string } | null;
export type GegevenRegel = { sleutel: string; label: string; extractie: Kandidaat | null; vastgelegd: Vast; afwijking: boolean; conflict: Conflict | null };

/** Signalen per gegeven. Een besloten tegenstrijdigheid en een bewust gecorrigeerde waarde zijn geen open signaal meer. */
export function signalen(g: GegevenRegel, importKlaar: Date | null): Signaal[] {
  const s: Signaal[] = [];
  const besloten = !!g.vastgelegd?.besluit;
  if (g.conflict && !besloten) s.push(soortConflict(g.conflict));
  const bewust = g.vastgelegd?.herkomst === 'handmatig' && importKlaar && new Date(g.vastgelegd.gewijzigd_op) > importKlaar;
  if (g.afwijking && !bewust && !besloten) s.push('afwijking');
  if (g.extractie && g.extractie.zekerheid && g.extractie.zekerheid !== 'hoog' && g.vastgelegd?.status !== 'goedgekeurd') s.push('onzeker');
  return s;
}

type Beeld = { soort: string; herkomst: string; breedte: number | null; hoogte: number | null; dubbel_van: string | null; vervallen: boolean; classificatie: { controle?: boolean } | null };
export type Eisen = { minBreedte: number; goedeBreedte: number; heroBreedte: number; minFotos: number };

/** Fotokwaliteit volgens de norm van de generator voor originele foto's (EIS, niet de lagere brochurenorm). */
export function fotokwaliteit(bestanden: Beeld[], eis: Eisen) {
  const inGebruik = bestanden.filter((b) => b.soort === 'foto' && !b.vervallen && !b.dubbel_van && b.breedte && b.hoogte);
  const lang = (b: Beeld) => Math.max(b.breedte!, b.hoogte!);
  const geschikt = inGebruik.filter((b) => lang(b) >= eis.goedeBreedte);
  const beperkt = inGebruik.filter((b) => lang(b) < eis.goedeBreedte && lang(b) >= eis.minBreedte);
  const teKlein = inGebruik.filter((b) => lang(b) < eis.minBreedte);
  return {
    norm: { goed: eis.goedeBreedte, minimaal: eis.minBreedte, openingsbeeld: eis.heroBreedte, aanbevolen: eis.minFotos },
    in_gebruik: inGebruik.length,
    geschikt: geschikt.length,
    onvoldoende: beperkt.length + teKlein.length,
    beperkt: beperkt.length,
    te_klein: teKlein.length,
    // Originelen nodig: beelden uit de brochure onder de norm waarvoor nog geen losse foto is aangeleverd.
    originelen_nodig: [...beperkt, ...teKlein].filter((b) => b.herkomst === 'brochure').length,
    // Losse foto's die zelf onder de norm blijven: een betere versie is nodig.
    losse_onder_norm: [...beperkt, ...teKlein].filter((b) => b.herkomst === 'upload').length,
    openingsbeeld: inGebruik.some((b) => b.breedte! / b.hoogte! >= 1.2 && b.breedte! >= eis.heroBreedte),
    losse: inGebruik.filter((b) => b.herkomst === 'upload').length,
    uit_brochure: inGebruik.filter((b) => b.herkomst === 'brochure').length,
    dubbel: bestanden.filter((b) => b.soort === 'foto' && !b.vervallen && b.dubbel_van).length,
    ter_controle: inGebruik.filter((b) => b.classificatie?.controle).length,
  };
}

const kaal = (s?: string | null) => (s ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9@]/g, '');

/** Makelaarsgegevens uit de brochure naast die van het gekoppelde kantoor. */
export function vergelijkMakelaar(mk: Record<string, unknown> | undefined, k: { merknaam: string; telefoon: string | null; email: string | null; website: string | null; adresregels: string[] }) {
  if (!mk) return [];
  const rijen: [string, string | undefined, string | null][] = [
    ['Naam', mk.naam as string, k.merknaam], ['Telefoon', mk.telefoon as string, k.telefoon], ['E-mail', mk.email as string, k.email],
    ['Website', mk.website as string, k.website], ['Adres', (mk.adresregels as string[] | undefined)?.join(', '), k.adresregels.join(', ') || null]];
  return rijen.map(([veld, brochure, kantoor]) => ({
    veld, brochure: brochure ?? null, kantoor,
    status: !brochure ? 'geen' : !kantoor ? 'kantoor_leeg'
      : (veld === 'Naam' ? kaal(brochure).includes(kaal(kantoor)) || kaal(kantoor).includes(kaal(brochure)) : kaal(brochure) === kaal(kantoor)) ? 'gelijk' : 'verschil',
  }));
}

const lijst = (xs: string[]) => xs.join(', ');

/** Alle meldingen, ingedeeld in blokkerend, aandacht en info. */
export function meldingen(o: {
  gegevens: (GegevenRegel & { signalen: Signaal[] })[]; project: { profiel: string | null; domein: string | null };
  imp: null | { rapport: Record<string, any>; controle: { fouten: string[]; waarschuwingen: string[] } | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
  foto: ReturnType<typeof fotokwaliteit>; makelaar: ReturnType<typeof vergelijkMakelaar>;
}): Melding[] {
  const m: Melding[] = [];
  const add = (niveau: Niveau, titel: string, tekst?: string, sleutel?: string) => m.push({ niveau, titel, ...(tekst ? { tekst } : {}), ...(sleutel ? { sleutel } : {}) });
  if (!o.imp) return m;
  for (const g of o.gegevens) {
    if (g.signalen.includes('tegenstrijdigheid')) add('blokkerend', `Inhoudelijke tegenstrijdigheid: ${g.label}`, `${lijst(g.conflict!.bronnen)}. Leg een besluit vast met motivering.`, g.sleutel);
    if (g.signalen.includes('terminologie')) add('aandacht', `Mogelijke terminologische afwijking: ${g.label}`, `${lijst(g.conflict!.bronnen)}. Beoordeel of dit hetzelfde bedoelt en leg het besluit vast.`, g.sleutel);
    if (g.signalen.includes('afwijking')) add('aandacht', `Afwijking van de brochure: ${g.label}`, `Vastgelegd '${g.vastgelegd?.waarde}', brochure '${g.extractie?.waarde}' (${g.extractie?.bron}).`, g.sleutel);
    if (g.vastgelegd?.besluit) add('info', `Besloten: ${g.label} = ${g.vastgelegd.waarde}${g.vastgelegd.eenheid ? ` ${g.vastgelegd.eenheid}` : ''}`, `Motivering: ${g.vastgelegd.besluit.motivering}`, g.sleutel);
  }
  for (const g of o.gegevens.filter((x) => !x.vastgelegd && ['adres', 'plaats'].includes(x.sleutel))) add('blokkerend', `Ontbreekt: ${g.label}`, 'Verplicht voor de woningwebsite; vul het handmatig aan.', g.sleutel);
  for (const g of o.gegevens.filter((x) => !x.vastgelegd && !['adres', 'plaats'].includes(x.sleutel))) add('aandacht', `Ontbreekt: ${g.label}`, 'Niet in de brochure gevonden.', g.sleutel);
  if (!o.project.profiel) add('blokkerend', 'Presentatieprofiel nog niet gekozen', o.imp.rapport.gegevens?.profiel ? `Voorstel uit de brochure: '${o.imp.rapport.gegevens.profiel.waarde}'.` : undefined);
  for (const f of o.imp.controle?.fouten ?? []) {
    if (/rechten\.bevestigd/.test(f)) add('blokkerend', 'Publicatierechten nog niet bevestigd', 'Bevestig dat foto\'s en teksten gepubliceerd mogen worden (in de broncontrole).');
    else if (/site\.canonical/.test(f)) { if (!o.project.domein) add('blokkerend', 'Adres van de website nog niet vastgelegd', 'Vul het gewenste domein in bij het project.'); }
    else if (/geen liggende foto/.test(f)) add('blokkerend', 'Geen geschikt openingsbeeld', f.replace(/^.*?: /, ''));
    else add('blokkerend', 'Controle generator', f);
  }
  const onzeker = o.gegevens.filter((g) => g.signalen.includes('onzeker'));
  if (onzeker.length) add('aandacht', `${onzeker.length} gegeven${onzeker.length === 1 ? '' : 's'} met lagere zekerheid`, `Afzonderlijk controleren: ${lijst(onzeker.map((g) => g.label))}.`);
  const open = o.gegevens.filter((g) => g.vastgelegd?.status === 'overgenomen');
  if (open.length) add('aandacht', `${open.length} overgenomen gegeven${open.length === 1 ? '' : 's'} nog niet goedgekeurd`);
  for (const r of o.makelaar.filter((x) => x.status === 'verschil')) add('aandacht', `Makelaar: ${r.veld.toLowerCase()} wijkt af van het kantoor`, `Brochure '${r.brochure}', kantoor '${r.kantoor}'.`);
  const f = o.foto;
  if (f.onvoldoende) add('aandacht', `${f.onvoldoende} van ${f.in_gebruik} foto's onder de publicatienorm (${f.norm.goed} px)`,
    [f.originelen_nodig ? `Vraag ${f.originelen_nodig} originele foto${f.originelen_nodig === 1 ? '' : "'s"} op bij de makelaar.` : '',
      f.losse_onder_norm ? `${f.losse_onder_norm} losse foto${f.losse_onder_norm === 1 ? '' : "'s"} ook te klein: vraag een grotere versie.` : ''].filter(Boolean).join(' ') || undefined);
  if (f.in_gebruik && !f.openingsbeeld) add('aandacht', `Geen liggende foto van ${f.norm.openingsbeeld} px voor het openingsbeeld`, 'Vraag een origineel aan voor het openingsbeeld.');
  if (f.in_gebruik < f.norm.aanbevolen) add('aandacht', `${f.in_gebruik} foto's; minimaal ${f.norm.aanbevolen} aanbevolen`);
  if (f.ter_controle) add('aandacht', `${f.ter_controle} foto${f.ter_controle === 1 ? '' : "'s"} met onzekere ruimte-indeling`, 'Gemarkeerd met een vraagteken bij de foto\'s.');
  // Informatief.
  for (const w of o.imp.controle?.waarschuwingen ?? []) {
    if (/^tegenstrijdig|kleiner dan \d+ px|foto's; minimaal/.test(w)) continue; // al hierboven als eigen melding
    add(/GPS/.test(w) ? 'aandacht' : 'info', w.replace(/^teksten\.md: /, 'Teksten: '));
  }
  if (f.dubbel) add('info', `${f.dubbel} dubbele foto${f.dubbel === 1 ? '' : "'s"} niet gebruikt`, 'Het beeld met de hoogste kwaliteit wordt gebruikt.');
  if (o.imp.rapport.vraagprijs_gevonden) add('info', `Vraagprijs gevonden (p. ${o.imp.rapport.vraagprijs_gevonden.pagina})`, 'Bewust niet overgenomen; wordt nooit gepubliceerd.');
  for (const x of (o.imp.rapport.meldingen ?? []) as string[]) add('info', x.replace(/^(\w)/, (c) => c.toUpperCase()));
  return m;
}
