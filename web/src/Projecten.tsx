// Dashboard en woningprojecten: overzicht met filters, detail met status en voortgang, formulier.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiFout, type ConceptenOverzicht, type Ik, type Kantoor, type Project, type ProjectCatalogus } from './api.ts';
import { Badge, Kaart, PaginaTitel, StatKaart, type Toon } from './onderdelen/basis.tsx';
import { ProfielKeuze } from './onderdelen/ProfielKeuze.tsx';

// ── Status en voortgang ─────────────────────────────────────────────────────
const STATUS_TOON: Record<string, Toon> = {
  aanlevering_incompleet: 'let-op', klaar_voor_productie: 'info', in_productie: 'info', interne_review: 'info',
  ter_review: 'info', correctie: 'let-op', goedgekeurd: 'goed', publicatiecontrole: 'info',
  live: 'goed', onder_bod: 'goed', verkocht: 'goed', offline: 'let-op', archief: 'let-op',
};

/** De stappen van het productieproces (ontwerp §1.3), met de status waarin een woning bij die stap staat. */
const STAPPEN: { naam: string; uitleg: string }[] = [
  { naam: 'Project aangemaakt', uitleg: 'Gekoppeld aan een makelaarskantoor, basisgegevens vastgelegd.' },
  { naam: 'Aanlevering', uitleg: 'Brochure en foto\'s aanleveren; automatische import.' },
  { naam: 'Broncontrole', uitleg: 'Geëxtraheerde gegevens controleren, rechten bevestigen.' },
  { naam: 'Eerste concept', uitleg: 'Met één actie de bestaande generator starten.' },
  { naam: 'Redactie', uitleg: 'Teksten, foto\'s en presentatie aanpassen.' },
  { naam: 'Kwaliteitscontrole', uitleg: 'Automatische controles en interne beoordeling.' },
  { naam: 'Review makelaar', uitleg: 'Akkoord van de makelaar op deze versie.' },
  { naam: 'Publicatie', uitleg: 'Technische eindcontrole en publicatie.' },
];
const HUIDIGE_STAP: Record<string, number> = {
  aanlevering_incompleet: 1, klaar_voor_productie: 3, in_productie: 4, correctie: 4, interne_review: 5,
  ter_review: 6, goedgekeurd: 7, publicatiecontrole: 7, live: 8, onder_bod: 8, verkocht: 8, offline: 8, archief: 8,
};

function useCatalogus() {
  const [k, setK] = useState<ProjectCatalogus | null>(null);
  useEffect(() => { api<ProjectCatalogus>('/api/catalogus/project').then(setK); }, []);
  return k;
}

export function StatusBadge({ status, catalogus }: { status: string; catalogus: ProjectCatalogus | null }) {
  const label = catalogus?.statussen.find((s) => s.waarde === status)?.label ?? status;
  return <Badge toon={STATUS_TOON[status] ?? 'info'}>{label}</Badge>;
}

function Voortgang({ status }: { status: string }) {
  const nu = HUIDIGE_STAP[status] ?? 0;
  const klaar = nu >= STAPPEN.length ? STAPPEN.length : nu;
  return (
    <>
      <div className="rij" style={{ marginBottom: 10 }}>
        <span className="stat-label">{klaar} van {STAPPEN.length} stappen afgerond</span>
      </div>
      <div className="balk" aria-hidden="true"><div style={{ width: `${(klaar / STAPPEN.length) * 100}%` }} /></div>
      <ol className="voortgang" style={{ marginTop: 8 }}>
        {STAPPEN.map((s, i) => {
          const soort = i < nu ? 'klaar' : i === nu ? 'nu' : 'open';
          return (
            <li key={s.naam} aria-current={soort === 'nu' ? 'step' : undefined}>
              <span className={`stip stip-${soort}`}>{soort === 'klaar' ? '✓' : i + 1}</span>
              <div>
                <div className="stap-naam">{s.naam}{soort === 'nu' && <> <Badge>huidige stap</Badge></>}</div>
                <div className="stap-uitleg">{s.uitleg}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

// ── Dashboard ───────────────────────────────────────────────────────────────
const GROEPEN: { label: string; statussen: string[] }[] = [
  { label: 'Aanlevering', statussen: ['aanlevering_incompleet'] },
  { label: 'In productie', statussen: ['klaar_voor_productie', 'in_productie', 'interne_review', 'correctie'] },
  { label: 'Bij de makelaar', statussen: ['ter_review'] },
  { label: 'Publicatie', statussen: ['goedgekeurd', 'publicatiecontrole'] },
  { label: 'Live', statussen: ['live', 'onder_bod', 'verkocht'] },
];

export function Dashboard({ ik }: { ik: Ik }) {
  const catalogus = useCatalogus();
  const [kantoren, setKantoren] = useState<Kantoor[]>([]);
  const [filter, setFilter] = useState({ kantoor: '', status: '', zoek: '' });
  const [data, setData] = useState<{ projecten: Project[]; telling: Record<string, number> } | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  useEffect(() => { api<Kantoor[]>('/api/kantoren').then(setKantoren, () => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      const q = new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
      api<{ projecten: Project[]; telling: Record<string, number> }>(`/api/projecten?${q}`).then(setData, (e) => setFout(e.message));
    }, filter.zoek ? 250 : 0);
    return () => clearTimeout(t);
  }, [filter]);

  const zet = (k: keyof typeof filter) => (e: { target: { value: string } }) => setFilter({ ...filter, [k]: e.target.value });
  const actieveKantoren = kantoren.filter((k) => k.status === 'actief');

  return (
    <>
      <div className="rij" style={{ alignItems: 'flex-start' }}>
        <PaginaTitel badge="Dashboard" titel="Woningprojecten"
          sub={ik.platformbeheer ? 'Alle woningprojecten van alle kantoren.' : 'De woningprojecten van uw kantoren.'} />
        {ik.platformbeheer && actieveKantoren.length > 0 && <a className="knop knop-primair" href="#/projecten/nieuw" style={{ textDecoration: 'none' }}>Nieuw woningproject</a>}
      </div>

      {data && (
        <div className="raster raster-5" style={{ marginBottom: 16 }}>
          {GROEPEN.map((g) => (
            <StatKaart key={g.label} label={g.label} waarde={g.statussen.reduce((n, s) => n + (data.telling[s] ?? 0), 0)} />
          ))}
        </div>
      )}

      <div className="filters" role="search">
        <div className="veld">
          <label htmlFor="f-kantoor">Makelaarskantoor</label>
          <select id="f-kantoor" value={filter.kantoor} onChange={zet('kantoor')}>
            <option value="">Alle kantoren</option>
            {kantoren.map((k) => <option key={k.id} value={k.id}>{k.merknaam}</option>)}
          </select>
        </div>
        <div className="veld">
          <label htmlFor="f-status">Status</label>
          <select id="f-status" value={filter.status} onChange={zet('status')}>
            <option value="">Alle statussen</option>
            {catalogus?.statussen.map((s) => <option key={s.waarde} value={s.waarde}>{s.label}</option>)}
          </select>
        </div>
        <div className="veld">
          <label htmlFor="f-zoek">Zoeken</label>
          <input id="f-zoek" type="search" value={filter.zoek} onChange={zet('zoek')} placeholder="Naam, adres of plaats" />
        </div>
      </div>

      {fout && <p className="melding melding-fout" role="alert">{fout}</p>}
      {data && (
        <section className="kaart lijst-kaart">
          {data.projecten.length === 0 ? (
            <p className="leeg">
              {filter.kantoor || filter.status || filter.zoek ? 'Geen woningprojecten gevonden met deze filters.'
                : actieveKantoren.length === 0 && ik.platformbeheer ? <>Maak eerst een <a href="#/kantoren/nieuw">makelaarskantoor</a> aan.</>
                : 'Er zijn nog geen woningprojecten.'}
            </p>
          ) : (
            <table className="lijst">
              <thead><tr><th>Woning</th><th>Kantoor</th><th>Status</th><th>Profiel</th><th>Concepten</th><th>Gewijzigd</th><th><span className="sr-only">Actie</span></th></tr></thead>
              <tbody>
                {data.projecten.map((p) => (
                  // De hele rij opent het project; de link in de eerste kolom blijft het toetsenbordpad.
                  <tr key={p.id} className="klikbaar" onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) location.hash = `#/projecten/${p.id}`; }}>
                    <td><a href={`#/projecten/${p.id}`}>{p.naam}</a><div className="stat-sub">{[p.adres, p.plaats].filter(Boolean).join(', ') || p.slug}</div></td>
                    <td>{p.kantoor}</td>
                    <td><StatusBadge status={p.status} catalogus={catalogus} /></td>
                    <td>{p.profiel ?? '—'}</td>
                    <td>{p.concepten ? <a href={`#/projecten/${p.id}/concept`}>{p.concepten === 1 ? '1 versie' : `${p.concepten} versies`}</a> : 'nog geen'}</td>
                    <td>{new Date(p.gewijzigd_op).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td className="rij-actie" aria-hidden="true">Openen →</td>
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

// ── Detail ─────────────────────────────────────────────────────────────────
export function ProjectDetail({ id, ik }: { id: string; ik: Ik }) {
  const catalogus = useCatalogus();
  const [p, setP] = useState<Project | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  useEffect(() => { api<Project>(`/api/projecten/${id}`).then(setP, (e) => setFout(e.message)); }, [id]);
  if (fout) return <><a className="terug" href="#/projecten">← Woningprojecten</a><p className="melding melding-fout" role="alert">{fout}</p></>;
  if (!p) return null;
  const rijen: [string, ReactNode][] = [
    ['Adres', [p.adres, [p.postcode, p.plaats].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'],
    ['Woningtype', p.woningtype ?? '—'],
    ['Makelaarskantoor', <a href={`#/kantoren/${p.kantoor_id}`}>{p.kantoor}</a>],
    ['Contactpersoon', p.contactpersoon ?? '—'],
    ['Presentatieprofiel', p.profiel ?? '—'],
    ['Ontwerpsysteem', <>{p.ontwerpsysteem} <span className="stat-sub" style={{ display: 'inline' }}>vastgezet bij aanmaken</span></>],
    ['Gewenst domein', p.domein ?? '—'],
    ['Korte naam', <span className="mono">{p.slug}</span>],
    ['Aangemaakt', new Date(p.aangemaakt_op).toLocaleString('nl-NL')],
    ['Laatst gewijzigd', new Date(p.gewijzigd_op).toLocaleString('nl-NL')],
  ];
  return (
    <>
      <a className="terug" href="#/projecten">← Woningprojecten</a>
      <div className="rij" style={{ alignItems: 'flex-start' }}>
        <div className="titel">
          <div className="titel-badge">Woningproject</div>
          <h1>{p.naam}</h1>
          <p><StatusBadge status={p.status} catalogus={catalogus} /> &nbsp;{p.kantoor}</p>
        </div>
        <div className="knoppen">
          <a className="knop knop-primair" href={`#/projecten/${p.id}/aanlevering`} style={{ textDecoration: 'none' }}>Aanlevering</a>
          <a className="knop knop-primair" href={`#/projecten/${p.id}/beoordeling`} style={{ textDecoration: 'none' }}>Beoordeling en vrijgave</a>
          <a className="knop knop-primair" href={`#/projecten/${p.id}/concept`} style={{ textDecoration: 'none' }}>Concept en preview</a>
          {ik.platformbeheer && <a className="knop knop-lijn" href={`#/projecten/${p.id}/bewerken`} style={{ textDecoration: 'none' }}>Bewerken</a>}
        </div>
      </div>
      <div className="raster raster-2">
        <Kaart titel="Basisgegevens">
          <table className="tabel"><tbody>{rijen.map(([a, b]) => <tr key={a}><td>{a}</td><td>{b}</td></tr>)}</tbody></table>
        </Kaart>
        <Kaart titel="Voortgang"><Voortgang status={p.status} /></Kaart>
      </div>
      <ConceptVersies id={p.id} />
    </>
  );
}

/** De conceptversies van het project, met een directe link naar de preview van elke versie. */
function ConceptVersies({ id }: { id: string }) {
  const [d, setD] = useState<ConceptenOverzicht | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  useEffect(() => { api<ConceptenOverzicht>(`/api/projecten/${id}/concepten`).then(setD, (e) => setFout(e.message)); }, [id]);
  return (
    <div style={{ marginTop: 16 }}>
      <Kaart titel="Conceptversies">
        {fout ? <p className="melding melding-fout" role="alert">{fout}</p> : !d ? null : !d.concepten.length ? (
          <p className="bron" style={{ marginTop: 0 }}>
            Er is nog geen concept voor deze woning.{' '}
            {d.mag_genereren.ok ? <>De woning is vrijgegeven: <a href={`#/projecten/${id}/concept`}>genereer het eerste concept</a>.</>
              : <>{(d.mag_genereren.reden ?? 'De woning is nog niet vrijgegeven').replace(/\.?$/, '.')} Zie <a href={`#/projecten/${id}/beoordeling`}>beoordeling en vrijgave</a>.</>}
          </p>
        ) : (
          <table className="tabel">
            <thead><tr><th>Versie</th><th>Status</th><th>Gemaakt</th><th>Kwaliteit</th><th><span className="sr-only">Actie</span></th></tr></thead>
            <tbody>{d.concepten.map((c) => (
              <tr key={c.id}>
                <td><strong>v{c.versie}</strong></td>
                <td>{({ te_beoordelen: 'te beoordelen', geaccepteerd: 'geaccepteerd', verbeterpunten: 'verbeterpunten' } as Record<string, string>)[c.status] ?? c.status}</td>
                <td>{new Date(c.aangemaakt_op).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                <td>{c.kwaliteit_kort.blokkerend} blokkerend · {c.kwaliteit_kort.waarschuwingen} waarschuwingen</td>
                <td><a href={`#/projecten/${id}/concept/v${c.versie}`}>Preview bekijken →</a></td>
              </tr>))}
            </tbody>
          </table>
        )}
      </Kaart>
    </div>
  );
}

// ── Formulier ──────────────────────────────────────────────────────────────
const LEEG = { kantoor_id: '', naam: '', adres: '', postcode: '', plaats: '', woningtype: '', profiel: '', domein: '', contactpersoon: '' };

export function ProjectFormulier({ id }: { id?: string }) {
  const catalogus = useCatalogus();
  const [kantoren, setKantoren] = useState<Kantoor[]>([]);
  const [w, setW] = useState(LEEG);
  const [origineel, setOrigineel] = useState<Project | null>(null);
  const [profielHandmatig, setProfielHandmatig] = useState(!!id);
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [melding, setMelding] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  useEffect(() => {
    api<Kantoor[]>('/api/kantoren').then(setKantoren);
    if (id) api<Project>(`/api/projecten/${id}`).then((p) => {
      setOrigineel(p);
      setW({ kantoor_id: p.kantoor_id, naam: p.naam, adres: p.adres ?? '', postcode: p.postcode ?? '', plaats: p.plaats ?? '',
        woningtype: p.woningtype ?? '', profiel: p.profiel ?? '', domein: p.domein ?? '', contactpersoon: p.contactpersoon ?? '' });
    }, (e) => setMelding(e.message));
  }, [id]);

  const kantoor = useMemo(() => kantoren.find((k) => k.id === w.kantoor_id), [kantoren, w.kantoor_id]);
  // Bij een nieuw project volgt het profiel het standaardprofiel van het gekozen kantoor, tot het handmatig wordt gekozen.
  useEffect(() => { if (!profielHandmatig && kantoor) setW((x) => ({ ...x, profiel: kantoor.standaard_profiel ?? '' })); }, [kantoor, profielHandmatig]);

  const zet = (k: keyof typeof LEEG) => (e: { target: { value: string } }) => setW({ ...w, [k]: e.target.value });
  const kantoorVast = !!origineel && (origineel.status !== 'aanlevering_incompleet' || origineel.aanlevering_gestart);
  const kiesbaar = kantoren.filter((k) => k.status === 'actief' || k.id === w.kantoor_id);

  async function verstuur(e: FormEvent) {
    e.preventDefault();
    setBezig(true); setFouten({}); setMelding(null);
    try {
      // Nieuw project zonder eigen profielkeuze: het kantoor bepaalt (de server neemt de standaard over).
      // Een bewuste keuze, ook 'Nog niet gekozen', gaat altijd mee.
      const data = id || profielHandmatig ? w : { ...w, profiel: undefined };
      const p = await api<Project>(id ? `/api/projecten/${id}` : '/api/projecten', { methode: id ? 'PUT' : 'POST', data });
      location.hash = `#/projecten/${p.id}`;
    } catch (x) {
      if (x instanceof ApiFout) { setFouten(x.fouten); setMelding(x.message); } else setMelding('De studio is niet bereikbaar');
    } finally { setBezig(false); }
  }

  const veld = (k: keyof typeof LEEG, label: string, invoer: ReactNode, hint?: ReactNode) => (
    <div className={`veld${fouten[k] ? ' veld-fout' : ''}`}>
      <label htmlFor={k} id={`${k}-label`}>{label}</label>
      {invoer}
      {hint && <span className="hint">{hint}</span>}
      {fouten[k] && <span className="fout">{fouten[k]}</span>}
    </div>
  );

  return (
    <>
      <a className="terug" href={id ? `#/projecten/${id}` : '#/projecten'}>← {id ? 'Terug naar het project' : 'Woningprojecten'}</a>
      <PaginaTitel badge="Woningproject" titel={id ? 'Woningproject bewerken' : 'Nieuw woningproject'}
        sub={id ? undefined : 'Alleen het kantoor en de naam zijn nodig. De overige gegevens vult de brochure-import aan; wat u hier invult, wordt daarbij nooit zonder bevestiging overschreven.'} />
      <form className="kaart formulier" onSubmit={verstuur} noValidate>
        {melding && <p className="melding melding-fout" role="alert">{melding}</p>}
        <div className="formulier-raster">
          {veld('kantoor_id', 'Makelaarskantoor *', (
            <select id="kantoor_id" value={w.kantoor_id} onChange={zet('kantoor_id')} disabled={kantoorVast}>
              <option value="">Kies een kantoor</option>
              {kiesbaar.map((k) => <option key={k.id} value={k.id}>{k.merknaam}{k.status !== 'actief' ? ' (inactief)' : ''}</option>)}
            </select>
          ), kantoorVast ? 'Vast: de aanlevering is al begonnen.' : undefined)}
          {veld('naam', 'Naam van de woning *', <input id="naam" value={w.naam} onChange={zet('naam')} placeholder="bijvoorbeeld Voorbeeldweg 1" />,
            id ? <>Korte naam: <span className="mono">{origineel?.slug}</span> (vast)</> : 'De korte naam wordt automatisch gemaakt uit kantoor en naam.')}
          <p className="formulier-tussenkop">Optioneel: wordt bij de brochure-import aangevuld</p>
          {veld('adres', 'Straat en huisnummer', <input id="adres" value={w.adres} onChange={zet('adres')} />)}
          {veld('postcode', 'Postcode', <input id="postcode" value={w.postcode} onChange={zet('postcode')} placeholder="1234 AB" />)}
          {veld('plaats', 'Plaats', <input id="plaats" value={w.plaats} onChange={zet('plaats')} />)}
          {veld('woningtype', 'Woningtype', (
            <select id="woningtype" value={w.woningtype} onChange={zet('woningtype')}>
              <option value="">Nog niet gekozen</option>
              {catalogus?.woningtypen.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          ))}
          {veld('contactpersoon', 'Contactpersoon makelaar', <input id="contactpersoon" value={w.contactpersoon} onChange={zet('contactpersoon')} />)}
          {veld('domein', 'Gewenst domein', <input id="domein" value={w.domein} onChange={zet('domein')} placeholder="voorbeeldweg1.nl" />, 'Optioneel; publicatie volgt in een latere fase.')}
        </div>
        {veld('profiel', 'Presentatieprofiel', (
          <ProfielKeuze id="profiel" waarde={w.profiel} profielen={catalogus?.profielen ?? []}
            onChange={(v) => { setProfielHandmatig(true); setW({ ...w, profiel: v }); }}
            leegLabel="Nog niet gekozen" leegUitleg="Later kiezen, bijvoorbeeld na de aanlevering." />
        ), kantoor?.standaard_profiel
          ? <>Standaard van {kantoor.merknaam}: <strong>{kantoor.standaard_profiel}</strong>. Een keuze hier geldt alleen voor deze woning; het kantoor verandert niet.</>
          : 'Het kantoor heeft geen standaardprofiel.')}
        <p className="stat-sub" style={{ marginTop: 0 }}>Ontwerpsysteem: <strong>{origineel?.ontwerpsysteem ?? catalogus?.ontwerpsysteem ?? '—'}</strong> {id ? '(vastgezet bij aanmaken)' : '(standaard voor nieuwe woningen, wordt vastgezet)'}</p>
        <div className="knoppen">
          <button type="submit" className="knop knop-primair" disabled={bezig}>{bezig ? 'Bezig…' : id ? 'Opslaan' : 'Woningproject aanmaken'}</button>
          <a className="knop knop-lijn" href={id ? `#/projecten/${id}` : '#/projecten'} style={{ textDecoration: 'none' }}>Annuleren</a>
        </div>
      </form>
    </>
  );
}
