import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import { api, type Ik } from './api.ts';
import { Navigatie, Pagina } from './onderdelen/basis.tsx';
import { Inloggen } from './Inloggen.tsx';
import { KantoorDetail, KantoorFormulier, KantorenLijst } from './Kantoren.tsx';
import { StatusPagina } from './Status.tsx';
import { Dashboard, ProjectDetail, ProjectFormulier } from './Projecten.tsx';
import { AanleverScherm } from './Aanlevering.tsx';
import { BeoordelingScherm } from './Beoordeling.tsx';
import { ConceptScherm } from './Concepten.tsx';

function useHash() {
  const [hash, setHash] = useState(location.hash || '#/projecten');
  useEffect(() => {
    const f = () => setHash(location.hash || '#/projecten');
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return hash;
}

function Scherm({ hash, ik }: { hash: string; ik: Ik }) {
  let m;
  if (hash === '#/systeem') return ik.platformbeheer ? <StatusPagina /> : <p className="melding melding-fout">Alleen voor platformbeheer.</p>;
  if (hash === '#/kantoren/nieuw') return ik.platformbeheer ? <KantoorFormulier /> : <p className="melding melding-fout">Alleen voor platformbeheer.</p>;
  if ((m = hash.match(/^#\/kantoren\/([0-9a-f-]{36})\/bewerken$/))) return <KantoorFormulier id={m[1]} />;
  if ((m = hash.match(/^#\/kantoren\/([0-9a-f-]{36})$/))) return <KantoorDetail id={m[1]} ik={ik} />;
  if (hash.startsWith('#/kantoren')) return <KantorenLijst ik={ik} />;
  if (hash === '#/projecten/nieuw') return ik.platformbeheer ? <ProjectFormulier /> : <p className="melding melding-fout">Alleen voor platformbeheer.</p>;
  if ((m = hash.match(/^#\/projecten\/([0-9a-f-]{36})\/bewerken$/))) return <ProjectFormulier id={m[1]} />;
  if ((m = hash.match(/^#\/projecten\/([0-9a-f-]{36})\/aanlevering$/))) return <AanleverScherm id={m[1]} ik={ik} />;
  if ((m = hash.match(/^#\/projecten\/([0-9a-f-]{36})\/concept$/))) return <ConceptScherm id={m[1]} ik={ik} />;
  if ((m = hash.match(/^#\/projecten\/([0-9a-f-]{36})\/beoordeling$/))) return <BeoordelingScherm id={m[1]} ik={ik} />;
  if ((m = hash.match(/^#\/projecten\/([0-9a-f-]{36})$/))) return <ProjectDetail id={m[1]} ik={ik} />;
  return <Dashboard ik={ik} />;
}

function App() {
  const [ik, setIk] = useState<Ik | null | undefined>(undefined);
  const hash = useHash();

  useEffect(() => { api<Ik>('/api/ik').then(setIk, () => setIk(null)); }, []);
  useEffect(() => {
    const f = () => setIk(null);
    addEventListener('studio:uitgelogd', f);
    return () => removeEventListener('studio:uitgelogd', f);
  }, []);
  const uitloggen = useCallback(async () => { await api('/api/uitloggen', { methode: 'POST' }).catch(() => {}); setIk(null); }, []);

  if (ik === undefined) return null;
  if (ik === null) return <Inloggen ingelogd={setIk} />;

  const actief = (pad: string) => (hash.startsWith(pad) ? 'page' : undefined);
  return (
    <>
      <Navigatie
        links={<>
          <a className="nav-link" href="#/projecten" aria-current={actief('#/projecten')}>Woningprojecten</a>
          <a className="nav-link" href="#/kantoren" aria-current={actief('#/kantoren')}>Kantoren</a>
          {ik.platformbeheer && <a className="nav-link" href="#/systeem" aria-current={actief('#/systeem')}>Systeem</a>}
        </>}
        rechts={<>
          <span className="nav-gebruiker">{ik.naam}{ik.platformbeheer ? ' · platformbeheer' : ''}</span>
          <button type="button" className="nav-knop" onClick={uitloggen}>Uitloggen</button>
        </>}
      />
      <Pagina><Scherm hash={hash} ik={ik} /></Pagina>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
