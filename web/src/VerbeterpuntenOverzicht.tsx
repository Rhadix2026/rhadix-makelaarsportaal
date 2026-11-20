// Rhadix-platformbeheer: alle open verbeterpunten (OPEN en IN_BEHANDELING) van alle kantoren, oudste eerst,
// met de handelingen per punt. Alleen platformbeheer (de API weigert anderen).
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';
import { PaginaTitel } from './onderdelen/basis.tsx';
import { PuntRegel, type Punt } from './onderdelen/Verbeterpunten.tsx';

export function VerbeterpuntenOverzicht() {
  const [punten, setPunten] = useState<(Punt & { versies: number[] })[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [kantoor, setKantoor] = useState('');
  const [status, setStatus] = useState('');
  const alle = status === 'ALLE' || status === 'KLAAR' || status === 'GEANNULEERD';
  const laad = useCallback(() => api<(Punt & { versies: number[] })[]>(`/api/verbeterpunten${alle ? '?status=alle' : ''}`).then(setPunten, (e) => setFout(e.message)), [alle]);
  // Bewust bekeken: na het laden het eigen tijdstip vastleggen (de punten zelf veranderen niet).
  useEffect(() => { void laad().then(() => api('/api/aandacht/verbeterpunten/gezien', { methode: 'POST' }).catch(() => {})); }, [laad]);
  if (fout) return <p className="melding melding-fout" role="alert">{fout}</p>;
  if (!punten) return null;
  const kantoren = [...new Set(punten.map((p) => p.kantoor ?? ''))].sort();
  const zicht = punten.filter((p) => (!kantoor || p.kantoor === kantoor) && (!status || status === 'ALLE' || p.status === status));
  const werkvoorraad = punten.filter((p) => p.status === 'OPEN' || p.status === 'IN_BEHANDELING').length;
  return (
    <div>
      <PaginaTitel badge="Rhadix" titel="Verbeterpunten" sub={`Werkvoorraad: ${werkvoorraad} open of in behandeling, van alle kantoren. Oudste eerst. Verwerkte en geannuleerde punten via het statusfilter.`} />
      <div className="inline-form" style={{ marginBottom: 14 }}>
        <select aria-label="Kantoor" value={kantoor} onChange={(e) => setKantoor(e.target.value)}><option value="">Alle kantoren</option>{kantoren.map((k) => <option key={k}>{k}</option>)}</select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Werkvoorraad (open en in behandeling)</option><option value="OPEN">Open</option><option value="IN_BEHANDELING">In behandeling</option><option value="KLAAR">Verwerkt</option><option value="GEANNULEERD">Geannuleerd</option><option value="ALLE">Alle statussen</option></select>
      </div>
      {zicht.length ? <ul className="punten kaart">{zicht.map((p) => <PuntRegel key={p.id} p={p} beheer versies={p.versies ?? []} metProject onGewijzigd={() => void laad()} />)}</ul>
        : <p className="stat-sub">{status && status !== 'OPEN' && status !== 'IN_BEHANDELING' ? 'Geen verbeterpunten met deze status.' : 'Er staan geen verbeterpunten open.'}</p>}
    </div>
  );
}
