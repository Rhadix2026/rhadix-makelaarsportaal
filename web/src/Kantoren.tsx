// Makelaarskantoren: lijst, detail en formulier (aanmaken en wijzigen door platformbeheer).
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiFout, upload, type Huisstijl, type Ik, type Kantoor, type RhadixOrganisatie } from './api.ts';
import { Badge, Kaart, PaginaTitel } from './onderdelen/basis.tsx';
import { ProfielKeuze } from './onderdelen/ProfielKeuze.tsx';
import { kortNaam } from './onderdelen/bestandsnaam.ts';
import { kantoorRechten } from './onderdelen/rechten.ts';

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
    ['Status', <Badge toon={k.status === 'actief' ? 'goed' : 'let-op'}>{k.status}</Badge>],
  ];
  return (
    <>
      <a className="terug" href="#/kantoren">← Kantoren</a>
      <div className="rij" style={{ alignItems: 'flex-start' }}>
        <PaginaTitel badge="Makelaarskantoor" titel={k.merknaam} sub={k.juridische_naam ? `Juridische naam: ${k.juridische_naam}` : undefined} />
        {kantoorRechten(ik, k.id).kantoorbeheer && <a className="knop knop-lijn" href={`#/kantoren/${k.id}/bewerken`} style={{ textDecoration: 'none' }}>Bewerken</a>}
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
      {ik.platformbeheer && <RhadixKoppeling kantoor={k} gewijzigd={(t) => setK({ ...k, rhadix_tenant_id: t })} />}
      <HuisstijlKaart id={k.id} beheer={kantoorRechten(ik, k.id).kantoorbeheer} />
    </>
  );
}

// Koppeling met de Rhadix-organisatie (op organisatie-ID, nooit op naam). Gebruikers van die
// organisatie met toegang tot Makelaarsportaal komen dan in dit kantoor, met hun Rhadix-rol.
function RhadixKoppeling({ kantoor, gewijzigd }: { kantoor: Kantoor; gewijzigd: (t: string | null) => void }) {
  const [org, setOrg] = useState<RhadixOrganisatie[]>([]);
  const [keuze, setKeuze] = useState('');
  const [fout, setFout] = useState<string | null>(null);
  useEffect(() => { api<RhadixOrganisatie[]>('/api/rhadix-organisaties').then(setOrg, () => setOrg([])); }, [kantoor.rhadix_tenant_id]);
  const zet = async (t: string | null) => {
    setFout(null);
    try { await api(`/api/kantoren/${kantoor.id}/rhadix-organisatie`, { methode: 'PUT', data: { tenant_id: t } }); gewijzigd(t); setKeuze(''); }
    catch (e) { setFout((e as Error).message); }
  };
  const huidig = org.find((o) => o.tenant_id === kantoor.rhadix_tenant_id);
  const vrij = org.filter((o) => !o.kantoor_id);
  return (
    <Kaart titel="Rhadix-organisatie">
      {fout && <p className="melding melding-fout" role="alert">{fout}</p>}
      {kantoor.rhadix_tenant_id ? (
        <div className="rij">
          <div>{huidig?.naam ?? 'Organisatie'}<div className="stat-sub mono">{kantoor.rhadix_tenant_id}</div></div>
          <button type="button" className="knop knop-lijn" onClick={() => zet(null)}>Ontkoppelen</button>
        </div>
      ) : (
        <div className="formulier">
          <p className="stat-sub" style={{ marginTop: 0 }}>Nog niet gekoppeld. Kies een organisatie die zich al via Rhadix heeft aangemeld, of vul het organisatie-ID uit Rhadix in.</p>
          <div className="veld">
            <label htmlFor="rhadix-org">Organisatie</label>
            <input id="rhadix-org" list="rhadix-org-lijst" className="mono" value={keuze} onChange={(e) => setKeuze(e.target.value.trim())} placeholder="organisatie-ID (UUID)" />
            <datalist id="rhadix-org-lijst">{vrij.map((o) => <option key={o.tenant_id} value={o.tenant_id}>{o.naam}</option>)}</datalist>
          </div>
          <button type="button" className="knop knop-primair" disabled={!keuze} onClick={() => zet(keuze)}>Koppelen</button>
        </div>
      )}
    </Kaart>
  );
}

const kleurstaal = (k: string | null, groot = false) => k ? <><span className="kleurstaal" style={{ background: k, ...(groot ? { width: 28, height: 28 } : {}) }} aria-hidden="true" /> <span className="mono">{k}</span></> : '—';

// Logo en huisstijl: kleuren uit het logo (generator), lege kleuren worden aangevuld, ingestelde pas na bevestiging vervangen.
function HuisstijlKaart({ id, beheer }: { id: string; beheer: boolean }) {
  const [h, setH] = useState<Huisstijl | null>(null);
  const [melding, setMelding] = useState<{ toon: 'goed' | 'fout'; tekst: string } | null>(null);
  const [bezig, setBezig] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { api<Huisstijl>(`/api/kantoren/${id}/huisstijl`).then(setH, () => setH(null)); }, [id]);
  if (!h) return null;
  const doe = async (fn: () => Promise<Huisstijl>, tekst: string) => {
    setBezig(true); setMelding(null);
    try { setH(await fn()); setMelding({ toon: 'goed', tekst }); }
    catch (e) { setMelding({ toon: 'fout', tekst: e instanceof ApiFout ? e.message : 'De studio is niet bereikbaar' }); }
    finally { setBezig(false); }
  };
  const kies = (f?: File) => f && doe(async () => (await upload<Huisstijl>(`/api/kantoren/${id}/logo`, f, () => {})).body, 'Logo opgeslagen; de kleuren zijn uit het logo afgeleid.');
  return (
    <section className="kaart" style={{ marginTop: 16 }}>
      <h2>Logo en huisstijl</h2>
      {melding && <p className={`melding melding-${melding.toon}`} role="status" style={{ marginBottom: 12 }}>{melding.tekst}</p>}
      <div className="raster raster-2">
        <div>
          {h.logo ? <div className="logo-voorbeeld"><img src={`/api/bestanden/${h.logo.id}`} alt="Logo van het kantoor" />
            <span className="stat-sub" title={h.logo.naam}>{h.logo.herkomst === 'brochure' ? 'Overgenomen uit een brochure' : kortNaam(h.logo.naam, 'Logo')}</span></div>
            : <p className="stat-sub" style={{ marginTop: 0 }}>Nog geen logo.</p>}
          {beheer && <>
            <button type="button" className="knop knop-lijn" disabled={bezig} onClick={() => ref.current?.click()}>{h.logo ? 'Ander logo uploaden' : 'Logo uploaden'}</button>
            <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { void kies(e.target.files?.[0]); e.target.value = ''; }} />
            <div className="hint stat-sub">PNG, JPEG, WebP of SVG. De kleuren worden afgeleid met de huisstijlfunctie van de generator.</div>
          </>}
        </div>
        <table className="tabel"><tbody>
          <tr><td>Merkkleur</td><td>{kleurstaal(h.merkkleur, true)}</td></tr>
          <tr><td>Detailkleur</td><td>{kleurstaal(h.detailkleur, true)}</td></tr>
          <tr><td>Herkomst</td><td>{h.herkomst === 'logo' ? 'afgeleid uit het logo' : h.herkomst === 'handmatig' ? 'handmatig ingesteld' : '—'}</td></tr>
          {h.voorstel && <tr><td>Uit het logo</td><td>{h.voorstel.merk ? <>{kleurstaal(h.voorstel.merk)} &nbsp;{kleurstaal(h.voorstel.detail)}</> : h.voorstel.bron}</td></tr>}
        </tbody></table>
      </div>
      {beheer && h.voorstel_wijkt_af && (
        <div className="melding melding-let-op" style={{ marginTop: 12 }}>
          De kleuren uit het logo wijken af van de ingestelde kleuren. Die blijven staan tot u het voorstel bevestigt.{' '}
          <button type="button" className="knop knop-lijn knop-klein" disabled={bezig}
            onClick={() => doe(() => api<Huisstijl>(`/api/kantoren/${id}/huisstijl/voorstel`, { methode: 'POST' }), 'Kleuren uit het logo overgenomen.')}>Voorstel overnemen</button>
        </div>
      )}
      {h.toepassing.length > 0 && <>
        <h3 className="tussenkop">Toepassing per presentatieprofiel</h3>
        <p className="stat-sub" style={{ marginTop: 0 }}>Voor tekst en knoppen wordt de merkkleur waar nodig donkerder of lichter gemaakt, zodat het contrast altijd minimaal 4,5:1 is.</p>
        <div className="tabel-schuif"><table className="lijst">
          <thead><tr><th>Profiel</th><th>Licht</th><th>Donker</th></tr></thead>
          <tbody>{h.toepassing.map((t) => (
            <tr key={t.profiel}><td>{t.profiel}</td>
              {[t.licht, t.donker].map((m, i) => <td key={i}><span className="huisstijl-proef" style={{ background: m.achtergrond, color: m.accent }}>Bezichtiging</span>{' '}
                <span className="mono">{m.accent}</span> · {m.contrast.toLocaleString('nl-NL')}:1{m.aangepast ? ' (aangepast)' : ''}</td>)}
            </tr>))}</tbody>
        </table></div>
      </>}
    </section>
  );
}

const LEEG = { merknaam: '', juridische_naam: '', slug: '', telefoon: '', email: '', website: '', adres: '', standaard_profiel: '', merkkleur: '', detailkleur: '', status: 'actief' };

// Korte naam en status wijzigt alleen platformbeheer; voor de kantoorbeheerder staan ze vast.
export function KantoorFormulier({ id, platform = false }: { id?: string; platform?: boolean }) {
  const [w, setW] = useState(LEEG);
  const [profielen, setProfielen] = useState<{ naam: string; omschrijving: string }[]>([]);
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [melding, setMelding] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  useEffect(() => {
    api<{ details: { naam: string; omschrijving: string }[] }>('/api/catalogus/profielen').then((r) => setProfielen(r.details));
    if (id) api<Kantoor>(`/api/kantoren/${id}`).then((k) => setW({
      merknaam: k.merknaam, juridische_naam: k.juridische_naam ?? '', slug: k.slug, telefoon: k.telefoon ?? '', email: k.email ?? '', website: k.website ?? '',
      adres: k.adresregels.join('\n'), standaard_profiel: k.standaard_profiel ?? '', merkkleur: k.merkkleur ?? '', detailkleur: k.detailkleur ?? '', status: k.status,
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
          {veld('slug', 'Korte naam', <input id="slug" value={w.slug} onChange={zet('slug')} placeholder="automatisch uit de naam" readOnly={!platform} />,
            platform ? 'Kleine letters, cijfers en koppeltekens; wordt gebruikt in woningnamen.' : 'Wordt gebruikt in woningnamen; wijzigen via Rhadix.')}
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
          ), 'Hexcode. Of upload een logo op de kantoorpagina: dan worden de kleuren eruit afgeleid.')}
          {veld('detailkleur', 'Detailkleur', (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input id="detailkleur" value={w.detailkleur} onChange={zet('detailkleur')} placeholder="#6FA8D0" style={{ flex: 1 }} />
              {/^#[0-9A-Fa-f]{6}$/.test(w.detailkleur) && <span className="kleurstaal" style={{ background: w.detailkleur, width: 38, height: 38 }} aria-hidden="true" />}
            </div>
          ), 'Tweede kleur uit de huisstijl, voor accenten.')}
          {id && veld('status', 'Status', (
            <select id="status" value={w.status} onChange={zet('status')} disabled={!platform}>
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
