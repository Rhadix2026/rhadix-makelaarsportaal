// Makelaarskantoren: lijst, detail en formulier (aanmaken en wijzigen door platformbeheer).
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiFout, type Ik, type Kantoor } from './api.ts';
import { Badge, Kaart, PaginaTitel } from './onderdelen/basis.tsx';
import { ProfielKeuze } from './onderdelen/ProfielKeuze.tsx';

const ROL: Record<string, string> = { makelaar: 'Makelaar', kantoorbeheerder: 'Kantoorbeheerder' };

export function KantorenLijst({ ik }: { ik: Ik }) {
  const [kantoren, setKantoren] = useState<Kantoor[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  useEffect(() => { api<Kantoor[]>('/api/kantoren').then(setKantoren, (e) => setFout(e.message)); }, []);

  return (
    <>
      <div className="rij" style={{ alignItems: 'flex-start' }}>
        <PaginaTitel badge="Beheer" titel="Makelaarskantoren"
          sub={ik.platformbeheer ? 'Alle kantoren op het platform. Woningprojecten worden later per kantoor aangemaakt.' : 'De kantoren waarvoor u rechten heeft.'} />
        {ik.platformbeheer && <a className="knop knop-primair" href="#/kantoren/nieuw" style={{ textDecoration: 'none' }}>Nieuw kantoor</a>}
      </div>
      {fout && <p className="melding melding-fout" role="alert">{fout}</p>}
      {kantoren && (
        <section className="kaart lijst-kaart">
          {kantoren.length === 0 ? (
            <p className="leeg">{ik.platformbeheer ? 'Er zijn nog geen kantoren. Maak het eerste kantoor aan.' : 'U heeft nog geen toegang tot een kantoor.'}</p>
          ) : (
            <table className="lijst">
              <thead><tr><th>Kantoor</th><th>Contact</th><th>Standaardprofiel</th><th>Gebruikers</th><th>Status</th></tr></thead>
              <tbody>
                {kantoren.map((k) => (
                  <tr key={k.id}>
                    <td>
                      {k.merkkleur && <><span className="kleurstaal" style={{ background: k.merkkleur }} aria-hidden="true" />{' '}</>}
                      <a href={`#/kantoren/${k.id}`}>{k.merknaam}</a>
                      {k.juridische_naam && <div className="stat-sub">{k.juridische_naam}</div>}
                    </td>
                    <td>{k.telefoon ?? (k.email ? null : '—')}{k.email && <div className={k.telefoon ? 'stat-sub' : undefined}>{k.email}</div>}</td>
                    <td>{k.standaard_profiel ?? '—'}</td>
                    <td>{k.gebruikers ?? 0}</td>
                    <td><Badge toon={k.status === 'actief' ? 'goed' : 'let-op'}>{k.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}

export function KantoorDetail({ id, ik }: { id: string; ik: Ik }) {
  const [k, setK] = useState<Kantoor | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  useEffect(() => { api<Kantoor>(`/api/kantoren/${id}`).then(setK, (e) => setFout(e.message)); }, [id]);
  if (fout) return <><a className="terug" href="#/kantoren">← Kantoren</a><p className="melding melding-fout" role="alert">{fout}</p></>;
  if (!k) return null;
  const rijen: [string, ReactNode][] = [
    ['Merknaam (publiek)', k.merknaam],
    ['Juridische naam', k.juridische_naam ?? '—'],
    ['Korte naam', <span className="mono">{k.slug}</span>],
    ['Telefoon', k.telefoon ?? '—'],
    ['E-mail', k.email ?? '—'],
    ['Website', k.website ? <a href={k.website} target="_blank" rel="noreferrer noopener">{k.website}</a> : '—'],
    ['Adres', k.adresregels.length ? k.adresregels.map((r) => <div key={r}>{r}</div>) : '—'],
    ['Standaardprofiel', k.standaard_profiel ?? '—'],
    ['Merkkleur', k.merkkleur ? <><span className="kleurstaal" style={{ background: k.merkkleur }} aria-hidden="true" /> <span className="mono">{k.merkkleur}</span></> : '—'],
    ['Status', <Badge toon={k.status === 'actief' ? 'goed' : 'let-op'}>{k.status}</Badge>],
  ];
  return (
    <>
      <a className="terug" href="#/kantoren">← Kantoren</a>
      <div className="rij" style={{ alignItems: 'flex-start' }}>
        <PaginaTitel badge="Makelaarskantoor" titel={k.merknaam} sub={k.juridische_naam ? `Juridische naam: ${k.juridische_naam}` : undefined} />
        {ik.platformbeheer && <a className="knop knop-lijn" href={`#/kantoren/${k.id}/bewerken`} style={{ textDecoration: 'none' }}>Bewerken</a>}
      </div>
      <div className="raster raster-2">
        <Kaart titel="Gegevens">
          <table className="tabel"><tbody>{rijen.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}</tbody></table>
        </Kaart>
        <Kaart titel="Gebruikers">
          {k.leden?.length ? (
            <table className="tabel"><tbody>
              {k.leden.map((l) => <tr key={l.id}><td>{l.naam}<div className="stat-sub">{l.email}</div></td><td>{ROL[l.rol] ?? l.rol}</td></tr>)}
            </tbody></table>
          ) : <p className="stat-sub" style={{ marginTop: 0 }}>Nog geen gebruikers. In de eerste fase beheert het platform alle kantoren; gebruikers per kantoor volgen later.</p>}
        </Kaart>
      </div>
    </>
  );
}

const LEEG = { merknaam: '', juridische_naam: '', slug: '', telefoon: '', email: '', website: '', adres: '', standaard_profiel: '', merkkleur: '', status: 'actief' };

export function KantoorFormulier({ id }: { id?: string }) {
  const [w, setW] = useState(LEEG);
  const [profielen, setProfielen] = useState<{ naam: string; omschrijving: string }[]>([]);
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [melding, setMelding] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  useEffect(() => {
    api<{ details: { naam: string; omschrijving: string }[] }>('/api/catalogus/profielen').then((r) => setProfielen(r.details));
    if (id) api<Kantoor>(`/api/kantoren/${id}`).then((k) => setW({
      merknaam: k.merknaam, juridische_naam: k.juridische_naam ?? '', slug: k.slug, telefoon: k.telefoon ?? '', email: k.email ?? '', website: k.website ?? '',
      adres: k.adresregels.join('\n'), standaard_profiel: k.standaard_profiel ?? '', merkkleur: k.merkkleur ?? '', status: k.status,
    }), (e) => setMelding(e.message));
  }, [id]);

  const zet = (k: keyof typeof LEEG) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });

  async function verstuur(e: FormEvent) {
    e.preventDefault();
    setBezig(true); setFouten({}); setMelding(null);
    const data = { ...w, adresregels: w.adres.split('\n'), adres: undefined };
    try {
      const k = await api<Kantoor>(id ? `/api/kantoren/${id}` : '/api/kantoren', { methode: id ? 'PUT' : 'POST', data });
      location.hash = `#/kantoren/${k.id}`;
    } catch (x) {
      if (x instanceof ApiFout) { setFouten(x.fouten); setMelding(x.message); } else setMelding('De studio is niet bereikbaar');
    } finally { setBezig(false); }
  }

  const veld = (k: keyof typeof LEEG, label: string, invoer: ReactNode, hint?: string) => (
    <div className={`veld${fouten[k === 'adres' ? 'adresregels' : k] ? ' veld-fout' : ''}`}>
      <label htmlFor={k}>{label}</label>
      {invoer}
      {hint && <span className="hint">{hint}</span>}
      {fouten[k === 'adres' ? 'adresregels' : k] && <span className="fout">{fouten[k === 'adres' ? 'adresregels' : k]}</span>}
    </div>
  );

  return (
    <>
      <a className="terug" href={id ? `#/kantoren/${id}` : '#/kantoren'}>← {id ? 'Terug naar het kantoor' : 'Kantoren'}</a>
      <PaginaTitel badge="Makelaarskantoor" titel={id ? 'Kantoor bewerken' : 'Nieuw kantoor'}
        sub="Deze gegevens worden later bij elke woning van dit kantoor hergebruikt." />
      <form className="kaart formulier" onSubmit={verstuur} noValidate>
        {melding && <p className="melding melding-fout" role="alert">{melding}</p>}
        <div className="formulier-raster">
          {veld('merknaam', 'Merknaam (publiek) *', <input id="merknaam" value={w.merknaam} onChange={zet('merknaam')} required />, 'Zoals het kantoor zich presenteert, op de woningwebsites.')}
          {veld('juridische_naam', 'Juridische naam', <input id="juridische_naam" value={w.juridische_naam} onChange={zet('juridische_naam')} />, 'Statutaire naam of naam in het handelsregister, bijvoorbeeld met B.V.')}
          {veld('slug', 'Korte naam', <input id="slug" value={w.slug} onChange={zet('slug')} placeholder="automatisch uit de naam" />, 'Kleine letters, cijfers en koppeltekens; wordt gebruikt in woningnamen.')}
          {veld('telefoon', 'Telefoon', <input id="telefoon" type="tel" value={w.telefoon} onChange={zet('telefoon')} />)}
          {veld('email', 'E-mail', <input id="email" type="email" value={w.email} onChange={zet('email')} />)}
          {veld('website', 'Website', <input id="website" type="url" value={w.website} onChange={zet('website')} placeholder="https://" />)}
          {veld('adres', 'Adres', <textarea id="adres" value={w.adres} onChange={zet('adres')} />, 'Eén regel per adresregel, hooguit vier.')}
          {veld('standaard_profiel', 'Standaardprofiel', (
            <ProfielKeuze id="standaard_profiel" waarde={w.standaard_profiel} profielen={profielen}
              onChange={(v) => setW({ ...w, standaard_profiel: v })} leegLabel="Nog niet gekozen" leegUitleg="Per woning kiezen." />
          ), 'Presentatieprofielen van de generator (Apple-inspired Experience). Nieuwe woningen van dit kantoor nemen dit profiel over.')}
          {veld('merkkleur', 'Merkkleur', (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input id="merkkleur" value={w.merkkleur} onChange={zet('merkkleur')} placeholder="#1A2847" style={{ flex: 1 }} />
              {/^#[0-9A-Fa-f]{6}$/.test(w.merkkleur) && <span className="kleurstaal" style={{ background: w.merkkleur, width: 38, height: 38 }} aria-hidden="true" />}
            </div>
          ), 'Hexcode. Logo en volledige huisstijl volgen in een latere stap.')}
          {id && veld('status', 'Status', (
            <select id="status" value={w.status} onChange={zet('status')}>
              <option value="actief">actief</option>
              <option value="inactief">inactief</option>
            </select>
          ))}
        </div>
        <div className="knoppen">
          <button type="submit" className="knop knop-primair" disabled={bezig}>{bezig ? 'Bezig…' : id ? 'Opslaan' : 'Kantoor aanmaken'}</button>
          <a className="knop knop-lijn" href={id ? `#/kantoren/${id}` : '#/kantoren'} style={{ textDecoration: 'none' }}>Annuleren</a>
        </div>
      </form>
    </>
  );
}
