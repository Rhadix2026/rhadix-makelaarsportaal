// Voortgang van een verwerking, op basis van echte procesgegevens:
//   - de stappen van de bestaande brochure-import (generator: importeer() → onStap);
//   - per afbeelding bij het bepalen van de beeldkenmerken (studio, kindproces);
//   - per reeks van 8 foto's bij de classificatie (generator: classificeerBeeldenAsync → onVoortgang);
//   - de verwerkingsstappen in de studio (gegevens vastleggen, opslaan).
// Het kindproces meldt gebeurtenissen als regels '##voortgang {json}' op stderr; de verwerker
// houdt de stand bij en schrijft die (afgeknepen) naar verwerking.voortgang.
//
// Percentage: een schatting op basis van tijdsgewichten uit de capaciteitstest (9-11-2026,
// CPX32: classificatie ±3 s per foto, model laden ±10 s, de rest van de import samen ±25 s).
// Zolang het aantal foto's niet bekend is, is er geen betrouwbaar totaal: dan percentage null.

export const FASEN = [
  { id: 'inlezen', tekst: "PDF inlezen en pagina's herkennen" },
  { id: 'extractie', tekst: 'Teksten, woninggegevens en afbeeldingen extraheren' },
  { id: 'classificatie', tekst: "Foto's analyseren en classificeren" },
  { id: 'verwerken', tekst: 'Gegevens controleren en verwerken' },
  { id: 'afronden', tekst: 'Resultaten opslaan en afronden' },
] as const;
export type FaseId = (typeof FASEN)[number]['id'];

// Stappen van importeer() (generator IMPORT_STAPPEN) per fase.
const IMPORT_FASE: Record<string, FaseId> = { pdf_lezen: 'inlezen', structuur: 'inlezen', gegevens: 'extractie', teksten: 'extractie',
  beelden: 'extractie', controle: 'extractie', schrijven: 'extractie' };
const IMPORT_STAPPEN = Object.keys(IMPORT_FASE);

// Tijdsgewichten in seconden (zie kop). Alleen voor de verhouding tussen de fasen.
export const GEWICHT = { import: 20, controle: 2, kenmerken_per_beeld: 0.05, laden: 10, per_foto: 3, verwerken: 4, afronden: 1 };

export type Gebeurtenis =
  | { soort: 'import'; stap: string; status: 'start' | 'klaar' }
  | { soort: 'controle'; status: 'start' | 'klaar' }
  | { soort: 'kenmerken'; klaar: number; totaal: number; fotos?: number } // fotos: aantal dat geclassificeerd wordt
  | { soort: 'classificatie'; fase: 'laden' | 'model_geladen' | 'beelden'; klaar: number; totaal: number }
  | { soort: 'fase'; fase: 'verwerken' | 'afronden' };

export type Voortgang = {
  fase: FaseId; fase_nr: number; fasen: number; tekst: string;
  stap: string | null; klaar: number | null; totaal: number | null; eenheid: string | null;
  percentage: number | null; bijgewerkt: string;
};

const PREFIX = '##voortgang ';
/** Regel voor stderr van het kindproces. */
export const voortgangRegel = (g: Gebeurtenis) => `${PREFIX}${JSON.stringify(g)}\n`;
/** Leest een voortgangsregel van het kindproces; null voor elke andere regel. */
export function leesRegel(regel: string): Gebeurtenis | null {
  if (!regel.startsWith(PREFIX)) return null;
  try { const g = JSON.parse(regel.slice(PREFIX.length)); return g && typeof g.soort === 'string' ? g as Gebeurtenis : null; } catch { return null; }
}
export const isVoortgangRegel = (r: string) => r.startsWith(PREFIX);

const STAP_TEKST: Record<string, string> = {
  pdf_lezen: 'PDF lezen', structuur: "Pagina's en hoofdstukken herkennen", gegevens: 'Woninggegevens zoeken', teksten: 'Teksten verzamelen',
  beelden: 'Afbeeldingen uit de PDF halen', controle: 'Gegevens van de import controleren', schrijven: 'Aanlevering wegschrijven',
  aanleveringscontrole: 'Aanlevering controleren', kenmerken: 'Afbeeldingen voorbereiden', laden: 'Beeldherkenning starten',
  beelden_classificeren: "Foto's classificeren", verwerken: 'Gegevens en foto\'s vastleggen', afronden: 'Afronden',
};

/** Houdt de stand van één verwerking bij en berekent fase, tellingen en percentage. */
export class Volger {
  private fase: FaseId;
  private stap: string | null = null;
  private importKlaar = 0;
  private controleKlaar = false;
  private kenmerken = { klaar: 0, totaal: null as number | null };
  private foto = { geladen: false, klaar: 0, totaal: null as number | null };
  private eenheid: string | null = null;
  private teller: { klaar: number; totaal: number } | null = null;

  /** soort: 'brochure-import' (alle fasen) of 'foto-indeling' (vanaf classificatie, aantal vooraf bekend). */
  constructor(private soort: 'brochure-import' | 'foto-indeling', private classificeren: boolean, fotos = 0) {
    this.fase = soort === 'brochure-import' ? 'inlezen' : this.classificeren ? 'classificatie' : 'verwerken';
    if (soort === 'foto-indeling') { this.foto.totaal = fotos; this.kenmerken = { klaar: 0, totaal: 0 }; this.importKlaar = IMPORT_STAPPEN.length; this.controleKlaar = true; }
  }

  verwerk(g: Gebeurtenis) {
    switch (g.soort) {
      case 'import':
        this.fase = IMPORT_FASE[g.stap] ?? this.fase; this.stap = g.stap; this.teller = null; this.eenheid = null;
        if (g.status === 'klaar') this.importKlaar = Math.min(IMPORT_STAPPEN.length, this.importKlaar + 1);
        break;
      case 'controle':
        this.fase = 'extractie'; this.stap = 'aanleveringscontrole'; this.teller = null; this.eenheid = null;
        if (g.status === 'klaar') this.controleKlaar = true;
        break;
      case 'kenmerken':
        this.fase = 'extractie'; this.stap = 'kenmerken'; this.kenmerken = { klaar: g.klaar, totaal: g.totaal };
        this.teller = { klaar: g.klaar, totaal: g.totaal }; this.eenheid = 'afbeeldingen';
        if (g.fotos !== undefined) this.foto.totaal = g.fotos;
        break;
      case 'classificatie':
        this.fase = 'classificatie'; this.foto.totaal = g.totaal;
        if (g.fase === 'laden') { this.stap = 'laden'; this.teller = null; this.eenheid = null; }
        else { this.foto.geladen = true; this.foto.klaar = g.klaar; this.stap = 'beelden_classificeren'; this.teller = { klaar: g.klaar, totaal: g.totaal }; this.eenheid = "foto's"; }
        break;
      case 'fase':
        this.fase = g.fase; this.stap = g.fase; this.teller = null; this.eenheid = null;
        break;
    }
  }

  private percentage(): number | null {
    const n = this.foto.totaal;
    if (this.soort === 'brochure-import' && n === null) return null; // nog geen betrouwbaar totaal
    const G = GEWICHT;
    const k = this.kenmerken.totaal ?? 0;
    const cls = this.classificeren && (n ?? 0) > 0;
    const totaal = (this.soort === 'brochure-import' ? G.import + G.controle + k * G.kenmerken_per_beeld : 0)
      + (cls ? G.laden + (n ?? 0) * G.per_foto : 0) + G.verwerken + G.afronden;
    const volgorde = FASEN.findIndex((f) => f.id === this.fase);
    let gedaan = this.soort === 'brochure-import'
      ? G.import * (this.importKlaar / IMPORT_STAPPEN.length) + (this.controleKlaar ? G.controle : 0) + this.kenmerken.klaar * G.kenmerken_per_beeld : 0;
    if (cls) gedaan += (this.foto.geladen ? G.laden : 0) + this.foto.klaar * G.per_foto;
    if (volgorde > FASEN.findIndex((f) => f.id === 'verwerken')) gedaan += G.verwerken;
    // Nooit 100 % tijdens de verwerking: 100 komt pas met de status 'klaar'.
    return Math.max(0, Math.min(99, Math.floor((gedaan / totaal) * 100)));
  }

  stand(): Voortgang {
    const nr = FASEN.findIndex((f) => f.id === this.fase);
    return { fase: this.fase, fase_nr: nr + 1, fasen: FASEN.length, tekst: FASEN[nr].tekst,
      stap: this.stap ? STAP_TEKST[this.stap] ?? null : null, klaar: this.teller?.klaar ?? null, totaal: this.teller?.totaal ?? null,
      eenheid: this.eenheid, percentage: this.percentage(), bijgewerkt: new Date().toISOString() };
  }
}

/**
 * Schrijft de stand afgeknepen weg: hoogstens één keer per `minMs`, behalve bij een nieuwe fase of stap,
 * plus een hartslag (alleen `bijgewerkt`) zolang de verwerking loopt, zodat zichtbaar is dat ze leeft.
 */
export function schrijver(volger: Volger, schrijf: (v: Voortgang) => Promise<unknown>, o: { minMs?: number; hartslagMs?: number } = {}) {
  const minMs = o.minMs ?? 1000; const hartslagMs = o.hartslagMs ?? 10_000;
  let laatst = 0, sleutel = '', wacht: ReturnType<typeof setTimeout> | null = null, gestopt = false;
  let keten: Promise<unknown> = Promise.resolve();
  const nu = () => { if (gestopt) return keten; laatst = Date.now(); const s = volger.stand(); sleutel = `${s.fase}|${s.stap}`; keten = keten.then(() => schrijf(s)).catch(() => {}); return keten; };
  const hartslag = setInterval(() => { if (Date.now() - laatst >= hartslagMs) void nu(); }, Math.min(hartslagMs, 5000));
  hartslag.unref?.();
  return {
    gebeurtenis(g: Gebeurtenis) {
      volger.verwerk(g);
      const s = volger.stand();
      if (`${s.fase}|${s.stap}` !== sleutel || Date.now() - laatst >= minMs) { if (wacht) { clearTimeout(wacht); wacht = null; } void nu(); }
      else if (!wacht) { wacht = setTimeout(() => { wacht = null; void nu(); }, minMs - (Date.now() - laatst)); wacht.unref?.(); }
    },
    nu,
    stand: () => volger.stand(),
    /** Stopt de hartslag; wacht tot de laatste schrijfactie klaar is. */
    async stop() { gestopt = true; clearInterval(hartslag); if (wacht) clearTimeout(wacht); await keten; },
  };
}

/**
 * Begrijpelijke melding bij een mislukte verwerking, zonder technische details. De technische
 * foutmelding blijft in verwerking.fout en is alleen zichtbaar voor platformbeheer.
 */
export function foutMelding(fout: string | null | undefined): string {
  const f = fout ?? '';
  const neem = 'Probeer het opnieuw; blijft dit gebeuren, neem dan contact op met platformbeheer.';
  if (/onderbroken/i.test(f)) return 'De verwerking is onderbroken doordat de studio opnieuw is gestart. Start de verwerking opnieuw.';
  if (/siglip|classificatie/i.test(f)) return `Het analyseren van de foto's is niet gelukt. ${neem}`;
  if (/pdf|password|encrypt|xref|Invalid/i.test(f)) return 'De brochure kon niet worden gelezen. Controleer of het een geldig, onbeveiligd PDF-bestand is en probeer het opnieuw.';
  return `De verwerking is niet gelukt. ${neem}`;
}
