// Beoordeling: broncontrole, kwaliteitscontrole en vrijgave voor conceptgeneratie (stap 5).
// Vier fasen: aanlevering → broncontrole → kwaliteitscontrole → vrijgave. Vrijgave betekent alleen
// "gereed voor een eerste concept"; er wordt hier niets gegenereerd of gepubliceerd.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiFout, type Beoordeling as Data, type Ik, type ProjectCatalogus } from './api.ts';
import { Badge, Kaart, type Toon } from './onderdelen/basis.tsx';
import { GegevenRij } from './Aanlevering.tsx';
import { Meldingenoverzicht } from './onderdelen/Meldingen.tsx';
import { useActiviteit } from './onderdelen/activiteit.ts';
import { useRechten } from './onderdelen/rechten.ts';

const FASE_TOON: Record<string, Toon> = { gereed: 'goed', open: 'let-op', wacht: 'info' };
const FASE_TEKST: Record<string, string> = { gereed: 'gereed', open: 'actie nodig', wacht: 'wacht op vorige fase' };
const datum = (s?: string) => (s ? new Date(s).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const toon = (w: unknown, e?: string | null) => (w == null ? '—' : `${typeof w === 'number' ? w.toLocaleString('nl-NL') : String(w)}${e ? ` ${e}` : ''}`);

/** De vier fasen, ook bruikbaar op het aanleverscherm. */
export function Fasebalk({ fasen, projectId, actief }: { fasen: Data['fasen']; projectId: string; actief?: number }) {
  return (
    <ol className="fasebalk" aria-label="Fasen van de beoordeling">
      {fasen.map((f) => (
        <li key={f.nr} className={`fase fase-${f.status}${actief === f.nr ? ' fase-actief' : ''}`}>
          <a href={f.nr === 1 ? `#/projecten/${projectId}/aanlevering` : `#/projecten/${projectId}/beoordeling`}
            onClick={(e) => { const el = f.nr > 1 && document.getElementById(`fase-${f.nr}`); if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth' }); } }}>
            <span className="fase-nr">{f.status === 'gereed' ? '✓' : f.nr}</span>
            <span className="fase-tekst"><span className="fase-naam">{f.naam}</span>
              <Badge toon={FASE_TOON[f.status]}>{f.status === 'open' && f.open ? `${f.open} open` : FASE_TEKST[f.status]}</Badge></span>
          </a>
        </li>
      ))}
    </ol>
  );
}

export function useBeoordeling(id: string) {
  const [d, setD] = useState<Data | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const laad = useCallback(() => api<Data>(`/api/projecten/${id}/beoordeling`).then(setD, (e) => setFout(e.message)), [id]);
  useEffect(() => { void laad(); }, [laad]);
  return { d, setD, fout, laad };
}

function Tegel({ getal, label, toon: t }: { getal: ReactNode; label: string; toon?: 'goed' | 'let-op' }) {
  return <div className="tegel"><span className={`fk-getal${t === 'goed' ? ' fk-goed' : t === 'let-op' ? ' fk-let-op' : ''}`}>{getal}</span><span className="fk-label">{label}</span></div>;
}

/**
 * Snelle beoordeling: de bron overnemen als uitgangspunt (geen inhoudelijke bevestiging), de
 * verplichte keuzes met de voorstellen van de import, de kwaliteitscontrole en de vrijgave in één
 * handeling. De uitgebreide beoordeling hieronder blijft beschikbaar.
 */
function SnelleBeoordeling({ d, profielen, bezig, voerUit }: { d: Data; profielen: ProjectCatalogus['profielen']; bezig: boolean; voerUit: (data: Record<string, unknown>) => void }) {
  const b = d.beslissingen;
  const [v, setV] = useState<Record<string, string>>({ profiel: b.profiel_voorstel?.waarde ?? '', openingsbeeld: b.openingsbeeld_voorstel ?? '' });
  const [akkoord, setAkkoord] = useState(false);
  const zet = (k: string) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const ok = (code: string) => d.checklist.find((x) => x.code === code)?.ok;
  const open = d.broncontrole.te_beoordelen.filter((g) => g.signalen.includes('tegenstrijdigheid') || g.signalen.includes('terminologie'));
  const nodig = { rechten: !b.rechten?.bevestigd, profiel: !b.profiel, adres: !b.domein && !b.conceptadres, beeld: !ok('openingsbeeld'), foto: b.fotokwaliteit.nodig && !b.fotokwaliteit.akkoord };
  // Publicatierechten zijn voor het interne concept optioneel (vóór publicatie verplicht); een ingevulde toelichting telt wel.
  const kan = akkoord && (!(v.rechten ?? '').trim() || (v.rechten ?? '').trim().length >= 3) && (!nodig.profiel || !!v.profiel)
    && (!nodig.beeld || !!v.openingsbeeld);
  return (
    <section className="kaart snel">
      <h2>Snelle beoordeling</h2>
      <p className="bron" style={{ marginTop: 0 }}>Neem de broninformatie in één keer over als uitgangspunt en laat de studio de kwaliteitscontrole uitvoeren en vrijgeven.
        <strong> Overnemen is geen inhoudelijke bevestiging:</strong> de gegevens blijven 'overgenomen' en gaan als onbevestigd mee in het concept. Wilt u gegevens afzonderlijk controleren,
        corrigeren of afwijzen, gebruik dan de uitgebreide beoordeling hieronder.</p>
      {d.bronovername.verouderd && <p className="melding melding-let-op">Er is een eerdere overname, maar die hoort bij een oudere bronversie (voor een nieuwe import). Bevestig opnieuw.</p>}
      <label className="snel-verklaring"><input type="checkbox" checked={akkoord} onChange={(e) => setAkkoord(e.target.checked)} />{d.bronovername.verklaring}</label>
      <p className="bron">Bronversie: brochure-PDF, import {d.bronovername.bron?.volgnummer}, sha256 <span className="mono">{(d.bronovername.bron?.sha256 ?? '').slice(0, 12)}</span> · {d.broncontrole.telling.overgenomen} gegevens nog niet afzonderlijk gecontroleerd.
        {open.length > 0 && <> Open punten blijven zichtbaar en zijn vóór publicatie verplicht: {open.map((g) => `${g.label} (gebruikt: ${String(g.vastgelegd?.waarde ?? '—')})`).join('; ')}.</>}</p>
      <div className="snel-velden">
        {nodig.rechten && <div className="veld"><label htmlFor="snel-rechten">Publicatierechten (optioneel; verplicht vóór publicatie): waarop berust de toestemming?</label>
          <input id="snel-rechten" placeholder="Bijvoorbeeld: bevestigd door de makelaar per mail" value={v.rechten ?? ''} onChange={zet('rechten')} /></div>}
        {nodig.profiel && <div className="veld"><label htmlFor="snel-profiel">Presentatieprofiel</label>
          <select id="snel-profiel" value={v.profiel} onChange={zet('profiel')}><option value="">Kies een profiel</option>
            {profielen.map((p) => <option key={p.naam} value={p.naam}>{p.naam}{b.profiel_voorstel?.waarde === p.naam ? ' (voorstel)' : ''}</option>)}</select></div>}
        {nodig.adres && <div className="veld"><label htmlFor="snel-domein">Websiteadres (optioneel)</label>
          <input id="snel-domein" placeholder={`leeg = tijdelijk conceptadres ${d.project.slug}.invalid`} value={v.domein ?? ''} onChange={zet('domein')} /></div>}
        {nodig.beeld && <div className="veld"><label htmlFor="snel-beeld">Openingsbeeld</label>
          <select id="snel-beeld" value={v.openingsbeeld} onChange={zet('openingsbeeld')}><option value="">Kies een foto</option>
            {b.openingsbeeld_kandidaten.map((f) => <option key={f.id} value={f.id}>{f.herkomst === 'brochure' ? `brochure p. ${f.pagina}` : 'losse foto'}, {f.breedte}×{f.hoogte}{b.openingsbeeld_voorstel === f.id ? ' (voorstel)' : ''}</option>)}</select></div>}
        {nodig.foto && <div className="veld"><label htmlFor="snel-foto">Fotokwaliteit (aanbevolen, optioneel): originelen ontbreken; waarom mag het eerste concept hiermee?</label>
          <input id="snel-foto" placeholder="Bijvoorbeeld: brochurebeelden; originelen opgevraagd" value={v.foto ?? ''} onChange={zet('foto')} /></div>}
      </div>
      <button type="button" className="knop knop-primair" disabled={bezig || !kan}
        onClick={() => voerUit({ overnemen: true, rechten: v.rechten, profiel: v.profiel, domein: v.domein, openingsbeeld: v.openingsbeeld, fotokwaliteit: v.foto })}>
        Overnemen, controleren en vrijgeven</button>
      <p className="bron">Elke stap komt afzonderlijk in het besluitenlog, met wie, wanneer en welke bronversie. Er wordt niets gegenereerd of gepubliceerd.</p>
    </section>
  );
}

export function BeoordelingScherm({ id, ik }: { id: string; ik: Ik }) {
  useActiviteit(id, 'beoordeling');
  const { d, setD, fout, laad } = useBeoordeling(id);
  const [melding, setMelding] = useState<{ toon: 'goed' | 'fout'; tekst: string } | null>(null);
  const [bezig, setBezig] = useState(false);
  const [profielen, setProfielen] = useState<ProjectCatalogus['profielen']>([]);
  const [veld, setVeld] = useState<Record<string, string>>({});
  const rechten = useRechten(id);
  const beheer = rechten.produceren;
  useEffect(() => { api<ProjectCatalogus>('/api/catalogus/project').then((k) => setProfielen(k.profielen)); }, []);

  if (fout) return <><a className="terug" href={`#/projecten/${id}`}>← Woningproject</a><p className="melding melding-fout" role="alert">{fout}</p></>;
  if (!d) return null;

  const zet = (k: string) => (e: { target: { value: string } }) => setVeld({ ...veld, [k]: e.target.value });
  async function doe(fn: () => Promise<unknown>, gelukt?: string) {
    setBezig(true); setMelding(null);
    try { const r = await fn(); if (r && typeof r === 'object' && 'fasen' in r) setD(r as Data); else await laad(); if (gelukt) setMelding({ toon: 'goed', tekst: gelukt }); }
    catch (e) { setMelding({ toon: 'fout', tekst: e instanceof ApiFout ? e.message : 'De studio is niet bereikbaar' }); await laad(); }
    finally { setBezig(false); }
  }
  const beslis = (onderwerp: string, data: object, gelukt: string) => doe(() => api(`/api/projecten/${id}/beslissingen/${onderwerp}`, { methode: 'PUT', data }), gelukt);
  const bewerk = async (sleutel: string, data: object) => {
    try { await api(`/api/projecten/${id}/gegevens/${sleutel}`, { methode: 'PUT', data }); await laad(); return null; }
    catch (e) { return e instanceof ApiFout ? e.message : 'De studio is niet bereikbaar'; }
  };
  const t = d.broncontrole.telling;
  const b = d.beslissingen;
  const kc = d.kwaliteit;
  const per = (fase: number) => d.checklist.filter((x) => x.fase === fase);
  const Punten = ({ fase }: { fase: number }) => (
    <ul className="checklist">{per(fase).map((x) => (
      <li key={x.code} className={x.ok ? 'ok' : x.verplicht ? 'open' : 'aanbevolen'}><span className="vink" aria-hidden="true">{x.ok ? '✓' : x.verplicht ? '!' : 'i'}</span>
        <span><strong>{x.titel}</strong>{!x.ok && !x.verplicht && <span className="bron"> (aanbevolen; blokkeert de conceptgeneratie niet)</span>}{x.actie && <span className="checklist-actie"> {x.actie}</span>}</span></li>))}</ul>
  );

  return (
    <>
      <a className="terug" href={`#/projecten/${id}`}>← {d.project.naam}</a>
      <div className="titel">
        <div className="titel-badge">Beoordeling</div>
        <h1>{d.project.naam}</h1>
        <p>{d.project.kantoor} · broncontrole, kwaliteitscontrole en vrijgave voor een eerste concept. Er wordt hier niets gegenereerd of gepubliceerd.</p>
      </div>
      <Fasebalk fasen={d.fasen} projectId={id} />
      {melding && <p className={`melding melding-${melding.toon}`} role="status" style={{ marginBottom: 16 }}>{melding.tekst}</p>}

      {beheer && !d.vrijgave.vrijgegeven && <SnelleBeoordeling d={d} profielen={profielen} bezig={bezig} voerUit={(data) => doe(async () => {
        const r = await api<{ beoordeling: Data; gedaan: string[]; open: { titel: string }[] }>(`/api/projecten/${id}/snelle-beoordeling`, { methode: 'POST', data });
        setD(r.beoordeling);
        setMelding({ toon: r.open.length ? 'fout' : 'goed', tekst: `${r.gedaan.length ? `Uitgevoerd: ${r.gedaan.join(', ')}.` : 'Niets te doen.'}${r.open.length ? ` Nog open: ${r.open.map((o) => o.titel).join('; ')}.` : ''}` });
        return r.beoordeling;
      })} />}

      {/* ── Vrijgave (overzicht bovenaan: wat moet er nog gebeuren?) ── */}
      <section className={`kaart vrijgave vrijgave-${d.vrijgave.vrijgegeven ? 'gereed' : d.klaar ? 'klaar' : 'niet'}`} id="fase-4">
        <h2>4. Vrijgave voor conceptgeneratie</h2>
        {d.vrijgave.vrijgegeven ? (
          <p className="vrijgave-status"><Badge toon="goed">vrijgegeven</Badge> op {datum(d.vrijgave.op)}{d.vrijgave.motivering ? ` · ${d.vrijgave.motivering}` : ''}. De woning is gereed voor een eerste concept. Dit is geen toestemming voor publicatie.
            {' '}<a href={`#/projecten/${id}/concept`}>Naar concept en preview →</a></p>
        ) : d.klaar ? (
          <p className="vrijgave-status"><Badge toon="let-op">gereed om vrij te geven</Badge> Alle verplichte controles zijn afgerond.</p>
        ) : (
          <p className="vrijgave-status"><Badge toon="fout">nog niet gereed</Badge> {d.checklist.filter((x) => !x.ok && x.verplicht).length} verplichte controle(s) open. Hieronder staat per punt wat er nog moet gebeuren.</p>
        )}
        {d.vrijgave.vervallen_op && !d.vrijgave.vrijgegeven && <p className="bron">Een eerdere vrijgave is vervallen op {datum(d.vrijgave.vervallen_op)} ({d.vrijgave.vervallen_door}).</p>}
        {!d.vrijgave.vrijgegeven && d.checklist.some((x) => !x.ok && x.verplicht) && (
          <ul className="checklist">{d.checklist.filter((x) => !x.ok && x.verplicht).map((x) => (
            <li key={x.code} className="open"><span className="vink" aria-hidden="true">!</span><span><strong>{x.titel}</strong> <span className="checklist-actie">{x.actie}</span>
              <span className="bron"> (fase {x.fase})</span></span></li>))}</ul>
        )}
        {d.checklist.some((x) => !x.ok && !x.verplicht) && <p className="bron">Open aandachtspunten (blokkeren niet, blijven zichtbaar): {d.checklist.filter((x) => !x.ok && !x.verplicht).map((x) => x.titel.toLowerCase()).join('; ')}. Publicatie kent afzonderlijke, strengere controles.</p>}
        {beheer && (d.vrijgave.vrijgegeven ? (
          <div className="inline-form" style={{ marginTop: 10 }}>
            <input aria-label="Reden voor intrekken" placeholder="Reden voor intrekken (verplicht)" value={veld.intrekken ?? ''} onChange={zet('intrekken')} />
            <button className="knop knop-lijn" type="button" disabled={bezig || (veld.intrekken ?? '').trim().length < 3}
              onClick={() => beslis('intrekken', { motivering: veld.intrekken }, 'Vrijgave ingetrokken.')}>Vrijgave intrekken</button>
          </div>
        ) : (
          <div className="inline-form" style={{ marginTop: 10 }}>
            <input aria-label="Toelichting bij de vrijgave" placeholder="Toelichting (optioneel)" value={veld.vrijgave ?? ''} onChange={zet('vrijgave')} disabled={!d.klaar} />
            <button className="knop knop-primair" type="button" disabled={bezig || !d.klaar}
              onClick={() => beslis('vrijgave', { motivering: veld.vrijgave }, 'Vrijgegeven voor conceptgeneratie. Er is niets gegenereerd of gepubliceerd.')}>Vrijgeven voor conceptgeneratie</button>
          </div>
        ))}
      </section>

      {/* ── Fase 2: broncontrole ── */}
      <section className="kaart" id="fase-2">
        <h2>2. Broncontrole</h2>
        <div className="tegels">
          <Tegel getal={t.overgenomen} label={d.bronovername.geldig ? 'overgenomen als uitgangspunt, niet afzonderlijk gecontroleerd' : 'overgenomen, nog te controleren'} toon={t.overgenomen && !d.bronovername.geldig ? 'let-op' : t.overgenomen ? undefined : 'goed'} />
          <Tegel getal={t.gecontroleerd} label="gecontroleerd (gelijk aan de brochure)" />
          <Tegel getal={t.gecorrigeerd} label="gecorrigeerd of aangevuld" />
          <Tegel getal={t.afgewezen} label="afgewezen" />
          <Tegel getal={`${t.opgelost}/${t.tegenstrijdig}`} label="tegenstrijdigheden opgelost" toon={t.opgelost === t.tegenstrijdig ? 'goed' : 'let-op'} />
          <Tegel getal={t.ontbrekend} label="ontbreekt" toon={t.ontbrekend ? 'let-op' : undefined} />
        </div>
        <Punten fase={2} />
        {d.bronovername.besluit && d.bronovername.geldig && <p className="bron">Bron overgenomen als uitgangspunt op {datum(d.bronovername.besluit.op)}{d.bronovername.besluit.door ? ` door ${d.bronovername.besluit.door}` : ''}
          {' '}(bronversie: brochure-PDF, import {d.bronovername.besluit.waarde.volgnummer}, sha256 <span className="mono">{(d.bronovername.besluit.waarde.sha256 ?? '').slice(0, 12)}</span>).
          Dit is geen individuele verificatie van de feiten.
          {beheer && <> <button type="button" className="tekstknop" disabled={bezig} onClick={() => beslis('bronovername', { bevestigd: false }, 'Overname ingetrokken.')}>Overname intrekken</button></>}</p>}
        {d.broncontrole.te_beoordelen.length > 0 ? <>
          <h3 className="tussenkop">Te beoordelen ({d.broncontrole.te_beoordelen.length})</h3>
          <p className="bron" style={{ marginTop: 0 }}>Gegevens met een waarschuwing worden afzonderlijk beoordeeld; de rest kan in één handeling worden goedgekeurd.</p>
          {beheer && d.broncontrole.te_beoordelen.some((g) => g.bulk) && <button type="button" className="knop knop-lijn" style={{ marginBottom: 8 }} disabled={bezig}
            onClick={() => doe(async () => { const r = await api<{ goedgekeurd: number }>(`/api/projecten/${id}/gegevens/bulkgoedkeuring`, { methode: 'POST' }); setMelding({ toon: 'goed', tekst: `${r.goedgekeurd} gegevens zonder melding goedgekeurd.` }); })}>
            Gegevens zonder melding goedkeuren ({d.broncontrole.te_beoordelen.filter((g) => g.bulk).length})</button>}
          <div className="tabel-schuif"><table className="tabel gegevenstabel">
            <thead><tr><th>Gegeven</th><th>Brochure</th><th>Vastgelegd</th>{beheer && <th>Handeling</th>}</tr></thead>
            <tbody>{d.broncontrole.te_beoordelen.map((g) => <GegevenRij key={g.sleutel} g={g} beheer={beheer} bewerk={bewerk} />)}</tbody>
          </table></div>
        </> : <p className="melding melding-goed" style={{ marginTop: 12 }}>Alle gegevens zijn beoordeeld.</p>}
        <details className="uitklap"><summary>Vastgesteld ({d.broncontrole.vastgesteld.length}): hoeft niet opnieuw beoordeeld te worden</summary>
          <div className="tabel-schuif"><table className="lijst" style={{ marginTop: 8 }}>
            <thead><tr><th>Gegeven</th><th>Waarde</th><th>Status</th><th>Bron of besluit</th></tr></thead>
            <tbody>{d.broncontrole.vastgesteld.map((g) => (
              <tr key={g.sleutel}><td>{g.label}</td><td>{toon(g.vastgelegd?.waarde, g.vastgelegd?.eenheid)}</td>
                <td>{g.vastgelegd ? <Badge toon={g.vastgelegd.status === 'afgewezen' ? 'fout' : 'goed'}>{g.vastgelegd.status === 'afgewezen' ? 'afgewezen' : g.vastgelegd.besluit ? 'besloten' : g.vastgelegd.herkomst === 'handmatig' ? 'gecorrigeerd' : 'gecontroleerd'}</Badge> : <Badge toon="let-op">ontbreekt</Badge>}</td>
                <td className="bron">{g.vastgelegd?.besluit ? `Besluit: ${g.vastgelegd.besluit.motivering}` : g.vastgelegd?.bron ?? '—'}</td></tr>))}</tbody>
          </table></div>
        </details>
      </section>

      {/* ── Fase 3: kwaliteitscontrole ── */}
      <section className="kaart" id="fase-3">
        <div className="rij">
          <h2 style={{ margin: 0 }}>3. Kwaliteitscontrole</h2>
          {beheer && <button type="button" className={`knop ${kc?.actueel ? 'knop-lijn' : 'knop-primair'}`} disabled={bezig}
            onClick={() => doe(() => api(`/api/projecten/${id}/kwaliteitscontrole`, { methode: 'POST' }), 'Kwaliteitscontrole uitgevoerd.')}>
            {kc ? 'Kwaliteitscontrole opnieuw uitvoeren' : 'Kwaliteitscontrole uitvoeren'}</button>}
        </div>
        <p className="bron">Bestaande controles van de generator op de vastgelegde gegevens: aanleveringscontrole, manifestschema, feitencontrole en taalcontrole, plus de fotokwaliteit.
          {kc ? <> Laatst uitgevoerd {datum(kc.klaar_op)} ({(kc.duur_ms / 1000).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} s, generator {kc.generator_commit.slice(0, 7)}). {kc.actueel ? <Badge toon="goed">actueel</Badge> : <Badge toon="let-op">verouderd: er is sindsdien iets gewijzigd</Badge>}</> : ' Nog niet uitgevoerd.'}</p>
        <Punten fase={3} />

        <h3 className="tussenkop">Beslissingen</h3>
        <div className="beslissingen">
          <div className="beslissing">
            <div className="beslissing-kop">Publicatierechten {b.rechten?.bevestigd ? <Badge toon="goed">bevestigd</Badge> : <Badge toon="let-op">vóór publicatie</Badge>}</div>
            {b.rechten?.bevestigd ? <p className="bron">{b.rechten.toelichting} · {datum(b.rechten.op)}</p> : <p className="bron">Mogen de foto's en teksten gepubliceerd worden? Vermeld waarop dat berust. Blokkeert het interne concept niet; verplicht vóór publicatie.</p>}
            {beheer && (b.rechten?.bevestigd
              ? <button type="button" className="tekstknop" disabled={bezig} onClick={() => beslis('rechten', { bevestigd: false }, 'Bevestiging ingetrokken.')}>Bevestiging intrekken</button>
              : <div className="inline-form"><input aria-label="Toelichting publicatierechten" placeholder="Bijvoorbeeld: bevestigd door de makelaar per mail" value={veld.rechten ?? ''} onChange={zet('rechten')} />
                <button type="button" className="knop knop-primair knop-klein" disabled={bezig || (veld.rechten ?? '').trim().length < 3} onClick={() => beslis('rechten', { bevestigd: true, motivering: veld.rechten }, 'Publicatierechten bevestigd.')}>Bevestigen</button></div>)}
          </div>
          <div className="beslissing">
            <div className="beslissing-kop">Presentatieprofiel {b.profiel ? <Badge toon="goed">{b.profiel}</Badge> : <Badge toon="fout">open</Badge>}</div>
            {b.profiel_voorstel && <p className="bron">Voorstel uit de brochure: <strong>{b.profiel_voorstel.waarde}</strong> ({b.profiel_voorstel.toelichting.replace(/^regel: /, '')})</p>}
            {beheer && <div className="inline-form"><select aria-label="Presentatieprofiel" value={veld.profiel ?? b.profiel ?? ''} onChange={zet('profiel')}>
              <option value="">Kies een profiel</option>{profielen.map((p) => <option key={p.naam} value={p.naam}>{p.naam}{b.profiel_voorstel?.waarde === p.naam ? ' (voorstel)' : ''}</option>)}</select>
              <button type="button" className="knop knop-lijn knop-klein" disabled={bezig || !(veld.profiel ?? b.profiel) || (veld.profiel ?? b.profiel) === b.profiel}
                onClick={() => beslis('profiel', { profiel: veld.profiel }, `Profiel '${veld.profiel}' gekozen.`)}>Kiezen</button></div>}
          </div>
          <div className="beslissing">
            <div className="beslissing-kop">Websiteadres {b.domein ? <Badge toon="goed">{b.domein}</Badge> : b.conceptadres ? <Badge toon="goed">tijdelijk conceptadres</Badge> : <Badge toon="fout">open</Badge>}</div>
            <p className="bron">{b.conceptadres && !b.domein ? `Het concept krijgt het tijdelijke adres ${d.project.slug}.invalid; het echte domein volgt vóór publicatie.` : 'Het domein van de woningwebsite, of een tijdelijk adres voor het concept.'}</p>
            {beheer && <div className="inline-form">{rechten.kantoorbeheer && <><input aria-label="Domein" placeholder="voorbeeldweg1.nl" value={veld.domein ?? ''} onChange={zet('domein')} />
              <button type="button" className="knop knop-lijn knop-klein" disabled={bezig || !(veld.domein ?? '').trim()} onClick={() => beslis('websiteadres', { domein: veld.domein }, 'Domein vastgelegd.')}>Vastleggen</button></>}
              {!b.domein && !b.conceptadres && <button type="button" className="knop knop-lijn knop-klein" disabled={bezig} onClick={() => beslis('websiteadres', { conceptadres: true }, 'Tijdelijk conceptadres gekozen.')}>Tijdelijk conceptadres</button>}</div>}
          </div>
          <div className="beslissing beslissing-breed">
            <div className="beslissing-kop">Openingsbeeld {b.openingsbeeld ? <Badge toon="goed">gekozen</Badge> : <Badge toon="fout">open</Badge>}</div>
            <p className="bron">Liggende foto van minimaal {b.openingsbeeld_norm} px breed. {b.openingsbeeld_kandidaten.length} geschikt.</p>
            <div className="openingsbeelden">{b.openingsbeeld_kandidaten.map((f) => (
              <figure key={f.id} className={`foto${b.openingsbeeld?.id === f.id ? ' foto-gekozen' : ''}`}>
                <img src={`/api/bestanden/${f.id}/miniatuur`} alt={f.herkomst === 'brochure' ? `Brochurefoto pagina ${f.pagina}` : 'Losse foto'} loading="lazy" />
                <figcaption><div className="chips"><span className="chip">{f.herkomst === 'brochure' ? `brochure p. ${f.pagina}` : 'losse foto'}</span><span className="chip">{f.breedte}×{f.hoogte}</span>
                  {b.openingsbeeld_voorstel === f.id && <span className="chip">voorstel import</span>}</div>
                  {beheer && b.openingsbeeld?.id !== f.id && <button type="button" className="tekstknop" disabled={bezig} onClick={() => beslis('openingsbeeld', { bestand_id: f.id }, 'Openingsbeeld gekozen.')}>Als openingsbeeld kiezen</button>}
                  {b.openingsbeeld?.id === f.id && <div className="bron"><strong>Gekozen</strong></div>}</figcaption>
              </figure>))}</div>
          </div>
          <div className="beslissing beslissing-breed">
            <div className="beslissing-kop">Fotokwaliteit {!b.fotokwaliteit.nodig ? <Badge toon="goed">in orde</Badge> : b.fotokwaliteit.akkoord ? <Badge toon="goed">geaccepteerd voor eerste concept</Badge> : <Badge toon="fout">beslissing nodig</Badge>}</div>
            <div className="tegels">
              <Tegel getal={`${d.fotokwaliteit.geschikt}/${d.fotokwaliteit.in_gebruik}`} label={`geschikt voor publicatie (≥ ${d.fotokwaliteit.norm.goed} px)`} toon={d.fotokwaliteit.onvoldoende ? 'let-op' : 'goed'} />
              <Tegel getal={d.fotokwaliteit.onvoldoende} label="onvoldoende resolutie" toon={d.fotokwaliteit.onvoldoende ? 'let-op' : undefined} />
              <Tegel getal={d.fotokwaliteit.originelen_nodig} label="originele foto's nog aan te leveren" toon={d.fotokwaliteit.originelen_nodig ? 'let-op' : undefined} />
            </div>
            {b.fotokwaliteit.besluit && <p className="bron">Besluit {datum(b.fotokwaliteit.besluit.op)} door {b.fotokwaliteit.besluit.door}: {b.fotokwaliteit.besluit.motivering}</p>}
            {beheer && b.fotokwaliteit.nodig && !b.fotokwaliteit.akkoord && <div className="inline-form">
              <input aria-label="Motivering fotokwaliteit" placeholder="Bijvoorbeeld: eerste concept met brochurebeelden; originelen opgevraagd" value={veld.foto ?? ''} onChange={zet('foto')} />
              <button type="button" className="knop knop-primair knop-klein" disabled={bezig || (veld.foto ?? '').trim().length < 3}
                onClick={() => beslis('fotokwaliteit', { motivering: veld.foto }, 'Fotokwaliteit geaccepteerd voor het eerste concept.')}>Accepteren voor eerste concept</button></div>}
          </div>
        </div>

        <h3 className="tussenkop">Kwaliteitsrapport</h3>
        {!kc ? <p className="bron">Voer de kwaliteitscontrole uit om het rapport te zien.</p> : <Meldingenoverzicht indeling={kc.indeling} />}
        {kc && kc.taal.length > 0 && <details className="uitklap"><summary>Meetwaarden taalcontrole</summary>
          <table className="lijst" style={{ marginTop: 8 }}><thead><tr><th>Criterium</th><th>Waarde</th><th>Norm</th><th></th></tr></thead>
            <tbody>{kc.taal.map((m) => <tr key={m.criterium}><td>{m.criterium}</td><td>{String(m.waarde)}</td><td>{m.norm}</td><td>{m.ok ? <Badge toon="goed">binnen norm</Badge> : <Badge toon="let-op">buiten norm</Badge>}</td></tr>)}</tbody></table></details>}
      </section>

      {/* ── Besluitenlog ── */}
      <section className="kaart">
        <h2>Besluitenlog</h2>
        <p className="bron" style={{ marginTop: 0 }}>Elke menselijke beslissing: wie, wanneer, wat en waarom. Het log wordt alleen aangevuld, nooit gewijzigd.</p>
        {d.besluiten.length ? <div className="tabel-schuif"><table className="lijst">
          <thead><tr><th>Wanneer</th><th>Wie</th><th>Onderwerp</th><th>Besluit</th><th>Motivering</th></tr></thead>
          <tbody>{d.besluiten.map((x) => (
            <tr key={x.id}><td>{datum(x.op)}</td><td>{x.door ?? '—'}</td><td>{x.onderwerp}</td>
              <td>{x.handeling}{x.waarde && typeof x.waarde === 'object' && 'waarde' in (x.waarde as object) ? `: ${toon((x.waarde as { waarde: unknown; eenheid?: string }).waarde, (x.waarde as { eenheid?: string }).eenheid)}` : ''}</td>
              <td>{x.motivering ?? '—'}</td></tr>))}</tbody>
        </table></div> : <p className="bron">Nog geen besluiten.</p>}
      </section>
    </>
  );
}
