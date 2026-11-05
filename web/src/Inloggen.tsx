import { useState, type FormEvent } from 'react';
import { api, ApiFout, type Ik } from './api.ts';

export function Inloggen({ ingelogd }: { ingelogd: (ik: Ik) => void }) {
  const [email, setEmail] = useState('');
  const [wachtwoord, setWachtwoord] = useState('');
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  async function verstuur(e: FormEvent) {
    e.preventDefault();
    setBezig(true); setFout(null);
    try { ingelogd(await api<Ik>('/api/inloggen', { methode: 'POST', data: { email, wachtwoord } })); }
    catch (x) { setFout(x instanceof ApiFout ? x.message : 'De studio is niet bereikbaar'); setWachtwoord(''); }
    finally { setBezig(false); }
  }

  return (
    <div className="inlog-achtergrond">
      <form className="inlog-kaart formulier" onSubmit={verstuur} noValidate>
        <div>
          <div className="inlog-merk">MAKELAARSPLATFORM</div>
          <h1>Productiestudio</h1>
          <p className="ondertitel">Log in met uw studio-account.</p>
        </div>
        {fout && <p className="melding melding-fout" role="alert">{fout}</p>}
        <div className="veld">
          <label htmlFor="email">E-mailadres</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="veld">
          <label htmlFor="wachtwoord">Wachtwoord</label>
          <input id="wachtwoord" type="password" autoComplete="current-password" value={wachtwoord} onChange={(e) => setWachtwoord(e.target.value)} required />
        </div>
        <button type="submit" className="knop knop-primair" disabled={bezig || !email || !wachtwoord} style={{ justifyContent: 'center' }}>
          {bezig ? 'Bezig…' : 'Inloggen'}
        </button>
      </form>
    </div>
  );
}
