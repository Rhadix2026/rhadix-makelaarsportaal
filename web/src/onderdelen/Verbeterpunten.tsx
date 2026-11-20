// Verbeterpunten (migratie 015): indienen door iedereen in het kantoor, per conceptversie de status en de
// reactie van Rhadix, en (alleen platformbeheer) in behandeling nemen, beantwoorden, afronden of annuleren.
// De server en de database dwingen dezelfde regels af; deze component toont alleen wat past.
import { useState } from 'react';
import { api, ApiFout } from '../api.ts';
import { Badge, type Toon } from './basis.tsx';

export type Punt = {
  id: string; project_id: string; concept_id: string; versie: number; onderdeel: string; tekst: string;
  status: 'OPEN' | 'IN_BEHANDELING' | 'KLAAR' | 'GEANNULEERD'; herkomst: string;
  ingediend_door: string; ingediend_door_naam: string | null; ingediend_op: string;
  behandelaar: string | null; behandelaar_naam: string | null; reactie: string | null;
  afgehandeld_door: string | null; afgehandeld_door_naam: string | null; afgehandeld_op: string | null;
  verwerkt_in: string | null; verwerkt_in_versie: number | null;
  project_naam?: string; adres?: string | null; plaats?: string | null; kantoor?: string;
};

export const ONDERDELEN = ['algemeen', 'openingsbeeld', 'teksten', "foto's", 'indeling', 'kenmerken', 'huisstijl', 'contact', 'mobiel'];
export const STATUS_PUNT: Record<Punt['status'], [Toon, string]> = {
  OPEN: ['let-op', 'Open'], IN_BEHANDELING: ['info', 'In behandeling'], KLAAR: ['goed', 'Verwerkt'], GEANNULEERD: ['fout', 'Geannuleerd'],
};
export const isOpen = (p: Punt) => p.status === 'OPEN' || p.status === 'IN_BEHANDELING';
const datum = (s?: string | null) => (s ? new Date(s).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' }) : '');

/** Een of meer verbeterpunten indienen op één conceptversie. */
export function PuntenIndienen({ conceptId, versie, onIngediend }: { conceptId: string; versie: number; onIngediend: () => void }) {
  const leeg = { onderdeel: 'algemeen', tekst: '' };
  const [regels, setRegels] = useState([leeg]);
  const [bezig, setBezig] = useState(false);
  const [melding, setMelding] = useState<{ toon: 'goed' | 'fout'; tekst: string } | null>(null);
  const geldig = regels.filter((r) => r.tekst.trim().length >= 3);
  async function dienIn() {
    setBezig(true); setMelding(null);
    try {
      await api(`/api/concepten/${conceptId}/verbeterpunten`, { methode: 'POST', data: { punten: geldig } });
      setMelding({ toon: 'goed', tekst: `${geldig.length} verbeterpunt${geldig.length === 1 ? '' : 'en'} ingediend op versie ${versie}. Rhadix pakt ${geldig.length === 1 ? 'het' : 'ze'} op.` });
      setRegels([leeg]); onIngediend();
    } catch (e) { setMelding({ toon: 'fout', tekst: e instanceof ApiFout ? e.message : 'Het portaal is niet bereikbaar' }); }
    finally { setBezig(false); }
  }
  return (
    <div className="punten-indienen">
      {regels.map((r, i) => (
        <div key={i} className="punt-regel">
          <select aria-label={`Onderdeel ${i + 1}`} value={r.onderdeel} onChange={(e) => setRegels(regels.map((x, j) => (j === i ? { ...x, onderdeel: e.target.value } : x)))}>
            {ONDERDELEN.map((o) => <option key={o}>{o}</option>)}</select>
          <textarea aria-label={`Verbeterpunt ${i + 1}`} rows={2} placeholder="Wat moet er anders?" value={r.tekst} maxLength={1000}
            onChange={(e) => setRegels(regels.map((x, j) => (j === i ? { ...x, tekst: e.target.value } : x)))} />
          {regels.length > 1 && <button type="button" className="tekstknop" aria-label={`Verbeterpunt ${i + 1} verwijderen`} onClick={() => setRegels(regels.filter((_, j) => j !== i))}>Verwijderen</button>}
        </div>))}
      <div className="knoppen">
        {regels.length < 20 && <button type="button" className="tekstknop" onClick={() => setRegels([...regels, leeg])}>+ Nog een punt</button>}
        <button type="button" className="knop knop-primair" disabled={bezig || !geldig.length} onClick={() => void dienIn()}>
          {bezig ? 'Bezig…' : geldig.length > 1 ? `${geldig.length} verbeterpunten indienen` : 'Verbeterpunt indienen'}</button>
      </div>
      {melding && <p className={`melding melding-${melding.toon}`} role={melding.toon === 'fout' ? 'alert' : 'status'}>{melding.tekst}</p>}
    </div>
  );
}

/** Handelingen van Rhadix op één open punt. */
function Behandelen({ p, versies, onGewijzigd }: { p: Punt; versies: number[]; onGewijzigd: () => void }) {
  const [modus, setModus] = useState<null | 'beantwoorden' | 'afronden' | 'annuleren'>(null);
  const [tekst, setTekst] = useState('');
  const latere = versies.filter((v) => v > p.versie).sort((a, b) => b - a);
  const [versie, setVersie] = useState<number | ''>(latere[0] ?? '');
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  async function zend(data: Record<string, unknown>) {
    setBezig(true); setFout(null);
    try { await api(`/api/verbeterpunten/${p.id}`, { methode: 'PATCH', data }); setModus(null); setTekst(''); onGewijzigd(); }
    catch (e) { setFout(e instanceof ApiFout ? e.message : 'Het portaal is niet bereikbaar'); }
    finally { setBezig(false); }
  }
  return (
    <div className="punt-behandelen">
      {!modus && <div className="knoppen">
        {p.status === 'OPEN' && <button type="button" className="knop knop-lijn knop-klein" disabled={bezig} onClick={() => void zend({ status: 'IN_BEHANDELING' })}>In behandeling nemen</button>}
        <button type="button" className="knop knop-lijn knop-klein" onClick={() => setModus('beantwoorden')}>Beantwoorden</button>
        <button type="button" className="knop knop-lijn knop-klein" onClick={() => setModus('afronden')} disabled={!latere.length} title={latere.length ? undefined : 'Maak eerst een nieuwe conceptversie'}>Afronden</button>
        <button type="button" className="knop knop-lijn knop-klein" onClick={() => setModus('annuleren')}>Annuleren</button>
      </div>}
      {modus && <div className="punt-formulier">
        {modus === 'afronden' && <label>Verwerkt in versie{' '}
          <select value={versie} onChange={(e) => setVersie(Number(e.target.value))}>{latere.map((v) => <option key={v} value={v}>v{v}</option>)}</select></label>}
        <textarea rows={2} aria-label={modus === 'annuleren' ? 'Motivering' : modus === 'afronden' ? 'Toelichting' : 'Reactie'} value={tekst} onChange={(e) => setTekst(e.target.value)}
          placeholder={modus === 'annuleren' ? 'Waarom wordt dit punt niet uitgevoerd? (verplicht)' : modus === 'afronden' ? 'Wat is er aangepast? (verplicht)' : 'Reactie aan de makelaar'} />
        <div className="knoppen">
          <button type="button" className="knop knop-primair knop-klein" disabled={bezig || tekst.trim().length < (modus === 'beantwoorden' ? 1 : 3)}
            onClick={() => void zend(modus === 'beantwoorden' ? { reactie: tekst } : modus === 'afronden' ? { status: 'KLAAR', reactie: tekst, verwerkt_in_versie: versie } : { status: 'GEANNULEERD', reactie: tekst })}>
            {modus === 'beantwoorden' ? 'Reactie opslaan' : modus === 'afronden' ? `Afronden (verwerkt in v${versie})` : 'Punt annuleren'}</button>
          <button type="button" className="tekstknop" onClick={() => { setModus(null); setFout(null); }}>Terug</button>
        </div>
      </div>}
      {fout && <p className="melding melding-fout" role="alert">{fout}</p>}
    </div>
  );
}

/** Eén verbeterpunt met status, reactie en (voor platformbeheer) de handelingen. */
export function PuntRegel({ p, beheer, versies, onGewijzigd, metProject }: { p: Punt; beheer: boolean; versies: number[]; onGewijzigd: () => void; metProject?: boolean }) {
  const [toon, label] = STATUS_PUNT[p.status];
  return (
    <li className={`punt punt-${p.status.toLowerCase()}`}>
      <div className="punt-kop">
        <Badge toon={toon}>{p.status === 'KLAAR' && p.verwerkt_in_versie ? `${label} in v${p.verwerkt_in_versie}` : label}</Badge>
        <span className="punt-onderdeel">{p.onderdeel}</span>
        {metProject && <a href={`#/projecten/${p.project_id}/concept/v${p.versie}`} className="punt-project">{[p.adres, p.plaats].filter(Boolean).join(', ') || p.project_naam} · v{p.versie}{p.kantoor ? ` · ${p.kantoor}` : ''}</a>}
      </div>
      <p className="punt-tekst">{p.tekst}</p>
      <p className="bron">Ingediend {datum(p.ingediend_op)} door {p.ingediend_door_naam ?? 'een collega'}{p.herkomst === 'overgenomen' ? ' (overgenomen uit de eerdere registratie)' : ''}
        {p.status === 'IN_BEHANDELING' ? ` · in behandeling bij ${p.behandelaar_naam ?? 'Rhadix'}` : ''}
        {p.afgehandeld_op ? ` · ${p.status === 'KLAAR' ? 'afgerond' : 'geannuleerd'} ${datum(p.afgehandeld_op)} door ${p.afgehandeld_door_naam ?? 'Rhadix'}` : ''}</p>
      {p.reactie && <p className="punt-reactie"><strong>{p.status === 'GEANNULEERD' ? 'Motivering' : 'Reactie'} Rhadix:</strong> {p.reactie}</p>}
      {beheer && isOpen(p) && <Behandelen p={p} versies={versies} onGewijzigd={onGewijzigd} />}
    </li>
  );
}

/** Alle punten van een woningproject, per conceptversie (nieuwste eerst), met een telling per status. */
export function PuntenPerVersie({ punten, versies, beheer, onGewijzigd, alleenVersie }: { punten: Punt[]; versies: number[]; beheer: boolean; onGewijzigd: () => void; alleenVersie?: number }) {
  const groepen = [...new Set(punten.map((p) => p.versie))].sort((a, b) => b - a).filter((v) => alleenVersie == null || v === alleenVersie);
  if (!groepen.length) return <p className="stat-sub" style={{ margin: 0 }}>Nog geen verbeterpunten{alleenVersie != null ? ` op versie ${alleenVersie}` : ''}.</p>;
  return (
    <div className="punten-per-versie">
      {groepen.map((v) => {
        const lijst = punten.filter((p) => p.versie === v);
        const tel = (s: Punt['status']) => lijst.filter((p) => p.status === s).length;
        return (
          <section key={v} className="punten-versie" aria-label={`Verbeterpunten versie ${v}`}>
            <h3 className="tussenkop">Versie {v} <span className="bron">· {tel('OPEN')} open · {tel('IN_BEHANDELING')} in behandeling · {tel('KLAAR')} verwerkt · {tel('GEANNULEERD')} geannuleerd</span></h3>
            <ul className="punten">{lijst.map((p) => <PuntRegel key={p.id} p={p} beheer={beheer} versies={versies} onGewijzigd={onGewijzigd} />)}</ul>
          </section>
        );
      })}
    </div>
  );
}
