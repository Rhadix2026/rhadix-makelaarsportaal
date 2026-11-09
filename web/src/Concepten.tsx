// Concept en preview (stap 6): met één actie een lokaal concept genereren met de bestaande generator,
// het bekijken op desktop, tablet en mobiel, het kwaliteitsrapport van Design System 1.0, en het
// concept accepteren of verbeterpunten vastleggen. Elke generatie is een nieuwe versie; niets wordt
// overschreven of gepubliceerd.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiFout, type Concept, type ConceptenOverzicht, type Ik, type Meetwaarde } from './api.ts';
import { Badge, Kaart, type Toon } from './onderdelen/basis.tsx';
import { Fasebalk, useBeoordeling } from './Beoordeling.tsx';
import { Meldingenoverzicht } from './onderdelen/Meldingen.tsx';
import { useActiviteit } from './onderdelen/activiteit.ts';
import { useRechten } from './onderdelen/rechten.ts';

const APPARATEN = [{ naam: 'Desktop', breedte: 1440, hoogte: 900 }, { naam: 'Tablet', breedte: 768, hoogte: 1024 }, { naam: 'Mobiel', breedte: 390, hoogte: 844 }];
const STATUS: Record<string, [Toon, string]> = { te_beoordelen: ['let-op', 'te beoordelen'], geaccepteerd: ['goed', 'geaccepteerd'], verbeterpunten: ['fout', 'verbeterpunten'] };
const ONDERDELEN = ['algemeen', 'openingsbeeld', 'teksten', "foto's", 'indeling', 'kenmerken', 'huisstijl', 'contact', 'mobiel'];
const datum = (s?: string | null) => (s ? new Date(s).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const duur = (ms?: number | null) => {
  if (ms == null) return '—';
  if (ms < 60e3) return `${(ms / 1000).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} s`;
  const m = Math.floor(ms / 60e3), s = Math.round((ms % 60e3) / 1000);
  return m >= 60 ? `${Math.floor(m / 60)} u ${m % 60} min` : `${m} min ${s} s`;
};

/** Iframe op ware grootte, geschaald naar de beschikbare breedte. */
function Voorbeeld({ token, breedte, hoogte }: { token: string; breedte: number; hoogte: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [schaal, setSchaal] = useState(1);
  useEffect(() => {
    const meet = () => setSchaal(Math.min(1, (ref.current?.clientWidth ?? breedte) / breedte));
    meet(); addEventListener('resize', meet); return () => removeEventListener('resize', meet);
  }, [breedte]);
  return (
    <div ref={ref} className="voorbeeld-kader">
      <div style={{ width: breedte * schaal, height: hoogte * schaal, margin: '0 auto', overflow: 'hidden' }}>
        <iframe title={`Voorbeeld ${breedte} px`} src={`/api/voorbeeld/${token}/`} sandbox="allow-scripts" referrerPolicy="no-referrer"
          style={{ width: breedte, height: hoogte, transform: `scale(${schaal})`, transformOrigin: '0 0', border: 0, background: '#fff' }} />
      </div>
      <div className="bron" style={{ textAlign: 'center' }}>{breedte} × {hoogte} px{schaal < 1 ? ` · weergegeven op ${Math.round(schaal * 100)} %` : ''}</div>
    </div>
  );
}

function Meetwaarden({ rijen }: { rijen: Meetwaarde[] }) {
  if (!rijen.length) return <p className="bron">Geen metingen.</p>;
  return (
    <div className="tabel-schuif"><table className="lijst">
      <thead><tr><th>Criterium</th><th>Waarde</th><th>Norm</th><th></th></tr></thead>
      <tbody>{rijen.map((m, i) => <tr key={i}><td>{m.criterium}</td><td>{String(m.waarde)}</td><td>{m.norm}</td><td>{m.ok ? <Badge toon="goed">binnen norm</Badge> : <Badge toon="let-op">buiten norm</Badge>}</td></tr>)}</tbody>
    </table></div>
  );
}

/** Het kwaliteitsrapport (mp kwaliteit): samenvatting en meldingen per categorie; meetwaarden en techniek uitklapbaar. */
function Kwaliteit({ k }: { k: Concept }) {
  const q = k.kwaliteit, qa = k.bouw.rapport.qa;
  const mw = q?.meetwaarden ?? [];
  const toegankelijk = mw.filter((m) => /toegankelijkheid|contrast|aanraakdoel|focus|alt/i.test(m.criterium));
  const laadtijd = mw.filter((m) => /LCP|CLS|externe verzoeken|gewicht|bytes|laad/i.test(m.criterium));
  const overig = mw.filter((m) => !toegankelijk.includes(m) && !laadtijd.includes(m));
  const techniek: Meetwaarde[] = [
    { criterium: 'lokale verwijzingen (site)', waarde: `${qa.site?.verwijzingen ?? '—'} gecontroleerd, ${qa.site?.fouten.length ?? 0} fout`, norm: '0 fouten', ok: !(qa.site?.fouten.length) },
    { criterium: 'feitencontrole (maten in tekst)', waarde: `${qa.feiten?.getoetst ?? 0} getoetst, ${qa.feiten?.fouten.length ?? 0} fout`, norm: '0 fouten', ok: !(qa.feiten?.fouten.length) },
    { criterium: 'bijna-dubbele foto\'s op de pagina', waarde: qa.bijna_dubbel?.length ?? 0, norm: '0', ok: !(qa.bijna_dubbel?.length) },
  ];
  const buiten = [...mw, ...techniek].filter((m) => !m.ok).length;
  const kern = (rx: RegExp) => mw.find((m) => rx.test(m.criterium));
  return (
    <>
      <p className="bron" style={{ marginTop: 0 }}>Kwaliteitscontrole van Design System 1.0 op het gegenereerde concept. Het concept bestaat al: meldingen gelden voor de publicatie of zijn informatief.
        {q && !q.publiceerbaar && <> Publicatie vraagt nog afzonderlijke controles{q.redenen.length ? ` (${q.redenen.join('; ')})` : ''}.</>}</p>
      {!q || !k.indeling ? <p className="melding melding-fout">Het kwaliteitsrapport ontbreekt voor deze versie.</p> : <>
        <Meldingenoverzicht indeling={k.indeling} conceptgeneratie={false} />
        <p className="bron">Techniek: toegankelijkheid {toegankelijk.every((m) => m.ok) ? 'zonder bevindingen' : 'met bevindingen'} · LCP {String(kern(/LCP/)?.waarde ?? '—')} · CLS {String(kern(/CLS/)?.waarde ?? '—')}
          {' '}· externe verzoeken {String(kern(/externe/)?.waarde ?? '—')} · {buiten} meetwaarde{buiten === 1 ? '' : 'n'} buiten norm.</p>
        <details className="uitklap"><summary>Technische meetwaarden ({mw.length + techniek.length}): toegankelijkheid, laadtijd, techniek, ontwerp en taal</summary>
          <h3 className="tussenkop">Toegankelijkheid</h3><Meetwaarden rijen={toegankelijk} />
          <h3 className="tussenkop">Laadtijd en technische kwaliteit</h3><Meetwaarden rijen={[...laadtijd, ...techniek]} />
          <h3 className="tussenkop">Ontwerp en taal</h3><Meetwaarden rijen={overig} />
        </details>
      </>}
      <details className="uitklap"><summary>Opbouw van de pagina (automatische compositie, {k.bouw.onderdelen.length} delen)</summary>
        <div className="chips" style={{ margin: '8px 0' }}>{k.bouw.onderdelen.map((o, i) => <span key={i} className="chip">{o}</span>)}</div>
        <ul>{k.bouw.rapport.besluiten.map((b, i) => <li key={i}><span className="mono">{b.regel}</span> {b.tekst}</li>)}</ul>
      </details>
    </>
  );
}

/** Waarop het concept rust: bronovername en open onzekerheden (vastgelegd bij het genereren). */
function Uitgangspunten({ k }: { k: Concept }) {
  const u = k.uitgangspunten;
  if (!u) return <p className="bron" style={{ marginTop: 0 }}>Niet vastgelegd: deze versie is gemaakt vóór de registratie van uitgangspunten. De gegevens van toen staan in de aanlevering van de versie.</p>;
  return (
    <>
      <p className="bron" style={{ marginTop: 0 }}>{u.bronovername
        ? <>Bron overgenomen als uitgangspunt op {datum(u.bronovername.op)}{u.bronovername.door ? ` door ${u.bronovername.door}` : ''} (brochure-PDF, import {u.bronovername.volgnummer}, sha256 {(u.bronovername.sha256 ?? '').slice(0, 12)}). Geen individuele verificatie.</>
        : 'Geen bronovername: de gegevens zijn afzonderlijk beoordeeld.'} {u.gecontroleerd} gegevens afzonderlijk gecontroleerd of gecorrigeerd, {u.onbevestigd.length} onbevestigd.</p>
      {u.onzekerheden.length > 0 ? <div className="tabel-schuif"><table className="lijst">
        <thead><tr><th>Gegeven</th><th>Gebruikte waarde</th><th>Onzekerheid</th><th>Bronnen</th></tr></thead>
        <tbody>{u.onzekerheden.map((o) => (
          <tr key={o.sleutel}><td>{o.gegeven}</td><td>{o.gebruikte_waarde ?? '—'} <Badge toon="let-op">{o.verificatie}</Badge></td>
            <td>{o.soort === 'tegenstrijdigheid' ? 'inhoudelijke tegenstrijdigheid' : 'mogelijke terminologische afwijking'}; vóór publicatie besluiten</td><td className="bron">{o.bronnen.join(', ')}</td></tr>))}</tbody>
      </table></div> : <p className="bron">Geen open tegenstrijdigheden of terminologische afwijkingen.</p>}
      {u.ontbrekend.length > 0 && <p className="bron">Ontbreekt (niet aangevuld): {u.ontbrekend.join(', ')}.</p>}
    </>
  );
}

const Tegel = ({ getal, label, sub, toon }: { getal: string; label: string; sub: ReactNode; toon?: 'goed' | 'let-op' }) => (
  <div className="tegel"><span className={`fk-getal${toon ? ` fk-${toon}` : ''}`}>{getal}</span><span className="fk-label">{label}</span><span className="fk-sub">{sub}</span></div>
);

/**
 * Metingen: machinetijd, actieve gebruikerstijd en kalenderdoorlooptijd afzonderlijk. Versies van
 * vóór de tijdregistratie tonen hun opgeslagen waarden ongewijzigd, met een duidelijke markering.
 */
function Metingen({ k }: { k: Concept }) {
  const m = k.metingen;
  const nieuw = m.versie === 2 && m.actief && m.kalender;
  const a = nieuw ? m.actief!.totaal : k.tijd_achteraf;
  const kalender = nieuw ? m.kalender!.ms : m.totaal.doorloop_ms ?? null;
  return (
    <>
      <div className="tegels">
        <Tegel getal={duur(m.totaal.machine_ms)} label="machinetijd" toon={m.totaal.machine_ms <= m.totaal.ambitie_ms ? 'goed' : 'let-op'}
          sub={<>import {duur(m.aanlevering_import.import_ms)}, kwaliteitscontroles {duur(m.conceptgeneratie.kwaliteitscontroles_ms)}, generatie {duur(m.conceptgeneratie.totaal_ms)}</>} />
        <Tegel getal={a ? duur(a.ms) : '—'} label={`actieve gebruikerstijd${a && !a.betrouwbaar ? ' (indicatie)' : ''}`} toon={a?.betrouwbaar ? undefined : 'let-op'}
          sub={a ? <>{a.betrouwbaar ? 'geregistreerd' : 'niet betrouwbaar vast te stellen'}: {a.toelichting}{'afgeleid' in a ? ` (${(a as { afgeleid: string }).afgeleid})` : ''}</> : 'niet geregistreerd'} />
        <Tegel getal={duur(kalender)} label="kalenderdoorlooptijd" sub="eerste upload tot dit concept, inclusief pauzes en stilstand; geen maat voor de inzet" />
        <Tegel getal={String(m.correcties.gegevens_gecorrigeerd + m.correcties.gegevens_afgewezen + m.correcties.compositie)} label="handmatige correcties"
          sub={<>{m.correcties.gegevens_gecorrigeerd} gecorrigeerd, {m.correcties.gegevens_afgewezen} afgewezen, {m.correcties.compositie} in de compositie; {m.correcties.tegenstrijdigheden_besloten} besluit(en) over tegenstrijdigheden</>} />
        <Tegel getal={m.totaal.machine_en_actief_ms != null ? duur(m.totaal.machine_en_actief_ms) : '—'} label="tot het eerste concept (machine + actief)"
          toon={m.totaal.binnen_ambitie === true ? 'goed' : m.totaal.binnen_ambitie === false ? 'let-op' : undefined}
          sub={m.totaal.binnen_ambitie == null || !nieuw ? `ambitie ≤ ${duur(m.totaal.ambitie_ms)}: niet vast te stellen (actieve tijd niet betrouwbaar geregistreerd)` : `ambitie ≤ ${duur(m.totaal.ambitie_ms)}: ${m.totaal.binnen_ambitie ? 'gehaald' : 'niet gehaald'}`} />
      </div>
      {!nieuw && m.menselijke_controle && <p className="melding melding-let-op">Deze versie is gemaakt vóór de tijdregistratie. Opgeslagen als "menselijke controle": {duur(m.menselijke_controle.doorloop_ms)}.
        Dat is de kloktijd van de import tot de vrijgave, inclusief stilstand, en géén actieve tijd. De opgeslagen waarden zijn niet aangepast.</p>}
      <p className="bron">Stappen van de generatie: {Object.entries(m.conceptgeneratie.stappen).map(([st, ms]) => `${st} ${duur(ms)}`).join(', ')}.
        {a && <> Actieve tijd: {a.interacties} interactiemomenten en {a.handelingen} handelingen, {a.sessies} sessie(s), {a.pauzes} pauze(s) langer dan {duur(a.grens_ms)} niet meegeteld.</>}</p>
    </>
  );
}

export function ConceptScherm({ id, ik, versie }: { id: string; ik: Ik; versie?: number }) {
  useActiviteit(id, 'concept');
  const [d, setD] = useState<ConceptenOverzicht | null>(null);
  const [k, setK] = useState<Concept | null>(null);
  const [kies, setKies] = useState<string | null>(null);
  const [apparaat, setApparaat] = useState(0);
  const [fout, setFout] = useState<string | null>(null);
  const [melding, setMelding] = useState<{ toon: 'goed' | 'fout'; tekst: string } | null>(null);
  const [bezig, setBezig] = useState(false);
  const [punten, setPunten] = useState<{ onderdeel: string; tekst: string }[]>([{ onderdeel: 'algemeen', tekst: '' }]);
  const [motivering, setMotivering] = useState('');
  const fase = useBeoordeling(id);
  const rechten = useRechten(id);
  const beheer = rechten.produceren;

  const laad = useCallback(async () => {
    try { const r = await api<ConceptenOverzicht>(`/api/projecten/${id}/concepten`); setD(r); return r; }
    catch (e) { setFout((e as Error).message); return null; }
  }, [id]);
  useEffect(() => { void laad(); }, [laad]);
  // Een versie uit de adresregel (#/projecten/:id/concept/v2) gaat voor; anders de nieuwste.
  const gevraagd = versie ? d?.concepten.find((c) => c.versie === versie) : undefined;
  const gekozen = kies ?? gevraagd?.id ?? d?.concepten[0]?.id ?? null;
  useEffect(() => { if (gekozen) api<Concept>(`/api/concepten/${gekozen}`).then(setK, (e) => setFout(e.message)); else setK(null); }, [gekozen, d?.concepten.length]);
  const loopt = d?.generatie && ['wachtrij', 'bezig'].includes(d.generatie.status);
  const [nu, setNu] = useState(Date.now());
  useEffect(() => {
    if (!loopt) return;
    const t = setInterval(() => { setNu(Date.now()); }, 1000);
    const p = setInterval(async () => { const r = await laad(); if (r && !['wachtrij', 'bezig'].includes(r.generatie?.status ?? '')) { setKies(null); void fase.laad(); } }, 2000);
    return () => { clearInterval(t); clearInterval(p); };
  }, [loopt, laad]); // eslint-disable-line react-hooks/exhaustive-deps

  if (fout) return <><a className="terug" href={`#/projecten/${id}`}>← Woningproject</a><p className="melding melding-fout" role="alert">{fout}</p></>;
  if (!d) return null;

  async function doe(fn: () => Promise<unknown>, gelukt?: string) {
    setBezig(true); setMelding(null);
    try { await fn(); if (gelukt) setMelding({ toon: 'goed', tekst: gelukt }); }
    catch (e) { setMelding({ toon: 'fout', tekst: e instanceof ApiFout ? e.message : 'De studio is niet bereikbaar' }); }
    finally { setBezig(false); await laad(); }
  }
  const genereer = () => doe(() => api(`/api/projecten/${id}/concepten`, { methode: 'POST' }));
  const beoordeel = (besluit: string) => doe(async () => {
    const r = await api<Concept>(`/api/concepten/${k!.id}/beoordeling`, { methode: 'PUT', data: { besluit, motivering, verbeterpunten: punten.filter((p) => p.tekst.trim()) } });
    setK(r); setPunten([{ onderdeel: 'algemeen', tekst: '' }]); setMotivering('');
  }, besluit === 'geaccepteerd' ? 'Concept geaccepteerd. Er is niets gepubliceerd.' : 'Verbeterpunten vastgelegd. Maak na aanpassing een nieuwe conceptversie.');
  const g = d.generatie;
  const app = APPARATEN[apparaat];

  return (
    <>
      <a className="terug" href={`#/projecten/${id}`}>← {d.project.naam}</a>
      <div className="rij" style={{ alignItems: 'flex-start' }}>
        <div className="titel">
          <div className="titel-badge">Concept en preview</div>
          <h1>{d.project.naam}</h1>
          <p>{d.project.kantoor} · lokaal concept met de bestaande generator (automatische compositie, Design System {d.project.ontwerpsysteem}). Niets wordt gepubliceerd.</p>
        </div>
        {beheer && (
          <div style={{ textAlign: 'right', maxWidth: 360 }}>
            <button type="button" className="knop knop-primair" disabled={bezig || !!loopt || !d.mag_genereren.ok} onClick={() => void genereer()}>
              {loopt ? 'Concept wordt gemaakt…' : d.concepten.length ? `Nieuwe conceptversie (v${d.concepten[0].versie + 1})` : 'Genereer concept'}</button>
            {!d.mag_genereren.ok && <div className="bron">{d.mag_genereren.reden}</div>}
          </div>
        )}
      </div>
      {fase.d && <Fasebalk fasen={fase.d.fasen} projectId={id} />}
      {melding && <p className={`melding melding-${melding.toon}`} role="status" style={{ marginBottom: 16 }}>{melding.tekst}</p>}
      {loopt && g && <p className="melding melding-let-op" role="status" style={{ marginBottom: 16 }}>
        <strong>{g.status === 'wachtrij' ? 'In de wachtrij' : 'Bezig'}</strong>: exporteren, manifest maken, bouwen (automatische compositie) en de kwaliteitscontrole van Design System 1.0. {g.gestart_op ? `${duur(nu - new Date(g.gestart_op).getTime())} verstreken.` : ''} Dit duurt ongeveer een halve tot twee minuten.</p>}
      {versie && !gevraagd && <p className="melding melding-let-op" role="status" style={{ marginBottom: 16 }}>Conceptversie v{versie} bestaat niet bij deze woning.{d.concepten.length ? ' De nieuwste versie wordt getoond.' : ''}</p>}
      {g?.status === 'mislukt' && <p className="melding melding-fout" role="alert" style={{ marginBottom: 16 }}>De laatste generatie is mislukt: {g.fout}</p>}

      {!d.concepten.length ? (
        <Kaart titel="Nog geen concept">
          <p className="bron" style={{ marginTop: 0 }}>{d.mag_genereren.ok ? 'De woning is vrijgegeven. Genereer het eerste concept met de knop rechtsboven.' : <>Eerst moet de woning worden vrijgegeven: zie <a href={`#/projecten/${id}/beoordeling`}>beoordeling en vrijgave</a>.</>}</p>
        </Kaart>
      ) : <>
        <section className="kaart">
          <div className="rij">
            <div className="versies" role="tablist" aria-label="Conceptversies">{d.concepten.map((c) => (
              <button key={c.id} type="button" role="tab" aria-selected={c.id === gekozen} className={`versie${c.id === gekozen ? ' versie-actief' : ''}`} onClick={() => setKies(c.id)}>
                <strong>v{c.versie}</strong> <Badge toon={STATUS[c.status][0]}>{STATUS[c.status][1]}</Badge>
                <span className="bron">{datum(c.aangemaakt_op)} · {c.kwaliteit_kort.blokkerend} blokkerend</span></button>))}</div>
            <div className="apparaten" role="group" aria-label="Weergave">{APPARATEN.map((a, i) => (
              <button key={a.naam} type="button" className={`knop knop-klein ${i === apparaat ? 'knop-primair' : 'knop-lijn'}`} aria-pressed={i === apparaat} onClick={() => setApparaat(i)}>{a.naam}</button>))}
              {k && <a className="knop knop-lijn knop-klein" href={`/api/voorbeeld/${k.voorbeeld_token}/`} target="_blank" rel="noreferrer noopener" style={{ textDecoration: 'none' }}>Openen in nieuw tabblad</a>}</div>
          </div>
          {k && <Voorbeeld key={`${k.id}-${apparaat}`} token={k.voorbeeld_token} breedte={app.breedte} hoogte={app.hoogte} />}
        </section>

        {k && <div className="raster raster-2">
          <section className="kaart">
            <h2>Beoordeling van v{k.versie}</h2>
            <p><Badge toon={STATUS[k.status][0]}>{STATUS[k.status][1]}</Badge> {k.beoordeeld_op ? `· ${datum(k.beoordeeld_op)}${k.beoordeeld_door_naam ? ` door ${k.beoordeeld_door_naam}` : ''}` : ''}{k.motivering ? ` · ${k.motivering}` : ''}</p>
            {k.verbeterpunten.length > 0 && <ul className="checklist">{k.verbeterpunten.map((p, i) => <li key={i} className="open"><span className="vink">!</span><span><strong>{p.onderdeel}</strong> {p.tekst} <span className="bron">({datum(p.op)})</span></span></li>)}</ul>}
            {rechten.kantoorbeheer && <>
              <h3 className="tussenkop">Verbeterpunten vastleggen</h3>
              {punten.map((p, i) => (
                <div key={i} className="inline-form" style={{ marginBottom: 6 }}>
                  <select aria-label="Onderdeel" value={p.onderdeel} onChange={(e) => setPunten(punten.map((x, j) => (j === i ? { ...x, onderdeel: e.target.value } : x)))}>{ONDERDELEN.map((o) => <option key={o}>{o}</option>)}</select>
                  <input aria-label="Verbeterpunt" placeholder="Wat moet er beter?" value={p.tekst} onChange={(e) => setPunten(punten.map((x, j) => (j === i ? { ...x, tekst: e.target.value } : x)))} />
                </div>))}
              <button type="button" className="tekstknop" onClick={() => setPunten([...punten, { onderdeel: 'algemeen', tekst: '' }])}>+ Nog een verbeterpunt</button>
              <div className="inline-form" style={{ marginTop: 10 }}>
                <input aria-label="Toelichting" placeholder="Toelichting (optioneel)" value={motivering} onChange={(e) => setMotivering(e.target.value)} />
              </div>
              <div className="knoppen" style={{ marginTop: 10 }}>
                <button type="button" className="knop knop-lijn" disabled={bezig || !punten.some((p) => p.tekst.trim().length >= 3)} onClick={() => void beoordeel('verbeterpunten')}>Verbeterpunten vastleggen</button>
                <button type="button" className="knop knop-primair" disabled={bezig || k.status === 'geaccepteerd'} onClick={() => void beoordeel('geaccepteerd')}>Concept accepteren</button>
              </div>
              <p className="bron">Accepteren betekent: dit is een goed eerste concept. Het is geen publicatie.</p>
            </>}
          </section>
          <section className="kaart">
            <h2>Versie-informatie</h2>
            <table className="tabel"><tbody>
              <tr><td>Gemaakt</td><td>{datum(k.aangemaakt_op)}{k.aangemaakt_door_naam ? ` door ${k.aangemaakt_door_naam}` : ''}</td></tr>
              <tr><td>Ontwerpsysteem</td><td>{k.bouw.ontwerpsysteem.versie} ({k.bouw.ontwerpsysteem.status})</td></tr>
              <tr><td>Profiel</td><td>{k.profiel}{k.bouw.lettertypepaar ? ` · ${k.bouw.lettertypepaar}` : ''}</td></tr>
              <tr><td>Compositie</td><td>{k.bouw.rapport.modus} ({k.bouw.onderdelen.length} delen)</td></tr>
              <tr><td>Generator</td><td className="mono">{k.generator_commit.slice(0, 7)}</td></tr>
              <tr><td>Vingerafdruk</td><td className="mono">{k.build_vingerafdruk.slice(0, 16)}…</td></tr>
              <tr><td>Invoer</td><td className="mono">{k.invoer_vingerafdruk.slice(0, 16)}…{fase.d && fase.d.vingerafdruk !== k.invoer_vingerafdruk ? <> <Badge toon="let-op">gegevens sindsdien gewijzigd</Badge></> : null}</td></tr>
            </tbody></table>
          </section>
        </div>}

        {k && <section className="kaart"><h2>Uitgangspunten van v{k.versie}</h2><Uitgangspunten k={k} /></section>}
        {k && <section className="kaart"><h2>Kwaliteitsrapport v{k.versie}</h2><Kwaliteit k={k} /></section>}
        {k && <section className="kaart"><h2>Metingen</h2><Metingen k={k} /></section>}
      </>}
    </>
  );
}
