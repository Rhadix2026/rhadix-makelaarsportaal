// Kwaliteitsmeldingen overzichtelijk: eerst een compacte samenvatting per categorie met aantallen
// en prioriteit, daarna per categorie de meldingen (uitklapbaar). Per melding staat waarvoor actie
// nodig is; de technische details (controle, paden, selectors) verschijnen alleen na uitklappen.
import type { Actie, Indeling } from '../api.ts';
import { Badge, type Toon } from './basis.tsx';

export const ACTIE: Record<Actie, { label: string; toon: Toon; prioriteit: string }> = {
  conceptgeneratie: { label: 'nodig voor conceptgeneratie', toon: 'fout', prioriteit: 'hoog' },
  publicatie: { label: 'nodig vóór publicatie', toon: 'let-op', prioriteit: 'middel' },
  geen: { label: 'informatief', toon: 'info', prioriteit: 'laag' },
};
const VOLGORDE: Actie[] = ['conceptgeneratie', 'publicatie', 'geen'];

export function Meldingenoverzicht({ indeling, conceptgeneratie = true }: { indeling: Indeling; conceptgeneratie?: boolean }) {
  const kolommen = VOLGORDE.filter((a) => conceptgeneratie || a !== 'conceptgeneratie');
  const totaal = (a: Actie) => indeling.meldingen.filter((m) => m.actie === a).length;
  return (
    <div className="meldoverzicht">
      <p className="meldoverzicht-kort">
        {kolommen.map((a) => <span key={a}><Badge toon={totaal(a) ? ACTIE[a].toon : 'goed'}>{totaal(a)}</Badge> {ACTIE[a].label}</span>)}
      </p>
      <div className="tabel-schuif"><table className="lijst meldtabel">
        <thead><tr><th>Categorie</th>{kolommen.map((a) => <th key={a}>{ACTIE[a].label} <span className="bron">(prioriteit {ACTIE[a].prioriteit})</span></th>)}</tr></thead>
        <tbody>{indeling.samenvatting.map((c) => (
          <tr key={c.code}><td>{c.naam}</td>{kolommen.map((a) => <td key={a}>{c[a] ? <strong>{c[a]}</strong> : <span className="bron">0</span>}</td>)}</tr>))}</tbody>
      </table></div>
      {indeling.samenvatting.filter((c) => c.conceptgeneratie + c.publicatie + c.geen > 0).map((c) => {
        const items = indeling.meldingen.filter((m) => m.categorie === c.code).sort((x, y) => VOLGORDE.indexOf(x.actie) - VOLGORDE.indexOf(y.actie));
        return (
          <details key={c.code} className="uitklap" open={items.some((m) => m.actie === 'conceptgeneratie')}>
            <summary>{c.naam} ({items.length})</summary>
            <ul className="meldingen">{items.map((m, i) => (
              <li key={i} className={`m-${m.actie === 'conceptgeneratie' ? 'blokkerend' : m.actie === 'publicatie' ? 'aandacht' : 'info'}`}>
                <Badge toon={ACTIE[m.actie].toon}>{ACTIE[m.actie].label}</Badge> {m.tekst}
                <details className="techniek"><summary>technische details</summary><span className="mono">{m.bron}{m.detail ? ` · ${m.detail}` : ''}</span></details>
              </li>))}</ul>
          </details>
        );
      })}
    </div>
  );
}
