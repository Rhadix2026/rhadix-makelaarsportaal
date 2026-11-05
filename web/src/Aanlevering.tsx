// Aanleverscherm: brochure en losse foto's aanleveren, de brochure-import starten, de gegevens
// controleren (brochure → automatisch overgenomen → goedgekeurd) en de aanlevering opslaan.
// Een website wordt hier nooit gegenereerd.
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { api, ApiFout, upload, type Aanlevering as Data, type Bestand, type Ik } from './api.ts';
import { Badge, Kaart } from './onderdelen/basis.tsx';

const CATEGORIE: Record<string, string> = { exterieur: 'Buitenzijde', entree: 'Entree', woonkamer: 'Woonkamer', keuken: 'Keuken', slaapkamer: 'Slaapkamer',
  werkkamer: 'Werkkamer', badkamer: 'Sanitair', buitenruimte: 'Buitenruimte', omgeving: 'Omgeving', overig: 'Overig' };
const SOORT_BEELD: Record<string, string> = { foto: "foto's", plattegrond: 'plattegronden', logo: 'logo', 'logo-klein': 'kleine logo\'s', partnerlogo: 'partnerlogo\'s',
  dubbel: 'dubbel in de PDF', kadaster: 'kadasterkaart', kaart: 'kaart', uitgesloten: 'uitgesloten', achtergrond: 'achtergrond', qr: 'QR-code', tekening: 'tekening', decor: 'decor' };

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 10 * 1024 * 1024 ? 0 : 1)} MB`;
const sec = (ms?: number | null) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);
const toon = (w: unknown, eenheid?: string | null) => (w == null ? '—' : `${typeof w === 'number' ? w.toLocaleString('nl-NL') : String(w)}${eenheid ? ` ${eenheid}` : ''}`);

type Upload = { naam: string; fractie: number; fout?: string; klaar?: string };

function Sleepvak({ label, uitleg, accept, meerdere, uitgeschakeld, opBestanden }: {
  label: string; uitleg: string; accept: string; meerdere?: boolean; uitgeschakeld?: boolean; opBestanden: (f: File[]) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [boven, setBoven] = useState(false);
  const neer = (e: DragEvent) => { e.preventDefault(); setBoven(false); if (!uitgeschakeld) opBestanden([...e.dataTransfer.files]); };
  return (
    <div className={`sleepvak${boven ? ' sleepvak-boven' : ''}${uitgeschakeld ? ' sleepvak-uit' : ''}`} onDragOver={(e) => { e.preventDefault(); setBoven(true); }}
      onDragLeave={() => setBoven(false)} onDrop={neer}>
      <div className="sleepvak-label">{label}</div>
      <div className="stat-sub" style={{ marginTop: 2 }}>{uitleg}</div>
      <button type="button" className="knop knop-lijn" style={{ marginTop: 10 }} disabled={uitgeschakeld} onClick={() => ref.current?.click()}>Bestanden kiezen</button>
      <input ref={ref} type="file" accept={accept} multiple={meerdere} hidden onChange={(e) => { opBestanden([...(e.target.files ?? [])]); e.target.value = ''; }} />
    </div>
  );
}

function Voortgangslijst({ items }: { items: Upload[] }) {
  if (!items.length) return null;
  return (
    <ul className="uploadlijst">
      {items.map((u, i) => (
        <li key={i}>
          <span className="uploadnaam">{u.naam}</span>
          {u.fout ? <Badge toon="fout">{u.fout}</Badge> : u.klaar ? <Badge toon={u.klaar === 'al aanwezig' ? 'let-op' : 'goed'}>{u.klaar}</Badge>
            : <span className="balk balk-klein" aria-label={`${Math.round(u.fractie * 100)} %`}><div style={{ width: `${u.fractie * 100}%` }} /></span>}
        </li>
      ))}
    </ul>
  );
}

// ── Eén gegeven: brochure | vastgelegd | handeling ──────────────────────────
function GegevenRij({ g, beheer, bewerk }: { g: Data['gegevens'][number]; beheer: boolean;
  bewerk: (sleutel: string, data: object) => Promise<string | null> }) {
  const [modus, setModus] = useState<'' | 'corrigeren' | 'bevestigen'>('');
  const [waarde, setWaarde] = useState('');
  const [fout, setFout] = useState<string | null>(null);
  const v = g.vastgelegd, e = g.extractie;
  const doe = async (data: object) => { const f = await bewerk(g.sleutel, data); setFout(f); if (!f) setModus(''); };
  const status = !v ? <Badge toon="let-op">ontbreekt</Badge>
    : v.status === 'goedgekeurd' ? <Badge toon="goed">{v.herkomst === 'handmatig' ? 'handmatig' : 'goedgekeurd'}</Badge>
    : <Badge toon="info">overgenomen</Badge>;
  return (
    <tr className={g.conflict || g.afwijking ? 'rij-let-op' : undefined}>
      <td>
        <div className="gegeven-label">{g.label}</div>
        {g.conflict && <div className="gegeven-melding">⚠ Tegenstrijdig in de brochure: {g.conflict.bronnen.join(' ↔ ')}</div>}
        {g.afwijking && <div className="gegeven-melding">⚠ Vastgelegde waarde wijkt af van de brochure</div>}
      </td>
      <td data-kop="Brochure">
        {e ? <><div>{toon(e.waarde, e.eenheid)}</div><div className="bron">{e.bron}{e.zekerheid && e.zekerheid !== 'hoog' ? ` · zekerheid ${e.zekerheid}` : ''}{e.toelichting ? ` · ${e.toelichting}` : ''}</div></>
          : <span className="stat-sub">niet in de brochure</span>}
      </td>
      <td data-kop="Vastgelegd">
        <div>{v ? toon(v.waarde, v.eenheid) : '—'} {status}</div>
        {v?.bron && v.herkomst === 'handmatig' && <div className="bron">{v.bron}</div>}
      </td>
      {beheer && (
        <td data-kop="Handeling">
          {modus === 'corrigeren' ? (
            <form className="inline-form" onSubmit={(x) => { x.preventDefault(); void doe({ actie: 'corrigeren', waarde }); }}>
              {g.sleutel === 'woningtype' ? null : <input aria-label={`Nieuwe waarde voor ${g.label}`} value={waarde} onChange={(x) => setWaarde(x.target.value)} autoFocus />}
              <button className="knop knop-primair knop-klein" type="submit">Opslaan</button>
              <button className="knop knop-lijn knop-klein" type="button" onClick={() => setModus('')}>Annuleren</button>
            </form>
          ) : modus === 'bevestigen' ? (
            <div className="inline-form">
              <span className="stat-sub" style={{ marginTop: 0 }}>Vervangen door {toon(e?.waarde, e?.eenheid)}?</span>
              <button className="knop knop-primair knop-klein" type="button" onClick={() => void doe({ actie: 'brochure', bevestigd: true })}>Ja, vervangen</button>
              <button className="knop knop-lijn knop-klein" type="button" onClick={() => setModus('')}>Nee</button>
            </div>
          ) : (
            <div className="knoppen">
              {v?.status === 'overgenomen' && <button className="knop knop-lijn knop-klein" type="button" onClick={() => void doe({ actie: 'goedkeuren' })}>Goedkeuren</button>}
              {e && (!v || g.afwijking) && <button className="knop knop-lijn knop-klein" type="button"
                onClick={() => (v?.status === 'goedgekeurd' ? setModus('bevestigen') : void doe({ actie: 'brochure' }))}>Brochurewaarde overnemen</button>}
              <button className="knop knop-lijn knop-klein" type="button" onClick={() => { setWaarde(v ? String(v.waarde) : e ? String(e.waarde) : ''); setModus('corrigeren'); }}>
                {v ? 'Corrigeren' : 'Aanvullen'}</button>
            </div>
          )}
          {modus === 'corrigeren' && g.sleutel === 'woningtype' && <WoningtypeKeuze doe={(w) => void doe({ actie: 'corrigeren', waarde: w })} />}
          {fout && <div className="fout" role="alert">{fout}</div>}
        </td>
      )}
    </tr>
  );
}

function WoningtypeKeuze({ doe }: { doe: (w: string) => void }) {
  const [typen, setTypen] = useState<string[]>([]);
  useEffect(() => { api<{ woningtypen: string[] }>('/api/catalogus/project').then((k) => setTypen(k.woningtypen)); }, []);
  return <select aria-label="Woningtype" defaultValue="" onChange={(e) => e.target.value && doe(e.target.value)} style={{ marginTop: 6 }}>
    <option value="">Kies een woningtype</option>{typen.map((t) => <option key={t}>{t}</option>)}</select>;
}

// ── Foto's ─────────────────────────────────────────────────────────────────
function Foto({ b, beheer, intrekken, naamVan }: { b: Bestand; beheer: boolean; intrekken: (id: string) => void; naamVan: (id: string) => string }) {
  const c = b.classificatie;
  return (
    <figure className={`foto${b.dubbel_van ? ' foto-dubbel' : ''}`}>
      <a href={`/api/bestanden/${b.id}`} target="_blank" rel="noreferrer"><img src={`/api/bestanden/${b.id}/miniatuur`} alt={`${b.herkomst === 'brochure' ? `Brochurefoto pagina ${b.pagina}` : b.originele_naam}`} loading="lazy" /></a>
      <figcaption>
        <div className="chips">
          <span className="chip">{b.herkomst === 'upload' ? 'losse foto' : `brochure p. ${b.pagina}`}</span>
          <span className="chip">{b.breedte}×{b.hoogte}</span>
          {c && <span className={`chip${c.controle ? ' chip-let-op' : ''}`} title={`${c.model}; score ${c.score?.toFixed?.(2)}`}>{CATEGORIE[c.categorie] ?? c.categorie}{c.controle ? ' ?' : ''}</span>}
        </div>
        {b.dubbel_van && <div className="bron" title={b.dubbel_reden ?? ''}>Niet gebruikt: dubbel van {naamVan(b.dubbel_van)}</div>}
        {beheer && b.herkomst === 'upload' && <button type="button" className="tekstknop" onClick={() => intrekken(b.id)}>Uit aanlevering halen</button>}
      </figcaption>
    </figure>
  );
}

// ── Scherm ─────────────────────────────────────────────────────────────────
export function AanleverScherm({ id, ik }: { id: string; ik: Ik }) {
  const [d, setD] = useState<Data | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [melding, setMelding] = useState<{ toon: 'goed' | 'fout'; tekst: string } | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [bezig, setBezig] = useState(false);
  const beheer = ik.platformbeheer;

  const laad = useCallback(() => api<Data>(`/api/projecten/${id}/aanlevering`).then(setD, (e) => setFout(e.message)), [id]);
  useEffect(() => { void laad(); }, [laad]);
  const lopend = d?.verwerkingen.find((v) => v.status === 'wachtrij' || v.status === 'bezig');
  useEffect(() => { if (!lopend) return; const t = setInterval(() => void laad(), 1500); return () => clearInterval(t); }, [lopend, laad]);

  if (fout) return <><a className="terug" href={`#/projecten/${id}`}>← Woningproject</a><p className="melding melding-fout" role="alert">{fout}</p></>;
  if (!d) return null;

  const actief = d.bestanden.filter((b) => !b.vervallen);
  const brochure = actief.find((b) => b.soort === 'brochure');
  const losse = actief.filter((b) => b.soort === 'foto' && b.herkomst === 'upload');
  const uitBrochure = actief.filter((b) => b.soort === 'foto' && b.herkomst === 'brochure');
  const plattegronden = actief.filter((b) => b.soort === 'plattegrond');
  const fotos = [...losse, ...uitBrochure];
  const gebruikt = fotos.filter((f) => !f.dubbel_van);
  const naamVan = (bid: string) => { const b = d.bestanden.find((x) => x.id === bid); return b ? (b.herkomst === 'upload' ? `'${b.originele_naam}'` : `brochurefoto p. ${b.pagina}`) : 'ander beeld'; };
  const imp = d.import;
  const laatste = d.verwerkingen[0];

  async function lever(soort: 'brochure' | 'foto', bestanden: File[]) {
    const lijst = soort === 'brochure' ? bestanden.slice(0, 1) : bestanden;
    const start = uploads.length;
    setUploads((u) => [...u, ...lijst.map((f) => ({ naam: f.name, fractie: 0 }))]);
    const zet = (i: number, x: Partial<Upload>) => setUploads((u) => u.map((y, j) => (j === start + i ? { ...y, ...x } : y)));
    // Na elkaar, zodat de voortgang leesbaar blijft en de studio niet overbelast raakt.
    for (const [i, f] of lijst.entries()) {
      try {
        const r = await upload<{ al_aanwezig: boolean }>(`/api/projecten/${id}/bestanden?soort=${soort}`, f, (x) => zet(i, { fractie: x }));
        zet(i, { klaar: r.body.al_aanwezig ? 'al aanwezig' : 'aangeleverd' });
      } catch (e) { zet(i, { fout: e instanceof ApiFout ? e.message : 'mislukt' }); }
    }
    await laad();
  }

  async function handeling(fn: () => Promise<unknown>, gelukt?: string) {
    setBezig(true); setMelding(null);
    try { await fn(); if (gelukt) setMelding({ toon: 'goed', tekst: gelukt }); }
    catch (e) { setMelding({ toon: 'fout', tekst: e instanceof ApiFout ? e.message : 'De studio is niet bereikbaar' }); }
    finally { setBezig(false); await laad(); }
  }
  const start = (soort: string) => handeling(() => api(`/api/projecten/${id}/verwerkingen`, { methode: 'POST', data: { soort } }));
  const bewerk = async (sleutel: string, data: object) => {
    try { await api(`/api/projecten/${id}/gegevens/${sleutel}`, { methode: 'PUT', data }); await laad(); return null; }
    catch (e) { return e instanceof ApiFout ? e.message : 'De studio is niet bereikbaar'; }
  };

  // Meldingen: tegenstrijdigheden, afwijkingen, ontbrekende en open punten, controle van de generator.
  const conflicten = d.gegevens.filter((g) => g.conflict);
  const afwijkingen = d.gegevens.filter((g) => g.afwijking);
  const ontbrekend = d.gegevens.filter((g) => !g.vastgelegd);
  const nogTeKeuren = d.gegevens.filter((g) => g.vastgelegd?.status === 'overgenomen');
  const zonderMelding = nogTeKeuren.filter((g) => !g.conflict && !g.afwijking);
  const mk = imp?.makelaar?.waarde as Record<string, string | string[]> | undefined;
  const mkVergelijk: [string, string | undefined, string | null | undefined][] = mk ? [
    ['Naam', mk.naam as string, d.kantoor.merknaam], ['Telefoon', mk.telefoon as string, d.kantoor.telefoon],
    ['E-mail', mk.email as string, d.kantoor.email], ['Website', mk.website as string, d.kantoor.website],
    ['Adres', (mk.adresregels as string[] | undefined)?.join(', '), d.kantoor.adresregels.join(', ') || null]] : [];
  const kaal = (s?: string | null) => (s ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9@]/g, '');
  const mkVerschil = mkVergelijk.filter(([k, b, kt]) => b && kt && (k === 'Naam' ? !kaal(b).includes(kaal(kt)) && !kaal(kt).includes(kaal(b)) : kaal(b) !== kaal(kt)));
  const mkLeeg = mkVergelijk.filter(([k, b, kt]) => b && !kt && k !== 'Naam');

  async function kantoorAanvullen() {
    const k = await api<Record<string, unknown>>(`/api/kantoren/${d!.kantoor.id}`);
    const nieuw = { ...k, telefoon: k.telefoon || mk?.telefoon || null, email: k.email || mk?.email || null, website: k.website || mk?.website || null,
      adresregels: (k.adresregels as string[]).length ? k.adresregels : (mk?.adresregels ?? []) };
    await api(`/api/kantoren/${d!.kantoor.id}`, { methode: 'PUT', data: nieuw });
  }

  const profielVoorstel = imp?.profiel?.waarde;
  const ingrepen = d.ingrepen.reduce((n, x) => n + (x.actie === 'gegeven_goedkeuren' ? 0 : x.n), 0);
  const goedkeuringen = d.ingrepen.find((x) => x.actie === 'gegeven_goedkeuren')?.n ?? 0;

  return (
    <>
      <a className="terug" href={`#/projecten/${id}`}>← {d.project.naam}</a>
      <div className="rij" style={{ alignItems: 'flex-start' }}>
        <div className="titel">
          <div className="titel-badge">Aanlevering</div>
          <h1>{d.project.naam}</h1>
          <p>{d.project.kantoor} · brochure en foto's aanleveren, importeren en controleren. Er wordt hier geen website gegenereerd.</p>
        </div>
        {beheer && (
          <div style={{ textAlign: 'right' }}>
            <button type="button" className="knop knop-primair" disabled={bezig || !!lopend || !actief.length}
              onClick={() => handeling(() => api(`/api/projecten/${id}/aanleveringen`, { methode: 'POST' }), 'Aanlevering opgeslagen. Er is geen website gegenereerd.')}>
              Aanlevering opslaan</button>
            <div className="stat-sub">{d.aanleveringen[0] ? `Versie ${d.aanleveringen[0].versie}, ${new Date(d.aanleveringen[0].opgeslagen_op).toLocaleString('nl-NL')} door ${d.aanleveringen[0].door}` : 'Nog niet opgeslagen'}</div>
          </div>
        )}
      </div>
      {melding && <p className={`melding melding-${melding.toon}`} role="status" style={{ marginBottom: 16 }}>{melding.tekst}</p>}

      <div className="raster raster-4" style={{ marginBottom: 16 }}>
        <section className="kaart"><div className="stat-waarde">{brochure ? '✓' : '—'}</div><div className="stat-label">Brochure</div>
          <div className="stat-sub">{brochure ? `${mb(brochure.grootte)}${imp ? `, ${imp.paginas} pagina's` : ''}` : 'nog niet aangeleverd'}</div></section>
        <section className="kaart"><div className="stat-waarde">{gebruikt.length}</div><div className="stat-label">Foto's in gebruik</div>
          <div className="stat-sub">{losse.length} los, {uitBrochure.length} uit de brochure{fotos.length - gebruikt.length ? `, ${fotos.length - gebruikt.length} dubbel` : ''}</div></section>
        <section className="kaart"><div className="stat-waarde">{d.gegevens.filter((g) => g.vastgelegd?.status === 'goedgekeurd').length}/{d.gegevens.length}</div>
          <div className="stat-label">Gegevens goedgekeurd</div><div className="stat-sub">{nogTeKeuren.length} overgenomen, {ontbrekend.length} ontbreken</div></section>
        <section className="kaart"><div className="stat-waarde">{imp ? sec(imp.duur_ms) : '—'}</div><div className="stat-label">Verwerkingstijd laatste import</div>
          <div className="stat-sub">{ingrepen} correctie{ingrepen === 1 ? '' : 's'}, {goedkeuringen} goedkeuring{goedkeuringen === 1 ? '' : 'en'}</div></section>
      </div>

      {beheer && (
        <Kaart titel="1. Aanleveren">
          <div className="raster raster-2">
            <Sleepvak label="Originele verkoopbrochure (PDF)" uitleg={brochure ? `Huidig: ${brochure.originele_naam}. Een nieuwe brochure vervangt deze als bron.` : 'Sleep de PDF hierheen.'}
              accept="application/pdf,.pdf" opBestanden={(f) => void lever('brochure', f)} />
            <Sleepvak label="Losse woningfoto's" uitleg="JPEG, PNG, WebP of TIFF, meerdere tegelijk. Originelen blijven ongewijzigd bewaard." accept="image/jpeg,image/png,image/webp,image/tiff" meerdere
              opBestanden={(f) => void lever('foto', f)} />
          </div>
          <Voortgangslijst items={uploads} />
        </Kaart>
      )}

      <Kaart titel={`${beheer ? '2. ' : ''}Brochure-import`}>
        <div className="rij">
          <div>
            {lopend ? <p><Badge>{lopend.status === 'wachtrij' ? 'in de wachtrij' : 'bezig'}</Badge> {lopend.soort === 'brochure-import' ? 'De brochure wordt geïmporteerd met de bestaande generator…' : 'Foto\'s worden ingedeeld…'}</p>
              : laatste?.status === 'mislukt' ? <p className="melding melding-fout">De laatste verwerking is mislukt: {laatste.fout}</p>
              : imp ? <p className="stat-sub" style={{ marginTop: 0 }}>Import {imp.volgnummer}, {new Date(imp.klaar_op).toLocaleString('nl-NL')} · {sec(imp.duur_ms)} (lezen en indelen {sec(imp.stappen.import as number)}, controle {sec(imp.stappen.controle as number)}{imp.stappen.classificatie ? `, beeldclassificatie ${sec(imp.stappen.classificatie as number)}` : ''}) · generator {imp.generator_commit?.slice(0, 7)}</p>
              : <p className="stat-sub" style={{ marginTop: 0 }}>{brochure ? 'De brochure is aangeleverd en kan worden geïmporteerd.' : 'Lever eerst een brochure aan.'}</p>}
          </div>
          {beheer && <div className="knoppen">
            <button type="button" className="knop knop-primair" disabled={!brochure || !!lopend || bezig} onClick={() => void start('brochure-import')}>{imp ? 'Opnieuw importeren' : 'Brochure importeren'}</button>
            <button type="button" className="knop knop-lijn" disabled={!fotos.length || !!lopend || bezig} onClick={() => void start('foto-indeling')}>Foto's indelen</button>
          </div>}
        </div>
        {imp && <div className="chips" style={{ marginTop: 8 }}>
          {Object.entries(imp.telling).map(([k, n]) => <span className="chip" key={k}>{n} {SOORT_BEELD[k] ?? k}</span>)}
          <span className="chip">{imp.hoofdstukken.length} tekstdelen</span>
          <span className="chip">{d.gegevens.filter((g) => g.sleutel.startsWith('feit.') && g.extractie).length} kenmerken</span>
        </div>}
        {imp && beheer && <p className="stat-sub">Een nieuwe import vult alleen lege en nog niet goedgekeurde gegevens aan. Handmatige en goedgekeurde gegevens blijven staan.</p>}
      </Kaart>

      {imp && (
        <Kaart titel="Meldingen">
          <ul className="meldingen">
            {conflicten.map((g) => <li key={g.sleutel} className="m-let-op"><strong>Tegenstrijdig: {g.label}</strong>. {g.conflict!.bronnen.join(' ↔ ')}{g.vastgelegd?.status === 'goedgekeurd' ? <> · <Badge toon="goed">besloten: {toon(g.vastgelegd.waarde, g.vastgelegd.eenheid)}</Badge></> : ''}</li>)}
            {afwijkingen.map((g) => <li key={`a-${g.sleutel}`} className="m-let-op"><strong>Afwijking: {g.label}</strong>. Vastgelegd {toon(g.vastgelegd?.waarde, g.vastgelegd?.eenheid)}, brochure {toon(g.extractie?.waarde, g.extractie?.eenheid)} ({g.extractie?.bron})</li>)}
            {mkVerschil.map(([k, b, kt]) => <li key={`m-${k}`} className="m-let-op"><strong>Makelaar: {k}</strong>. Brochure '{b}', kantoor '{kt}'</li>)}
            {ontbrekend.map((g) => <li key={`o-${g.sleutel}`}><strong>Ontbreekt: {g.label}</strong>. Niet in de brochure gevonden; vul het handmatig aan</li>)}
            {imp.ontbreekt.map((o) => <li key={`r-${o}`}><strong>Ontbreekt in de brochure</strong>: {o}</li>)}
            {imp.controle?.fouten.map((f, i) => <li key={`f-${i}`} className="m-info"><strong>Nog te regelen</strong> (controle generator): {f}</li>)}
            {imp.controle?.waarschuwingen.filter((w) => !w.startsWith('tegenstrijdig')).map((w, i) => <li key={`w-${i}`} className="m-info">{w}</li>)}
            {imp.vraagprijs_gevonden && <li className="m-info">Vraagprijs gevonden (p. {imp.vraagprijs_gevonden.pagina}): bewust niet overgenomen; wordt nooit gepubliceerd</li>}
          </ul>
          {imp.uitgesloten.length > 0 && <details className="uitklap"><summary>{imp.uitgesloten.length} onderdelen uitgesloten van publicatie (verkopersinformatie, kaarten, logo's van derden)</summary>
            <ul>{imp.uitgesloten.map((u, i) => <li key={i}>{u}</li>)}</ul></details>}
        </Kaart>
      )}

      <Kaart titel="Woninggegevens">
        <p className="stat-sub" style={{ marginTop: 0 }}><strong>Brochure</strong> = wat de import vond, met pagina. <strong>Vastgelegd</strong> = wat wij gebruiken: <Badge>overgenomen</Badge> automatisch aangevuld en nog te controleren, <Badge toon="goed">goedgekeurd</Badge> of <Badge toon="goed">handmatig</Badge> door ons bevestigd; die worden nooit automatisch overschreven.</p>
        <div className="tabel-schuif">
          <table className="tabel gegevenstabel">
            <thead><tr><th>Gegeven</th><th>Brochure</th><th>Vastgelegd</th>{beheer && <th>Handeling</th>}</tr></thead>
            <tbody>{d.gegevens.map((g) => <GegevenRij key={g.sleutel} g={g} beheer={beheer} bewerk={bewerk} />)}</tbody>
          </table>
        </div>
        {beheer && <div className="knoppen" style={{ marginTop: 12, alignItems: 'center' }}>
          {zonderMelding.length > 0 && <button type="button" className="knop knop-lijn" disabled={bezig} onClick={() => handeling(async () => {
            for (const g of zonderMelding) await api(`/api/projecten/${id}/gegevens/${g.sleutel}`, { methode: 'PUT', data: { actie: 'goedkeuren' } });
          }, `${zonderMelding.length} gegevens goedgekeurd. Gegevens met een melding blijven open voor een eigen besluit.`)}>
            Overgenomen gegevens zonder melding goedkeuren ({zonderMelding.length})</button>}
          <NieuwGegeven bewerk={bewerk} />
        </div>}
      </Kaart>

      {imp && (
        <div className="raster raster-2">
          <Kaart titel="Makelaar in de brochure">
            {mk ? <table className="tabel"><tbody>{mkVergelijk.map(([k, b, kt]) => (
              <tr key={k}><td>{k}</td><td>{b ?? '—'}{kt && b && mkVerschil.some((x) => x[0] === k) ? <> <Badge toon="let-op">kantoor: {kt}</Badge></> : kt && b ? <> <Badge toon="goed">gelijk aan kantoor</Badge></> : null}</td></tr>))}</tbody></table>
              : <p className="stat-sub">Geen makelaarsgegevens gevonden.</p>}
            {beheer && <div className="knoppen" style={{ marginTop: 12 }}>
              {mkLeeg.length > 0 && <button type="button" className="knop knop-lijn" disabled={bezig} onClick={() => handeling(kantoorAanvullen, `Lege kantoorgegevens aangevuld: ${mkLeeg.map((x) => x[0].toLowerCase()).join(', ')}.`)}>
                Lege kantoorgegevens aanvullen ({mkLeeg.map((x) => x[0].toLowerCase()).join(', ')})</button>}
              {d.brochure_logo && !d.kantoor.logo_id && <button type="button" className="knop knop-lijn" disabled={bezig}
                onClick={() => handeling(() => api(`/api/kantoren/${d.kantoor.id}/logo/brochure`, { methode: 'POST', data: { bestand_id: d.brochure_logo!.id } }), 'Brochurelogo ingesteld als kantoorlogo; de huisstijl is eruit afgeleid.')}>
                Brochurelogo als kantoorlogo gebruiken</button>}
            </div>}
            {d.brochure_logo && <div className="logo-voorbeeld"><img src={`/api/bestanden/${d.brochure_logo.id}`} alt="Logo uit de brochure" /><span className="stat-sub">Logo uit de brochure{d.kantoor.logo_id ? ' · het kantoor heeft al een logo' : ''}</span></div>}
          </Kaart>
          <Kaart titel="Presentatieprofiel">
            <p>Voorstel uit de brochure: <strong>{profielVoorstel ?? '—'}</strong> <span className="stat-sub" style={{ display: 'inline' }}>({imp.profiel?.toelichting})</span></p>
            <p>Gekozen voor deze woning: <strong>{d.project.profiel ?? 'Nog niet gekozen'}</strong></p>
            {beheer && profielVoorstel && d.project.profiel !== profielVoorstel && <div className="knoppen">
              <button type="button" className="knop knop-lijn" disabled={bezig} onClick={() => handeling(async () => {
                const p = await api<Record<string, unknown>>(`/api/projecten/${id}`);
                await api(`/api/projecten/${id}`, { methode: 'PUT', data: { ...p, profiel: profielVoorstel } });
              }, `Profiel '${profielVoorstel}' gekozen.`)}>{d.project.profiel ? `Vervangen door '${profielVoorstel}'` : `'${profielVoorstel}' kiezen`}</button></div>}
            <p className="stat-sub">Het profiel wordt nooit automatisch gekozen; 'Nog niet gekozen' blijft mogelijk.</p>
          </Kaart>
        </div>
      )}

      <Kaart titel={`Foto's (${gebruikt.length} in gebruik)`}>
        {!fotos.length ? <p className="stat-sub" style={{ marginTop: 0 }}>Nog geen foto's. Zonder losse foto's worden de foto's uit de brochure gebruikt.</p> : <>
          <p className="stat-sub" style={{ marginTop: 0 }}>{losse.length ? 'Losse foto\'s gaan voor op hetzelfde beeld uit de brochure; een brochurefoto zonder losse tegenhanger blijft in gebruik.' : 'Er zijn geen losse foto\'s: de foto\'s uit de brochure worden gebruikt.'}
            {' '}Dubbele beelden worden herkend en niet gebruikt.{fotos.some((f) => f.classificatie) ? ' De indeling per ruimte is een voorstel van de lokale beeldherkenning; een vraagteken betekent: controleren.' : ''}</p>
          <div className="fotoraster">{fotos.map((b) => <Foto key={b.id} b={b} beheer={beheer} naamVan={naamVan}
            intrekken={(bid) => void handeling(() => api(`/api/bestanden/${bid}`, { methode: 'DELETE' }))} />)}</div>
        </>}
        {plattegronden.length > 0 && <>
          <h3 className="tussenkop">Plattegronden uit de brochure</h3>
          <div className="fotoraster">{plattegronden.map((b) => <Foto key={b.id} b={b} beheer={false} naamVan={naamVan} intrekken={() => {}} />)}</div>
        </>}
      </Kaart>

      {d.teksten.length > 0 && (
        <Kaart titel="Teksten uit de brochure">
          <p className="stat-sub" style={{ marginTop: 0 }}>Ongewijzigd overgenomen door de import. Redactie volgt in een latere stap.</p>
          {d.teksten.map((t) => (
            <details key={t.id} className="uitklap"><summary>{t.titel ?? t.id} · {t.alineas.length} alinea's</summary>
              {t.alineas.map((a, i) => a.lijst ? <ul key={i}>{a.lijst.map((x, j) => <li key={j}>{x}</li>)}</ul> : <p key={i}>{(a.prose ?? a.accent ?? '').replace(/\*\*/g, '')}</p>)}
            </details>
          ))}
        </Kaart>
      )}

      {d.aanleveringen.length > 0 && (
        <Kaart titel="Opgeslagen aanleveringen">
          <table className="tabel"><tbody>{d.aanleveringen.map((a) => (
            <tr key={a.versie}><td>Versie {a.versie}</td><td>{new Date(a.opgeslagen_op).toLocaleString('nl-NL')} · {a.door} · {String(a.samenvatting.goedgekeurd)} goedgekeurd, {String(a.samenvatting.open)} open, {String(a.samenvatting.losse_fotos)} losse foto's, {String(a.samenvatting.brochurefotos)} uit de brochure</td></tr>))}</tbody></table>
        </Kaart>
      )}
    </>
  );
}

function NieuwGegeven({ bewerk }: { bewerk: (sleutel: string, data: object) => Promise<string | null> }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(''); const [waarde, setWaarde] = useState(''); const [eenheid, setEenheid] = useState('');
  const [fout, setFout] = useState<string | null>(null);
  if (!open) return <button type="button" className="tekstknop" onClick={() => setOpen(true)}>+ Gegeven toevoegen dat niet in de brochure staat</button>;
  const sleutel = `feit.${label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
  return (
    <form className="inline-form" style={{ marginTop: 12 }} onSubmit={async (e) => {
      e.preventDefault();
      const f = await bewerk(sleutel, { actie: 'corrigeren', label, waarde, eenheid: eenheid || null });
      setFout(f); if (!f) { setOpen(false); setLabel(''); setWaarde(''); setEenheid(''); }
    }}>
      <input aria-label="Omschrijving" placeholder="Omschrijving, bijvoorbeeld Perceel" value={label} onChange={(e) => setLabel(e.target.value)} />
      <input aria-label="Waarde" placeholder="Waarde" value={waarde} onChange={(e) => setWaarde(e.target.value)} />
      <select aria-label="Eenheid" value={eenheid} onChange={(e) => setEenheid(e.target.value)}><option value="">geen eenheid</option><option>m²</option><option>m³</option></select>
      <button className="knop knop-primair knop-klein" type="submit" disabled={!label.trim()}>Toevoegen</button>
      <button className="knop knop-lijn knop-klein" type="button" onClick={() => setOpen(false)}>Annuleren</button>
      {fout && <span className="fout" role="alert">{fout}</span>}
    </form>
  );
}

