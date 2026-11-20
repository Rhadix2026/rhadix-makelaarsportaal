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
  const laad = useCallback(() => api<(Punt & { versies: number[] })[]>('/api/verbeterpunten').then(setPunten, (e) => setFout(e.message)), []);
  useEffect(() => { void laad(); }, [laad]);
  if (fout) return <p className="melding melding-fout" role="alert">{fout}</p>;
  if (!punten) return null;
  const kantoren = [...new Set(punten.map((p) => p.kantoor ?? ''))].sort();
  const zicht = punten.filter((p) => (!kantoor || p.kantoor === kantoor) && (!status || p.status === status));
  return (
    <div>
      <PaginaTitel badge="Rhadix" titel="Verbeterpunten" sub={`${punten.length} open of in behandeling, van alle kantoren. Oudste eerst.`} />
      <div className="inline-form" style={{ marginBottom: 14 }}>
        <select aria-label="Kantoor" value={kantoor} onChange={(e) => setKantoor(e.target.value)}><option value="">Alle kantoren</option>{kantoren.map((k) => <option key={k}>{k}</option>)}</select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Open en in behandeling</option><option value="OPEN">Open</option><option value="IN_BEHANDELING">In behandeling</option></select>
      </div>
      {zicht.length ? <ul className="punten kaart">{zicht.map((p) => <PuntRegel key={p.id} p={p} beheer versies={p.versies ?? []} metProject onGewijzigd={() => void laad()} />)}</ul>
        : <p className="stat-sub">Er staan geen verbeterpunten open.</p>}
    </div>
  );
}
