// Voortgang van een lopende verwerking (brochure-import, foto-indeling). Vraagt alleen de lichte
// status op (/verwerkingen/:vid), pauzeert als het tabblad verborgen is en meldt het einde aan de
// ouder, die dan één keer het volledige overzicht herlaadt. De verwerking zelf loopt op de server
// door, ook als de pagina gesloten wordt.
import { useEffect, useRef, useState } from 'react';
import { api, type Verwerking } from '../api.ts';
import { Badge } from './basis.tsx';

// Korte fasenamen per soort verwerking; de volledige omschrijving komt van de server (voortgang.tekst).
const FASEN: Record<string, string[]> = {
  'brochure-import': ['PDF inlezen', 'Extraheren', "Foto's classificeren", 'Verwerken', 'Afronden'],
  'foto-indeling': ['PDF inlezen', 'Extraheren', "Foto's classificeren", 'Verwerken', 'Afronden'],
  conceptgeneratie: ['Voorbereiden', "Nieuwe foto's", 'Woningmap', 'Website opbouwen', 'Kwaliteitscontrole', 'Opslaan'],
};
const VANAF: Record<string, number> = { 'foto-indeling': 3 }; // foto-indeling begint bij de classificatie
const NAAM: Record<string, string> = { 'brochure-import': 'De import', 'foto-indeling': 'De foto-indeling', conceptgeneratie: 'De conceptgeneratie' };
const STANDAARD: Record<string, string> = { 'brochure-import': 'De brochure wordt geïmporteerd…', 'foto-indeling': "Foto's worden ingedeeld…", conceptgeneratie: 'Het concept wordt gemaakt…' };

const duur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
};

export function VerwerkingVoortgang({ projectId, start, onEinde }: { projectId: string; start: Verwerking; onEinde: (v: Verwerking) => void }) {
  const [v, setV] = useState<Verwerking>(start);
  const [nu, setNu] = useState(Date.now());
  const klaar = useRef(false);
  const status = useRef(start.status);
  const einde = useRef(onEinde); einde.current = onEinde;

  // Status opvragen: elke 2 s tijdens de verwerking, elke 4 s in de wachtrij; niet als het tabblad verborgen is.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined; let weg = false;
    const vraag = async () => {
      if (weg || klaar.current) return;
      if (document.visibilityState === 'visible') {
        try {
          const n = await api<Verwerking>(`/api/projecten/${projectId}/verwerkingen/${start.id}`);
          if (weg) return;
          setV(n); status.current = n.status;
          if (n.status === 'klaar' || n.status === 'mislukt') { klaar.current = true; einde.current(n); return; }
        } catch { /* tijdelijk niet bereikbaar: de volgende ronde probeert het opnieuw */ }
      }
      t = setTimeout(vraag, status.current === 'wachtrij' ? 4000 : 2000);
    };
    const zichtbaar = () => { if (document.visibilityState === 'visible') { clearTimeout(t); void vraag(); } };
    document.addEventListener('visibilitychange', zichtbaar);
    void vraag();
    return () => { weg = true; clearTimeout(t); document.removeEventListener('visibilitychange', zichtbaar); };
  }, [projectId, start.id]);

  // Klok voor de verstreken tijd (alleen weergave).
  useEffect(() => { const k = setInterval(() => setNu(Date.now()), 1000); return () => clearInterval(k); }, []);

  const vg = v.voortgang;
  const bekend = v.soort in FASEN;
  const fasen = (FASEN[v.soort] ?? []).map((naam, i) => ({ naam, nr: i + 1 })).filter((f) => f.nr >= (VANAF[v.soort] ?? 1));
  const pct = vg?.percentage ?? null;
  const sindsUpdate = vg ? nu - new Date(vg.bijgewerkt).getTime() : 0;
  const bezigSinds = v.gestart_op ? nu - new Date(v.gestart_op).getTime() : null;

  if (v.status === 'wachtrij') return (
    <div className="vv" aria-live="polite">
      <p className="vv-kop"><Badge>in de wachtrij</Badge> {NAAM[v.soort] ?? 'De verwerking'} start zodra de lopende verwerking klaar is.</p>
      <div className="balk vv-balk vv-onbepaald" role="progressbar" aria-label="In de wachtrij"><div /></div>
    </div>
  );

  // Onbekende soorten melden geen fasen: alleen 'bezig' met een bewegende balk.
  if (!bekend) return (
    <div className="vv">
      <p className="vv-kop"><Badge>bezig</Badge> Er loopt een verwerking voor dit project.</p>
      <div className="balk vv-balk vv-onbepaald" role="progressbar" aria-label="Bezig"><div /></div>
      {bezigSinds !== null && <p className="vv-tijd">Bezig sinds {duur(bezigSinds)}.</p>}
    </div>
  );

  return (
    <div className="vv">
      <p className="vv-kop"><Badge>bezig</Badge> {vg ? vg.tekst : STANDAARD[v.soort]}</p>
      <ol className="vv-fasen" aria-label="Verwerkingsfasen">
        {fasen.map((f) => {
          const st = !vg ? (f.nr === fasen[0].nr ? 'actief' : 'open') : f.nr < vg.fase_nr ? 'klaar' : f.nr === vg.fase_nr ? 'actief' : 'open';
          return <li key={f.nr} className={`vv-fase vv-${st}`} aria-current={st === 'actief' ? 'step' : undefined}>
            <span className="vv-bol" aria-hidden="true">{st === 'klaar' ? '✓' : f.nr - fasen[0].nr + 1}</span>{f.naam}
          </li>;
        })}
      </ol>
      {pct !== null
        ? <div className="vv-rij">
            <div className="balk vv-balk vv-actief-balk" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Voortgang"><div style={{ width: `${Math.max(2, pct)}%` }} /></div>
            <span className="vv-pct">ca. {pct} %</span>
          </div>
        : <div className="balk vv-balk vv-onbepaald" role="progressbar" aria-label="Bezig; voortgang nog niet te berekenen"><div /></div>}
      <p className="vv-stap" aria-live="polite">
        {vg?.stap ?? 'Starten…'}
        {vg?.klaar != null && vg.totaal != null && <> · <strong>{vg.klaar} van {vg.totaal}</strong> {vg.eenheid}</>}
      </p>
      <p className="vv-tijd">
        {bezigSinds !== null && <>Bezig sinds {duur(bezigSinds)}. </>}
        {sindsUpdate > 60_000
          ? <span className="vv-let-op">Al {duur(sindsUpdate)} geen nieuwe melding; de verwerking loopt waarschijnlijk nog.</span>
          : 'U kunt deze pagina verlaten: de verwerking loopt op de server door.'}
      </p>
    </div>
  );
}
