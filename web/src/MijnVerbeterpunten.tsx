// Verbeterpunten voor kantoorbeheerder en makelaar: alleen wat voor hen relevant is (server-side bepaald:
// kantoorbeheerder het eigen kantoor, makelaar zijn eigen punten), in drie categorieën: nieuw sinds de
// laatste inzage, open of in behandeling, afgehandeld. Het openen van deze lijst legt 'bewust bekeken' vast
// (na het laden, zodat de nieuwe punten nu nog als nieuw zichtbaar zijn); de punten zelf veranderen niet.
import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { Badge, Kaart, PaginaTitel } from './onderdelen/basis.tsx';
import { STATUS_PUNT, type Punt } from './onderdelen/Verbeterpunten.tsx';
import { puntLink } from './onderdelen/Aandacht.tsx';

type Rij = Punt & { nieuw: boolean; eigen: boolean; adres: string | null; plaats: string | null; project_naam: string };
const datum = (s?: string | null) => (s ? new Date(s).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' }) : '');

export function MijnVerbeterpunten() {
  const [d, setD] = useState<{ rol: string; gezien_op: string | null; punten: Rij[] } | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  useEffect(() => {
    api<{ rol: string; gezien_op: string | null; punten: Rij[] }>('/api/aandacht/verbeterpunten')
      .then((r) => { setD(r); void api('/api/aandacht/verbeterpunten/gezien', { methode: 'POST' }).catch(() => {}); }, (e) => setFout(e.message));
  }, []);
  if (fout) return <p className="melding melding-fout" role="alert">{fout}</p>;
  if (!d) return null;
  const open = (p: Rij) => p.status === 'OPEN' || p.status === 'IN_BEHANDELING';
  const groepen: [string, Rij[]][] = [
    ['Nieuw sinds uw laatste inzage', d.punten.filter((p) => p.nieuw)],
    ['Open of in behandeling', d.punten.filter((p) => !p.nieuw && open(p))],
    ['Afgehandeld', d.punten.filter((p) => !p.nieuw && !open(p))],
  ];
  return (
    <div>
      <PaginaTitel badge="Verbeterpunten" titel={d.rol === 'makelaar' ? 'Mijn verbeterpunten' : 'Verbeterpunten van uw kantoor'}
        sub={d.gezien_op ? `Laatst bekeken op ${datum(d.gezien_op)}.` : 'U bekijkt deze lijst voor het eerst.'} />
      {groepen.map(([titel, lijst]) => (
        <Kaart key={titel} titel={`${titel} (${lijst.length})`}>
          {lijst.length ? <ul className="punten">{lijst.map((p) => {
            const [toon, label] = STATUS_PUNT[p.status];
            return (
              <li key={p.id} className={`punt${p.nieuw ? ' punt-nieuw' : ''}`}>
                <div className="punt-kop"><Badge toon={toon}>{p.status === 'KLAAR' && p.verwerkt_in_versie ? `${label} in v${p.verwerkt_in_versie}` : label}</Badge>
                  <span className="punt-onderdeel">{p.onderdeel}</span>
                  <a className="punt-project" href={puntLink(p)}>{[p.adres, p.plaats].filter(Boolean).join(', ') || p.project_naam} · v{p.versie}</a></div>
                <p className="punt-tekst">{p.tekst}</p>
                {p.reactie && <p className="punt-reactie"><strong>{p.status === 'GEANNULEERD' ? 'Motivering' : 'Reactie'} Rhadix:</strong> {p.reactie}</p>}
              </li>);
          })}</ul> : <p className="stat-sub" style={{ margin: 0 }}>Geen.</p>}
        </Kaart>
      ))}
    </div>
  );
}
