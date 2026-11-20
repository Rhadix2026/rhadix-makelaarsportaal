// Inlogmelding en aandachtspaneel (migratie 016, docs/VOORSTEL-AANDACHTSPANEEL.md).
// Gegevens uitsluitend uit GET /api/aandacht (berekend onder de rijregels van de aanvrager). Het tijdstip
// 'bewust bekeken' wordt NIET hier gezet: niet door het dashboard en niet door 'Later', alleen door het openen
// van de lijst Verbeterpunten (Bekijk verbeterpunten). Bekijken verandert nooit de status van een punt.
import { useEffect, useState } from 'react';
import { api, type Ik } from '../api.ts';
import { Badge } from './basis.tsx';
import { STATUS_PUNT, type Punt } from './Verbeterpunten.tsx';

export type AandachtItem = {
  id: string; project_id: string; versie: number; onderdeel: string; tekst: string; status: Punt['status']; nieuw: boolean;
  heeft_reactie: boolean; verwerkt_in_versie: number | null; adres: string | null; plaats: string | null; project_naam: string; kantoor?: string;
};
export type AandachtBlok = { soort: 'verbeterpunten'; titel: string; rol: string; gezien_op: string | null; nieuw: number; open: number;
  afgehandeld: number; afgehandeld_nieuw: number; meer: boolean; items: AandachtItem[] };
export type Aandacht = { rol: 'platformbeheer' | 'kantoorbeheerder' | 'makelaar' | null; soorten: AandachtBlok[] };

const veilig = { lees: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  schrijf: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* geen opslag: alleen gemak */ } } };
export const puntLink = (i: { project_id: string; versie: number; id: string }) => `#/projecten/${i.project_id}/bekijken/v${i.versie}?punt=${i.id}`;
const plekVan = (i: AandachtItem) => [i.adres, i.plaats].filter(Boolean).join(', ') || i.project_naam;

/** Heeft deze rol iets dat aandacht vraagt? Platformbeheer: nieuw of open. Kantoor en makelaar: nieuwe reacties/afhandelingen. */
export const vraagtAandacht = (a: Aandacht | null) => !!a?.rol && a.soorten.some((b) => (a.rol === 'platformbeheer' ? b.nieuw + b.open : b.nieuw) > 0);

function samenvatting(b: AandachtBlok) {
  if (b.rol === 'platformbeheer') return `${b.nieuw} nieuw sinds uw laatste inzage · ${b.open} open of in behandeling`;
  const delen = [`${b.nieuw} nieuwe ${b.nieuw === 1 ? 'reactie of afhandeling' : 'reacties of afhandelingen'} van Rhadix`, `${b.open} open of in behandeling`];
  return delen.join(' · ');
}

/**
 * Compacte melding na het inloggen: maximaal één keer per aanmelding (sessiecode uit /api/ik; nieuwe tabbladen
 * binnen dezelfde aanmelding tonen hem niet opnieuw, een nieuwe aanmelding wel). Niet blokkerend.
 */
export function AandachtMelding({ ik }: { ik: Ik }) {
  const [a, setA] = useState<Aandacht | null>(null);
  const [open, setOpen] = useState(false);
  const sleutel = 'mp_melding_sessies';
  useEffect(() => {
    if (!ik.sessie) return;
    const getoond: string[] = JSON.parse(veilig.lees(sleutel) ?? '[]');
    if (getoond.includes(ik.sessie)) return;
    api<Aandacht>('/api/aandacht').then((r) => {
      // Ook als er niets te melden is: deze aanmelding is afgehandeld (geen melding later in dezelfde sessie).
      veilig.schrijf(sleutel, JSON.stringify([...getoond, ik.sessie].slice(-20)));
      if (vraagtAandacht(r)) { setA(r); setOpen(true); }
    }, () => {});
  }, [ik.sessie]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('keydown', esc); return () => removeEventListener('keydown', esc);
  }, [open]);
  if (!open || !a) return null;
  const b = a.soorten[0];
  return (
    <aside className="aandacht-melding" role="status" aria-label="Aandachtspunten">
      <div className="aandacht-melding-kop"><span className="aandacht-stip" aria-hidden="true" /> {a.rol === 'platformbeheer' ? 'Verbeterpunten' : 'Uw verbeterpunten'}</div>
      <p>{samenvatting(b)}</p>
      <div className="knoppen">
        <a className="knop knop-primair knop-klein" href="#/verbeterpunten" onClick={() => setOpen(false)} style={{ textDecoration: 'none' }}>Bekijk verbeterpunten</a>
        <button type="button" className="knop knop-lijn knop-klein" onClick={() => setOpen(false)}>Later</button>
      </div>
    </aside>
  );
}

/** Aandachtspaneel op het dashboard: inklapbaar (stand onthouden per kijker), maximaal acht regels per blok. */
export function AandachtPaneel() {
  const [a, setA] = useState<Aandacht | null>(null);
  const smal = typeof matchMedia === 'function' && matchMedia('(max-width: 1099px)').matches;
  const opgeslagen = veilig.lees('mp_aandacht_ingeklapt');
  const [dicht, setDicht] = useState(opgeslagen == null ? smal : opgeslagen === '1');
  useEffect(() => { api<Aandacht>('/api/aandacht').then(setA, () => {}); }, []);
  if (!a?.rol || !a.soorten.length) return null;
  const b = a.soorten[0];
  // Kantoor en makelaar: alleen tonen als er iets is (open of nieuw); platformbeheer altijd (werkvoorraad).
  if (a.rol !== 'platformbeheer' && !b.items.length && !b.nieuw) return null;
  const wissel = () => { const n = !dicht; setDicht(n); veilig.schrijf('mp_aandacht_ingeklapt', n ? '1' : '0'); };
  const titel = a.rol === 'makelaar' ? 'Mijn verbeterpunten' : a.rol === 'kantoorbeheerder' ? 'Verbeterpunten van uw kantoor' : 'Aandacht';
  return (
    <aside className={`aandacht-paneel${dicht ? ' aandacht-dicht' : ''}`} aria-label="Aandachtspunten">
      <button type="button" className="aandacht-paneel-kop" aria-expanded={!dicht} onClick={wissel}>
        <span>{titel}</span>
        <span className="aandacht-tellers">{b.open} open{b.nieuw ? <> · <strong>{b.nieuw} nieuw</strong></> : null}</span>
        <span aria-hidden="true" className="aandacht-pijl">{dicht ? '▾' : '▴'}</span>
      </button>
      {!dicht && (
        <div className="aandacht-inhoud">
          <div className="aandacht-blok-kop">{b.titel}
            <span className="bron">{a.rol === 'platformbeheer' ? ` · ${b.open} open · ${b.nieuw} nieuw` : ` · ${b.open} open · ${b.nieuw} nieuw · ${b.afgehandeld_nieuw} afgehandeld sinds uw laatste inzage`}</span></div>
          {b.items.length ? (
            <ul className="aandacht-lijst">
              {b.items.map((i) => {
                const [toon, label] = STATUS_PUNT[i.status];
                return (
                  <li key={i.id} className={i.nieuw ? 'aandacht-nieuw' : undefined}>
                    <a href={puntLink(i)}>
                      <span className="aandacht-regel1">{i.nieuw && <span className="aandacht-stip" aria-label="nieuw" />}<span className="aandacht-plek">{plekVan(i)}</span></span>
                      <span className="aandacht-regel2">{i.kantoor ? `${i.kantoor} · ` : ''}v{i.versie} · <Badge toon={toon}>{i.status === 'KLAAR' && i.verwerkt_in_versie ? `${label} in v${i.verwerkt_in_versie}` : label}</Badge>{i.heeft_reactie && i.status !== 'OPEN' ? ' · reactie' : ''}</span>
                      <span className="aandacht-tekst">{i.tekst.length > 60 ? `${i.tekst.slice(0, 60)}…` : i.tekst}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : <p className="stat-sub" style={{ margin: 0 }}>Geen openstaande verbeterpunten.</p>}
          <a className="aandacht-alle" href="#/verbeterpunten">{b.meer ? 'Meer verbeterpunten' : 'Alle verbeterpunten'} →</a>
        </div>
      )}
    </aside>
  );
}
