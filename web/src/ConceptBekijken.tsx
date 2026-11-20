// Concept bekijken met verbeterpunten (migratie 015), voor makelaar, kantoorbeheerder en Rhadix: de
// afgeschermde preview (bestaande component) met daarnaast het paneel Verbeterpunten. Geen technisch scherm.
// In de gegenereerde site zelf wordt niets geplaatst. Accepteren blijft bij de kantoorbeheerder (en
// platformbeheer) en wordt geweigerd zolang er op die versie punten open of in behandeling staan.
import { useCallback, useEffect, useState } from 'react';
import { api, ApiFout, type ConceptenOverzicht, type Ik } from './api.ts';
import { Badge, Kaart } from './onderdelen/basis.tsx';
import { kantoorRechten } from './onderdelen/rechten.ts';
import { isOpen, PuntenIndienen, PuntenPerVersie, type Punt } from './onderdelen/Verbeterpunten.tsx';
import { Voorbeeld } from './Concepten.tsx';

const WEERGAVE = [{ naam: 'Desktop', breedte: 1440, hoogte: 900 }, { naam: 'Mobiel', breedte: 390, hoogte: 844 }];
const STATUS_CONCEPT: Record<string, string> = { te_beoordelen: 'te beoordelen', geaccepteerd: 'geaccepteerd', verbeterpunten: 'verbeterpunten ingediend' };

export function ConceptBekijken({ id, ik, versie }: { id: string; ik: Ik; versie?: number }) {
  const [d, setD] = useState<ConceptenOverzicht | null>(null);
  const [punten, setPunten] = useState<Punt[]>([]);
  const [fout, setFout] = useState<string | null>(null);
  const [kies, setKies] = useState<number | null>(versie ?? null);
  const [weergave, setWeergave] = useState(0);
  const [melding, setMelding] = useState<{ toon: 'goed' | 'fout'; tekst: string } | null>(null);
  const [bezig, setBezig] = useState(false);
  const laad = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([api<ConceptenOverzicht>(`/api/projecten/${id}/concepten`), api<Punt[]>(`/api/projecten/${id}/verbeterpunten`)]);
      setD(c); setPunten(p);
    } catch (e) { setFout((e as Error).message); }
  }, [id]);
  useEffect(() => { void laad(); }, [laad]);

  if (fout) return <p className="melding melding-fout" role="alert">{fout}</p>;
  if (!d) return null;
  const terug = <a className="terug" href={`#/projecten/${id}`}>← {[d.project.adres, d.project.plaats].filter(Boolean).join(', ') || d.project.naam}</a>;
  if (!d.concepten.length) return <>{terug}<p className="stat-sub">Er is nog geen conceptwebsite voor deze woning.</p></>;
  const k = d.concepten.find((c) => c.versie === kies) ?? d.concepten[0];
  const rechten = kantoorRechten(ik, d.project.kantoor_id);
  const open = punten.filter((p) => p.concept_id === k.id && isOpen(p));
  const versies = d.concepten.map((c) => c.versie);
  const w = WEERGAVE[weergave];

  async function accepteer() {
    setBezig(true); setMelding(null);
    try { await api(`/api/concepten/${k.id}/beoordeling`, { methode: 'PUT', data: { besluit: 'geaccepteerd' } }); setMelding({ toon: 'goed', tekst: `Versie ${k.versie} is geaccepteerd. Er is niets gepubliceerd.` }); await laad(); }
    catch (e) { setMelding({ toon: 'fout', tekst: e instanceof ApiFout ? e.message : 'Het portaal is niet bereikbaar' }); }
    finally { setBezig(false); }
  }

  return (
    <div className="concept-bekijken">
      {terug}
      <div className="rij" style={{ alignItems: 'flex-start', marginBottom: 12 }}>
        <div className="titel">
          <div className="titel-badge">Conceptwebsite</div>
          <h1>Versie {k.versie} <Badge toon={k.status === 'geaccepteerd' ? 'goed' : k.status === 'verbeterpunten' ? 'let-op' : 'info'}>{STATUS_CONCEPT[k.status] ?? k.status}</Badge></h1>
          <p>Afgeschermd concept, niet gepubliceerd. Bekijk de website en geef verbeterpunten door.</p>
        </div>
      </div>
      {d.concepten.length > 1 && <div className="versies" role="tablist" aria-label="Conceptversies" style={{ marginBottom: 12 }}>
        {d.concepten.map((c) => <button key={c.id} type="button" role="tab" aria-selected={c.id === k.id} className={`versie${c.id === k.id ? ' versie-actief' : ''}`}
          onClick={() => { setKies(c.versie); setMelding(null); }}><strong>v{c.versie}</strong>{(c.open_verbeterpunten ?? 0) > 0 && <> <Badge toon="let-op">{c.open_verbeterpunten} open</Badge></>}</button>)}</div>}

      <div className="bekijken-raster">
        <section className="kaart bekijken-preview">
          <div className="apparaten" role="group" aria-label="Weergave">
            {WEERGAVE.map((a, i) => <button key={a.naam} type="button" className={`knop knop-klein ${i === weergave ? 'knop-primair' : 'knop-lijn'}`} aria-pressed={i === weergave} onClick={() => setWeergave(i)}>{a.naam}</button>)}
            <a className="knop knop-lijn knop-klein" href={`/api/voorbeeld/${k.voorbeeld_token}/`} target="_blank" rel="noreferrer noopener" style={{ textDecoration: 'none' }}>Openen in nieuw tabblad</a>
          </div>
          <Voorbeeld key={`${k.id}-${weergave}`} token={k.voorbeeld_token} breedte={w.breedte} hoogte={w.hoogte} />
        </section>

        <div className="bekijken-paneel">
          <Kaart titel={`Verbeterpunten doorgeven (versie ${k.versie})`}>
            {rechten.produceren
              ? <PuntenIndienen conceptId={k.id} versie={k.versie} onIngediend={() => void laad()} />
              : <p className="stat-sub" style={{ margin: 0 }}>U kunt bij dit kantoor geen verbeterpunten indienen.</p>}
          </Kaart>
          <Kaart titel="Status van de verbeterpunten">
            <PuntenPerVersie punten={punten} versies={versies} beheer={ik.platformbeheer} onGewijzigd={() => void laad()} />
          </Kaart>
          {rechten.kantoorbeheer && k.status !== 'geaccepteerd' && (
            <Kaart titel="Concept accepteren">
              {open.length ? <>
                <p className="melding melding-let-op" role="status" style={{ marginTop: 0 }}>Versie {k.versie} kan nog niet worden geaccepteerd. Nog af te handelen:</p>
                <ul className="nog-open">{open.map((p) => <li key={p.id}><Badge toon={p.status === 'OPEN' ? 'let-op' : 'info'}>{p.status === 'OPEN' ? 'Open' : 'In behandeling'}</Badge> {p.onderdeel}: {p.tekst}</li>)}</ul>
              </> : <p className="stat-sub" style={{ marginTop: 0 }}>Er staan geen verbeterpunten open op deze versie. Accepteren betekent: dit is een goed concept. Het is geen publicatie.</p>}
              <button type="button" className="knop knop-primair" disabled={bezig || open.length > 0} onClick={() => void accepteer()}>Versie {k.versie} accepteren</button>
            </Kaart>
          )}
          {melding && <p className={`melding melding-${melding.toon}`} role={melding.toon === 'fout' ? 'alert' : 'status'}>{melding.tekst}</p>}
        </div>
      </div>
    </div>
  );
}
