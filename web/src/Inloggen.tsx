import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiFout, type Ik, type InlogOpties } from './api.ts';

// Inloggen gaat via het Rhadix-platform (centrale login). De eigen wachtwoordlogin verschijnt alleen
// waar de API die toestaat: lokaal, of online als noodtoegang via een SSH-tunnel.
export function Inloggen({ ingelogd }: { ingelogd: (ik: Ik) => void }) {
  const [opties, setOpties] = useState<InlogOpties | null>(null);
  const [email, setEmail] = useState('');
  const [wachtwoord, setWachtwoord] = useState('');
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  useEffect(() => { api<InlogOpties>('/api/inlogopties').then(setOpties, () => setOpties({ rhadix: null, lokaal: true, melding: null })); }, []);

  async function verstuur(e: FormEvent) {
    e.preventDefault();
    setBezig(true); setFout(null);
    try { ingelogd(await api<Ik>('/api/inloggen', { methode: 'POST', data: { email, wachtwoord } })); }
    catch (x) { setFout(x instanceof ApiFout ? x.message : 'Het portaal is niet bereikbaar'); setWachtwoord(''); }
    finally { setBezig(false); }
  }
  if (!opties) return null;

  return (
    <div className="inlog-achtergrond">
      <form className="inlog-kaart formulier" onSubmit={verstuur} noValidate>
        <div>
          <div className="inlog-merk">RHADIX</div>
          <h1>Makelaarsportaal</h1>
          <p className="ondertitel">{opties.rhadix ? 'Log in met uw Rhadix-account.' : 'Log in met uw portaalaccount.'}</p>
        </div>
        {opties.melding && <p className="melding melding-fout" role="alert">{opties.melding}</p>}
        {fout && <p className="melding melding-fout" role="alert">{fout}</p>}
        {opties.rhadix && (
          <>
            <a className="knop knop-primair" href={`${opties.rhadix}/`} style={{ justifyContent: 'center', textDecoration: 'none' }}>Inloggen via Rhadix</a>
            <p className="stat-sub" style={{ margin: 0 }}>Na het inloggen kiest u in het Rhadix-portaal voor Makelaarsportaal, of opent u deze pagina opnieuw.</p>
          </>
        )}
        {opties.lokaal && (
          <>
            {opties.rhadix && <p className="stat-sub" style={{ margin: 0 }}>Noodtoegang met een portaalaccount:</p>}
            <div className="veld">
              <label htmlFor="email">E-mailadres</label>
              <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!opties.rhadix} />
            </div>
            <div className="veld">
              <label htmlFor="wachtwoord">Wachtwoord</label>
              <input id="wachtwoord" type="password" autoComplete="current-password" value={wachtwoord} onChange={(e) => setWachtwoord(e.target.value)} required />
            </div>
            <button type="submit" className={`knop ${opties.rhadix ? 'knop-lijn' : 'knop-primair'}`} disabled={bezig || !email || !wachtwoord} style={{ justifyContent: 'center' }}>
              {bezig ? 'Bezig…' : 'Inloggen'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
