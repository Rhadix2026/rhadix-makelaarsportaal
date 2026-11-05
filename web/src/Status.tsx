// Stap 1: statuspagina. Toont of de studio, de database en de productie-instantie van de
// generator klaarstaan. Leest alleen; er wordt niets gestart of gewijzigd.
import { useCallback, useEffect, useState } from 'react';
import { Badge, Gegevens, Kaart, KnopLijn, PaginaTitel, StatKaart, type Toon } from './onderdelen/basis.tsx';

type Status = {
  studio: { versie: string; node: string; omgeving: string; adres: string };
  database: { verbonden: boolean; versie?: string; fout?: string; migraties: string[] };
  generator: {
    gevonden: boolean; pad: string; commit?: string; commit_verwacht?: boolean; werkmap_schoon?: boolean;
    versie?: string; node?: string; opdrachten?: string[];
    ontwerpsysteem?: { standaard: string; versies: { versie: string; status: string; omschrijving: string | null }[] };
    profielen?: string[];
    beeldclassificatie?: { beschikbaar: boolean; model: string; ontbreekt: string[] };
    chromium?: { beschikbaar: boolean; versie?: string; fout?: string };
  };
  tijd: string;
};

const ja = (ok: boolean | undefined, goed = 'ja', fout = 'nee') => <Badge toon={ok ? 'goed' : 'fout'}>{ok ? goed : fout}</Badge>;

export function StatusPagina() {
  const [s, setS] = useState<Status | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  const laad = useCallback(async () => {
    setBezig(true); setFout(null);
    try {
      const r = await fetch('/api/status');
      if (!r.ok) throw new Error(`API antwoordt met ${r.status}`);
      setS(await r.json());
    } catch (e) { setFout((e as Error).message); } finally { setBezig(false); }
  }, []);
  useEffect(() => { laad(); }, [laad]);

  const g = s?.generator;
  const genToon: Toon = !g?.gevonden ? 'fout' : g.commit_verwacht && g.werkmap_schoon ? 'goed' : 'let-op';

  return (
    <>
      <div className="rij" style={{ alignItems: 'flex-start' }}>
        <PaginaTitel badge="Systeembeheer" titel="Systeemstatus"
          sub="Technische status van de studio, de database en de productie-instantie van de bestaande generator. Alleen voor platformbeheer; er wordt niets gestart of gewijzigd." />
        <KnopLijn onClick={laad} disabled={bezig}>{bezig ? 'Bezig…' : 'Opnieuw controleren'}</KnopLijn>
      </div>

      {fout && <p className="melding melding-fout" role="alert">De studio-API is niet bereikbaar: {fout}</p>}

      {s && (
        <>
          <div className="raster raster-4">
            <StatKaart label="Generator (productie-instantie)" waarde={g?.versie ?? '—'} toon={genToon}
              sub={g?.commit ? <span className="mono">{g.commit.slice(0, 7)}</span> : g?.pad} />
            <StatKaart label="Ontwerpsysteem (standaard)" waarde={g?.ontwerpsysteem?.standaard ?? '—'}
              toon={g?.ontwerpsysteem ? 'goed' : 'fout'} sub="voor nieuwe woningen" />
            <StatKaart label="Database" waarde={s.database.verbonden ? 'Verbonden' : 'Geen verbinding'}
              toon={s.database.verbonden ? 'goed' : 'fout'} sub={s.database.versie ? `PostgreSQL ${s.database.versie}` : s.database.fout} />
            <StatKaart label="Beeldclassificatie (lokaal)" waarde={g?.beeldclassificatie?.beschikbaar ? 'Beschikbaar' : 'Uit'}
              toon={g?.beeldclassificatie?.beschikbaar ? 'goed' : 'let-op'} sub="SigLIP, zonder netwerk" />
          </div>

          <div className="raster raster-2" style={{ marginTop: 16 }}>
            <Kaart titel="Generator">
              {g?.gevonden ? (
                <Gegevens rijen={[
                  ['Pad', <span className="mono">{g.pad}</span>],
                  ['Commit', <><span className="mono">{g.commit?.slice(0, 12)}</span> {ja(g.commit_verwacht, 'vastgezette versie', 'afwijkend')}</>],
                  ['Werkmap', ja(g.werkmap_schoon, 'ongewijzigd', 'gewijzigd')],
                  ['Node', g.node],
                  ['Chromium (bouw en keuring)', <>{ja(g.chromium?.beschikbaar, 'beschikbaar', 'ontbreekt')} {g.chromium?.versie && <span className="mono">playwright {g.chromium.versie}</span>}</>],
                  ['Bestaande opdrachten', <div className="chips">{g.opdrachten?.map((o) => <span className="chip mono" key={o}>mp {o}</span>)}</div>],
                ]} />
              ) : <p className="melding melding-fout">Geen generator gevonden op {g?.pad}</p>}
            </Kaart>

            <Kaart titel="Ontwerpsysteem en profielen">
              <table className="tabel">
                <thead><tr><th>Versie</th><th>Status</th></tr></thead>
                <tbody>
                  {g?.ontwerpsysteem?.versies.map((v) => (
                    <tr key={v.versie}>
                      <td><strong>{v.versie}</strong>{v.versie === g.ontwerpsysteem?.standaard && <> <Badge>standaard</Badge></>}</td>
                      <td><Badge toon={v.status === 'vastgesteld' ? 'goed' : 'let-op'}>{v.status}</Badge>{v.omschrijving && <div className="stat-sub">{v.omschrijving}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 14 }}>
                <div className="stat-label" style={{ marginBottom: 6 }}>Profielen (Apple-inspired Experience)</div>
                <div className="chips">{g?.profielen?.map((p) => <span className="chip" key={p}>{p}</span>)}</div>
              </div>
            </Kaart>

            <Kaart titel="Studio">
              <Gegevens rijen={[
                ['Versie', s.studio.versie],
                ['Omgeving', <>{s.studio.omgeving} · <span className="mono">{s.studio.adres}</span></>],
                ['Node', s.studio.node],
                ['Databasemigraties', s.database.migraties.length ? <div className="chips">{s.database.migraties.map((m) => <span className="chip mono" key={m}>{m}</span>)}</div> : '—'],
              ]} />
            </Kaart>

            <Kaart titel="Gegevensscheiding">
              <Gegevens rijen={[
                ['Databaserol voor gebruikers', <span className="mono">studio_app</span>],
                ['Row Level Security', 'kantoor, lidmaatschap, gebruiker, audit'],
                ['Platformbeheer', 'ziet alle kantoren'],
                ['Overige gebruikers', 'alleen eigen kantoren'],
              ]} />
            </Kaart>
          </div>

          <p className="voet">Gecontroleerd op {new Date(s.tijd).toLocaleString('nl-NL')}.</p>
        </>
      )}
    </>
  );
}
