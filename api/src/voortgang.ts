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
  | { soort: 'fase'; fase: 'verwerken' | 'afronden' }
  // Conceptgeneratie
  | { soort: 'concept'; stap: 'voorbereiden' | 'woningmap' | 'bouwen' | 'kwaliteit' | 'opslaan'; status: 'start' | 'klaar' }
  | { soort: 'bouwstap'; naam: string; ms: number }; // een '✓ <stap> <ms>'-regel van mp bouw

export type Voortgang = {
  fase: string; fase_nr: number; fasen: number; tekst: string;
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

// ── Conceptgeneratie ──────────────────────────────────────────────────────
// Zes fasen, zoals ze in het kindproces (verwerker-kind.ts, concept()) werkelijk bestaan.
export const CONCEPT_FASEN = [
  { id: 'voorbereiden', tekst: 'Woninggegevens en afbeeldingen voorbereiden' },
  { id: 'classificatie', tekst: "Nieuwe foto's classificeren" },
  { id: 'woningmap', tekst: 'Woningmap klaarzetten' },
  { id: 'bouwen', tekst: 'Website opbouwen' },
  { id: 'kwaliteit', tekst: 'Kwaliteitscontrole uitvoeren' },
  { id: 'opslaan', tekst: 'Conceptversie opslaan' },
] as const;

// Tijdsgewichten in seconden. Bron: capaciteitsrapport 9-11-2026, tabel 4.2 (CPX32, zes generaties:
// totaal 34–49 s, bouw 11–22 s, kwaliteitscontrole 22–26 s, overige stappen samen ±1–2 s) en voor de
// classificatie de import (model ±10 s, ±3 s per foto). Binnen 'bouwen' de verdeling uit de
// stapmeting van mp bouw (Markt 27 v1: media 3068, sluier 1898, renderen 942+255, overige < 100 ms).
export const CONCEPT_GEWICHT = { voorbereiden: 0.5, laden: 10, per_foto: 3, woningmap: 0.5, bouwen: 16, kwaliteit: 24, opslaan: 0.5 };
const BOUWSTAP_AANDEEL: Record<string, number> = { valideren: 0.01, media: 0.48, compositie: 0.005, componeren: 0.01, 'qa-feiten': 0.005,
  renderen: 0.09, assets: 0.005, sluier: 0.3, 'qa-site': 0.005 }; // 'renderen' en 'assets' komen twee keer voor
const BOUW_TEKST: Record<string, string> = { valideren: 'Manifest valideren', media: "Foto's verwerken", compositie: 'Indeling bepalen', componeren: "Pagina's samenstellen",
  'qa-feiten': 'Feiten controleren', renderen: 'Pagina\'s renderen', assets: 'Bestanden klaarzetten', sluier: 'Leesbaarheid openingsbeeld meten', 'qa-site': 'Site controleren' };
const CONCEPT_STAP_TEKST: Record<string, string> = { voorbereiden: 'Aanlevering controleren en manifest maken', woningmap: "Foto's en manifest klaarzetten",
  bouwen: 'Bouw starten', kwaliteit: 'Kwaliteitsrapport opstellen (Design System 1.0)', opslaan: 'Conceptversie vastleggen', laden: 'Beeldherkenning starten',
  beelden_classificeren: "Foto's classificeren" };

/** Stand van een conceptgeneratie: fase, stap, tellingen en een percentage op basis van afgeronde stappen. */
export class ConceptVolger {
  private fase: (typeof CONCEPT_FASEN)[number]['id'] = 'voorbereiden';
  private stap: string | null = null;
  private klaar = new Set<string>();
  private bouwGedaan = 0; // aandeel 0..1 van de bouw
  private foto = { totaal: 0, klaar: 0, geladen: false };
  private teller: { klaar: number; totaal: number } | null = null;

  verwerk(g: Gebeurtenis) {
    if (g.soort === 'concept') {
      if (g.stap !== 'bouwen' || g.status === 'start') { this.fase = g.stap === 'bouwen' ? 'bouwen' : g.stap; }
      if (g.status === 'klaar') { this.klaar.add(g.stap); if (g.stap === 'bouwen') this.bouwGedaan = 1; }
      this.stap = g.status === 'start' ? g.stap : this.stap; this.teller = null;
    } else if (g.soort === 'bouwstap') {
      this.fase = 'bouwen'; this.stap = `bouw:${g.naam}`; this.teller = null;
      this.bouwGedaan = Math.min(0.99, this.bouwGedaan + (BOUWSTAP_AANDEEL[g.naam] ?? 0));
    } else if (g.soort === 'classificatie') {
      this.fase = 'classificatie'; this.foto.totaal = g.totaal;
      if (g.fase === 'laden') { this.stap = 'laden'; this.teller = null; }
      else { this.foto.geladen = true; this.foto.klaar = g.klaar; this.stap = 'beelden_classificeren'; this.teller = { klaar: g.klaar, totaal: g.totaal }; }
    }
  }

  private percentage() {
    const G = CONCEPT_GEWICHT;
    const cls = this.foto.totaal > 0 ? G.laden + this.foto.totaal * G.per_foto : 0;
    const totaal = G.voorbereiden + cls + G.woningmap + G.bouwen + G.kwaliteit + G.opslaan;
    let gedaan = (this.klaar.has('voorbereiden') ? G.voorbereiden : 0) + (this.klaar.has('woningmap') ? G.woningmap : 0)
      + G.bouwen * this.bouwGedaan + (this.klaar.has('kwaliteit') ? G.kwaliteit : 0);
    if (cls) gedaan += (this.foto.geladen ? G.laden : 0) + this.foto.klaar * G.per_foto;
    return Math.max(0, Math.min(99, Math.floor((gedaan / totaal) * 100)));
  }

  stand(): Voortgang {
    const nr = CONCEPT_FASEN.findIndex((f) => f.id === this.fase);
    const stap = this.stap?.startsWith('bouw:') ? BOUW_TEKST[this.stap.slice(5)] ?? 'Website opbouwen' : this.stap ? CONCEPT_STAP_TEKST[this.stap] ?? null : null;
    return { fase: this.fase, fase_nr: nr + 1, fasen: CONCEPT_FASEN.length, tekst: CONCEPT_FASEN[nr].tekst, stap,
      klaar: this.teller?.klaar ?? null, totaal: this.teller?.totaal ?? null, eenheid: this.teller ? "foto's" : null,
      percentage: this.percentage(), bijgewerkt: new Date().toISOString() };
  }
}

/** Herkent een stapregel van mp bouw ('  ✓ media          3068 ms'); null voor andere regels. */
export function leesBouwstap(regel: string): { naam: string; ms: number } | null {
  const m = regel.match(/^\s*✓ ([a-z][a-z-]*)\s+(\d+) ms\s*$/);
  return m ? { naam: m[1], ms: Number(m[2]) } : null;
}

/** Alles wat een stand bijhoudt (Volger voor import/foto-indeling, ConceptVolger voor concepten). */
type Bijhouder = { verwerk(g: Gebeurtenis): void; stand(): Voortgang };

/**
 * Schrijft de stand afgeknepen weg: hoogstens één keer per `minMs`, behalve bij een nieuwe fase of stap,
 * plus een hartslag (alleen `bijgewerkt`) zolang de verwerking loopt, zodat zichtbaar is dat ze leeft.
 */
export function schrijver(volger: Bijhouder, schrijf: (v: Voortgang) => Promise<unknown>, o: { minMs?: number; hartslagMs?: number } = {}) {
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
