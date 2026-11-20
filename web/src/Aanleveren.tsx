// Vereenvoudigde woningaanlevering (stap 3A.1). Een andere ingang op dezelfde workflow: er komt geen
// tweede proces bij. De makelaar vult alleen de naam of het adres in en voegt de verkoopbrochure toe.
// Daarna gebeurt precies wat het uitgebreide aanleverscherm ook doet, met dezelfde API's:
//   1. POST /api/projecten                        (eigen kantoor, profiel van het kantoor of 'buitenplaats')
//   2. POST /api/projecten/:id/bestanden?soort=brochure
//   3. POST /api/projecten/:id/verwerkingen        (brochure-import, met de bestaande beeldclassificatie)
// De server controleert bij elke stap het kantoorrecht (zelfde regels en RLS als altijd). De overige
// velden blijven in het datamodel en in het uitgebreide beheer van Rhadix; de import vult ze aan.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiFout, upload, type Aanlevering, type Bestand, type ConceptenOverzicht, type Ik, type Kantoor, type Project, type Verwerking } from './api.ts';
import { Kaart, PaginaTitel } from './onderdelen/basis.tsx';
import { VerwerkingVoortgang } from './onderdelen/VerwerkingVoortgang.tsx';
import { FotoGalerij, type GalerijFoto } from './onderdelen/FotoGalerij.tsx';

export const STANDAARD_PROFIEL = 'buitenplaats';

type Stap = 'project' | 'upload' | 'import';

export function AanleverFormulier({ ik }: { ik: Ik }) {
  const [kantoren, setKantoren] = useState<Kantoor[] | null>(null);
  const [naam, setNaam] = useState('');
  const [brochure, setBrochure] = useState<File | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [veldfout, setVeldfout] = useState<{ naam?: string; brochure?: string }>({});
  const [bezig, setBezig] = useState<Stap | null>(null);
  const [voortgang, setVoortgang] = useState(0);
  // Is het project al aangemaakt en mislukt daarna iets, dan gaan we bij een nieuwe poging verder
  // met hetzelfde project (geen dubbele woningprojecten).
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => { api<Kantoor[]>('/api/kantoren').then(setKantoren, () => setKantoren([])); }, []);

  // Het kantoor volgt uit de eigen Rhadix-organisatie; de makelaar kiest het niet.
  const eigen = (kantoren ?? []).filter((k) => k.status === 'actief' && ik.kantoren.some((m) => m.id === k.id));
  const kantoor = eigen.length === 1 ? eigen[0] : null;

  async function verstuur(e: FormEvent) {
    e.preventDefault();
    setFout(null);
    const vf: typeof veldfout = {};
    if (!project && !naam.trim()) vf.naam = 'Vul de naam of het adres van de woning in';
    if (!brochure) vf.brochure = 'Voeg de verkoopbrochure toe (PDF)';
    else if (!/\.pdf$/i.test(brochure.name) && brochure.type !== 'application/pdf') vf.brochure = 'Alleen een PDF-bestand';
    setVeldfout(vf);
    if (Object.keys(vf).length || !kantoor || !brochure) return;
    try {
      let p = project;
      if (!p) {
        setBezig('project');
        p = await api<Project>('/api/projecten', { methode: 'POST', data: {
          kantoor_id: kantoor.id, naam: naam.trim(), profiel: kantoor.standaard_profiel || STANDAARD_PROFIEL } });
        setProject(p);
      }
      setBezig('upload'); setVoortgang(0);
      await upload<Bestand>(`/api/projecten/${p.id}/bestanden?soort=brochure`, brochure, setVoortgang);
      setBezig('import');
      await api<Verwerking>(`/api/projecten/${p.id}/verwerkingen`, { methode: 'POST', data: { soort: 'brochure-import' } });
      location.hash = `#/projecten/${p.id}/aangeleverd`;
    } catch (x) {
      setFout(x instanceof ApiFout ? x.message : 'Het portaal is niet bereikbaar');
      setBezig(null);
    }
  }

  if (kantoren === null) return null;
  if (!kantoor) return (
    <>
      <PaginaTitel titel="Woning aanleveren" />
      <p className="melding melding-fout" role="alert">
        {eigen.length === 0 ? 'Uw account is nog niet aan een actief makelaarskantoor gekoppeld.' : 'Uw account hoort bij meer dan één kantoor.'} Neem contact op met Rhadix.
      </p>
    </>
  );

  const knopTekst = bezig === 'project' ? 'Woning aanmaken…' : bezig === 'upload' ? `Brochure uploaden… ${Math.round(voortgang * 100)}%`
    : bezig === 'import' ? 'Verwerking starten…' : project ? 'Opnieuw proberen' : 'Woning aanleveren';

  return (
    <div className="aanleveren">
      <PaginaTitel badge="Nieuwe woning" titel="Woning aanleveren"
        sub="Vul de naam of het adres in en voeg de verkoopbrochure toe. Rhadix haalt de gegevens en foto's uit de brochure en verzorgt de verdere uitwerking." />
      <Kaart>
        <form className="formulier" onSubmit={verstuur} noValidate>
          {fout && <p className="melding melding-fout" role="alert">{fout}{project ? ' De woning is al aangemaakt; met "Opnieuw proberen" gaat u verder met dezelfde woning.' : ''}</p>}
          <div className={`veld${veldfout.naam ? ' veld-fout' : ''}`}>
            <label htmlFor="naam">Naam of adres van de woning</label>
            <input id="naam" value={project ? project.naam : naam} onChange={(e) => setNaam(e.target.value)} disabled={!!project || !!bezig}
              placeholder="Bijvoorbeeld Denekamperstraat 23B, Beuningen" autoComplete="off" aria-describedby={veldfout.naam ? 'naam-fout' : undefined} />
            {veldfout.naam && <span id="naam-fout" className="fout">{veldfout.naam}</span>}
          </div>
          <div className={`veld${veldfout.brochure ? ' veld-fout' : ''}`}>
            <label htmlFor="brochure">Verkoopbrochure (PDF)</label>
            <input id="brochure" type="file" accept="application/pdf,.pdf" disabled={!!bezig}
              onChange={(e) => setBrochure(e.target.files?.[0] ?? null)} aria-describedby={veldfout.brochure ? 'brochure-fout' : 'brochure-hint'} />
            {veldfout.brochure ? <span id="brochure-fout" className="fout">{veldfout.brochure}</span>
              : <span id="brochure-hint" className="hint">Maximaal 150 MB. Gegevens en foto's uit de brochure hoeft u niet opnieuw in te vullen.</span>}
          </div>
          <div className="knoppen">
            <button type="submit" className="knop knop-primair" disabled={!!bezig}>{knopTekst}</button>
            <a className="knop knop-lijn" href="#/projecten" style={{ textDecoration: 'none' }}>Annuleren</a>
          </div>
          <p className="stat-sub" style={{ margin: 0 }}>Kantoor: {kantoor.merknaam}</p>
        </form>
      </Kaart>
    </div>
  );
}

type Keuzes = {
  project: { id: string; naam: string; adres: string | null; postcode: string | null; plaats: string | null; woningtype: string | null; status: string };
  domein: { voorstel: string | null; wens: { domein: string | null; uitkomst: Uitkomst | null; op: string } | null; definitief: string | null };
  openingsbeeld: { gekozen: string | null; voorstel: string | null; norm: number | null; minimum: number };
  zonschaduw: { gewenst: boolean; bestand_id: string | null; adres: string | null; op: string } | null;
  fotos: (GalerijFoto & { geschikt_als_homepagefoto: boolean; kwaliteit: 'goed' | 'beperkt' | null })[];
};
type Uitkomst = { status: 'beschikbaar' | 'bezet' | 'onbekend'; bron: string; op: string; reden?: string };
/** Wat het domeinblok toont: een voorstel (nog niet gecontroleerd), een uitslag van het register, of ongeldig. */
type DomeinStatus = { soort: 'voorstel' } | { soort: 'ongeldig'; melding: string } | { soort: 'uitslag'; uitkomst: Uitkomst } | null;

// Zelfde regel als de server (keuzes.ts: geldigNlDomein); de server controleert altijd opnieuw.
const NL_DOMEIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.nl$/;
const normaliseer = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
const geldigDomein = (d: string) => NL_DOMEIN.test(d) && !/^..--/.test(d);
const ONGELDIG = 'Dit is geen geldige .nl-domeinnaam. Gebruik alleen letters, cijfers en koppeltekens, en eindig op .nl (bijvoorbeeld beusemkolkweg16.nl).';

/** Woningpagina voor de makelaar: voortgang van de bestaande import, herkende gegevens, de drie keuzes en het concept. */
export function AangeleverdScherm({ id }: { id: string }) {
  const [data, setData] = useState<{ d: Aanlevering; k: Keuzes; c: ConceptenOverzicht } | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  // Alles tegelijk laden en in één keer zetten: anders kan de pagina na de import met verouderde keuzes
  // (van vóór de import, zonder adres) openklappen. Dat was de oorzaak van het lege domeinveld.
  const laad = useCallback(async () => {
    try {
      const [d, k, c] = await Promise.all([
        api<Aanlevering>(`/api/projecten/${id}/aanlevering`), api<Keuzes>(`/api/projecten/${id}/keuzes`), api<ConceptenOverzicht>(`/api/projecten/${id}/concepten`)]);
      setData({ d, k, c });
    } catch (e) { setFout((e as Error).message); }
  }, [id]);
  useEffect(() => { void laad(); }, [laad]);
  // Domeininvoer op paginaniveau: bij "Conceptwebsite aanmaken" wordt een nog niet bewaarde wens vastgelegd.
  const [domein, setDomein] = useState<{ waarde: string; eigen: boolean } | null>(null);

  if (fout) return <p className="melding melding-fout" role="alert">{fout}</p>;
  if (!data) return null;
  const { d, k, c } = data;
  const lopend = d.verwerkingen.find((v) => v.soort === 'brochure-import' && (v.status === 'wachtrij' || v.status === 'bezig'));
  const laatste = d.verwerkingen.find((v) => v.soort === 'brochure-import');
  const klaar = !lopend && laatste?.status === 'klaar';
  const gegevens = d.gegevens.filter((g) => g.vastgelegd).length;
  const aandacht = d.gegevens.filter((g) => g.conflict || g.afwijking).length;
  const adresregel = [k.project.adres, [k.project.postcode, k.project.plaats].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  // Titel: het woningadres (de makelaar herkent het object direct). De projectnaam blijft ongewijzigd en staat eronder.
  const titel = k.project.adres ? [k.project.adres, k.project.plaats].filter(Boolean).join(', ') : k.project.naam;
  const naamApart = !!k.project.adres && k.project.naam.trim().toLowerCase() !== titel.toLowerCase() && k.project.naam.trim().toLowerCase() !== (k.project.adres ?? '').toLowerCase();
  const domeinWaarde = domein?.eigen ? domein.waarde : (k.domein.wens?.domein ?? domein?.waarde ?? k.domein.voorstel ?? '');

  return (
    <div className="aanleveren">
      <PaginaTitel badge="Woning" titel={titel}
        sub={lopend ? 'De brochure wordt verwerkt. U kunt deze pagina sluiten; de verwerking gaat door.' : klaar ? 'Controleer de herkende gegevens, maak drie keuzes en maak daarna de conceptwebsite aan.' : undefined} />
      {naamApart && <p className="interne-naam">Projectnaam: {k.project.naam}</p>}

      <Kaart titel="Uit de brochure">
        {lopend ? <VerwerkingVoortgang key={lopend.id} projectId={id} start={lopend} onEinde={() => void laad()} />
          : laatste?.status === 'mislukt' ? <p className="melding melding-fout" role="alert">{laatste.melding ?? 'De verwerking is mislukt.'} Rhadix bekijkt de brochure.</p>
          : klaar ? (
            <dl className="herkend">
              <dt>Adres</dt><dd>{adresregel || <em>niet herkend; Rhadix vult dit aan</em>}</dd>
              {/* Woningtype is niet nodig voor de website (het ontwerp hangt er niet van af): alleen tonen als het herkend is. */}
              {k.project.woningtype && <><dt>Woningtype</dt><dd>{k.project.woningtype}</dd></>}
              <dt>Foto's</dt><dd>{k.fotos.length}</dd>
              <dt>Gegevens</dt><dd>{gegevens}{aandacht > 0 ? ` (${aandacht} ${aandacht === 1 ? 'vraagt' : 'vragen'} nog aandacht; Rhadix controleert dit)` : ''}</dd>
            </dl>
          ) : <p className="stat-sub">Nog niet gestart.</p>}
      </Kaart>

      {klaar && <>
        <DomeinKeuze key={k.domein.voorstel ?? 'geen'} id={id} k={k} waarde={domeinWaarde} eigen={!!domein?.eigen || !!k.domein.wens?.domein}
          onWijzig={(w) => setDomein({ waarde: w, eigen: true })} onBewaard={() => void laad()} />
        <HomepageFotoKeuze id={id} k={k} herlaad={laad} />
        <ZonSchaduwKeuze id={id} k={k} herlaad={laad} />
        <ConceptAanmaken id={id} k={k} c={c} domein={domeinWaarde} herlaad={laad} />
      </>}

      <div className="knoppen" style={{ marginTop: 20 }}>
        <a className="knop knop-lijn" href="#/projecten" style={{ textDecoration: 'none' }}>Naar woningprojecten</a>
        <a className="knop knop-lijn" href="#/aanleveren" style={{ textDecoration: 'none' }}>Nog een woning aanleveren</a>
      </div>
    </div>
  );
}

function DomeinKeuze({ id, k, waarde, eigen, onWijzig, onBewaard }: {
  id: string; k: Keuzes; waarde: string; eigen: boolean; onWijzig: (w: string) => void; onBewaard: () => void;
}) {
  const bewaard = k.domein.wens;
  const begin: DomeinStatus = bewaard?.domein && bewaard.domein === waarde && bewaard.uitkomst ? { soort: 'uitslag', uitkomst: bewaard.uitkomst }
    : !eigen && waarde && waarde === k.domein.voorstel ? { soort: 'voorstel' } : null;
  const [status, setStatus] = useState<DomeinStatus>(begin);
  const [bezig, setBezig] = useState(false);
  async function controleer() {
    const d = normaliseer(waarde);
    if (!geldigDomein(d)) { setStatus({ soort: 'ongeldig', melding: ONGELDIG }); return; }
    if (d !== waarde) onWijzig(d);
    setBezig(true);
    try {
      const r = await api<{ uitkomst: Uitkomst }>(`/api/projecten/${id}/keuzes/domein`, { methode: 'POST', data: { domein: d, controleer: true } });
      setStatus({ soort: 'uitslag', uitkomst: r.uitkomst }); onBewaard();
    } catch (x) {
      if (x instanceof ApiFout && x.status === 400) setStatus({ soort: 'ongeldig', melding: x.message });
      else setStatus({ soort: 'uitslag', uitkomst: { status: 'onbekend', bron: 'Makelaarsportaal', op: new Date().toISOString(), reden: x instanceof ApiFout ? x.message : 'Het portaal is niet bereikbaar.' } });
    } finally { setBezig(false); }
  }
  return (
    <Kaart titel="1. Domeinnaam">
      <p className="stat-sub">{k.domein.voorstel ? 'Hieronder staat een voorstel op basis van het adres uit de brochure. U kunt de naam aanpassen en daarna controleren of hij nog vrij is.' : 'Vul de gewenste domeinnaam in en controleer of hij nog vrij is.'}</p>
      <div className="domein-rij">
        <div className="veld" style={{ flex: '1 1 260px' }}>
          <label htmlFor="domein">Gewenste domeinnaam</label>
          <input id="domein" value={waarde} onChange={(e) => { onWijzig(e.target.value); setStatus(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!bezig && waarde.trim()) void controleer(); } }}
            placeholder="bijvoorbeeld beusemkolkweg16.nl" autoComplete="off" inputMode="url" spellCheck={false} aria-describedby="domein-status" />
        </div>
        <button type="button" className="knop knop-primair" disabled={bezig || !waarde.trim()} onClick={() => void controleer()}>{bezig ? 'Controleren…' : 'Controleer domeinnaam'}</button>
      </div>
      <div id="domein-status" aria-live="polite">
        {bezig && <p className="domein-uitkomst domein-voorstel" role="status"><span>Bezig met controleren bij het .nl-register…</span></p>}
        {!bezig && status?.soort === 'voorstel' && (
          <p className="domein-uitkomst domein-voorstel" role="status"><span><span className="domein-label">Voorstel</span> Nog niet gecontroleerd. Klik op <strong>Controleer domeinnaam</strong> om te zien of deze naam nog vrij is.</span></p>)}
        {!bezig && status?.soort === 'ongeldig' && (
          <p className="domein-uitkomst domein-ongeldig" role="alert"><span><span className="domein-label">Ongeldig</span> {status.melding}</span></p>)}
        {!bezig && status?.soort === 'uitslag' && (
          <p className={`domein-uitkomst domein-${status.uitkomst.status}`} role="status">
            <span>
              {status.uitkomst.status === 'beschikbaar' && <><span className="domein-label">Gecontroleerd · beschikbaar</span> Deze naam is nog niet geregistreerd. Hij is <strong>niet gereserveerd</strong>: Rhadix verzorgt de registratie.</>}
              {status.uitkomst.status === 'bezet' && <><span className="domein-label">Gecontroleerd · bezet</span> Deze naam is al geregistreerd. Kies een andere naam.</>}
              {status.uitkomst.status === 'onbekend' && <><span className="domein-label">Controle tijdelijk niet mogelijk</span> {status.uitkomst.reden ?? ''} Uw wens is wel bewaard; Rhadix controleert de naam later.</>}
            </span>
            <span className="domein-bron">Bron: {status.uitkomst.bron}, {new Date(status.uitkomst.op).toLocaleString('nl-NL')}</span>
          </p>)}
      </div>
      <p className="stat-sub">U koopt hier geen domeinnaam. Registratie, betaling en beheer verzorgt Rhadix. De domeinnaam houdt de conceptwebsite niet tegen: het concept krijgt eerst een tijdelijk adres.</p>
    </Kaart>
  );
}

function HomepageFotoKeuze({ id, k, herlaad }: { id: string; k: Keuzes; herlaad: () => void }) {
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  async function kies(bestand: string) {
    setBezig(true); setFout(null);
    try { await api(`/api/projecten/${id}/beslissingen/openingsbeeld`, { methode: 'PUT', data: { bestand_id: bestand } }); herlaad(); }
    catch (x) { setFout(x instanceof ApiFout ? x.message : 'Het portaal is niet bereikbaar'); }
    finally { setBezig(false); }
  }
  const kwaliteit = new Map(k.fotos.map((f) => [f.id, f.kwaliteit]));
  const goed = k.fotos.filter((f) => f.kwaliteit === 'goed').length;
  const kiesbaar = k.fotos.filter((f) => f.kwaliteit).length;
  const gekozen = k.fotos.find((f) => f.id === k.openingsbeeld.gekozen);
  return (
    <Kaart titel="2. Homepagefoto">
      <p className="stat-sub">Kies de foto die bovenaan de website komt. U kunt kiezen uit {kiesbaar} liggende foto's{k.openingsbeeld.norm ? `; ${goed} daarvan ${goed === 1 ? 'is' : 'zijn'} minimaal ${k.openingsbeeld.norm} pixels breed (beste beeldkwaliteit)` : ''}.
        {k.openingsbeeld.voorstel ? ' Het automatische voorstel is gemarkeerd.' : ''}</p>
      {fout && <p className="melding melding-fout" role="alert">{fout}</p>}
      <FotoGalerij label="Homepagefoto" fotos={k.fotos} gekozen={k.openingsbeeld.gekozen} voorstel={k.openingsbeeld.voorstel} bezig={bezig}
        onKies={(f) => void kies(f)}
        kiesbaar={(f) => (kwaliteit.get(f.id) ? null : f.hoogte > f.breedte / 1.2 ? 'Staand: niet geschikt' : `Kleiner dan ${k.openingsbeeld.minimum} px`)}
        waarschuwing={(f) => (kwaliteit.get(f.id) === 'beperkt' ? 'Lagere resolutie' : null)} />
      {gekozen?.kwaliteit === 'beperkt' && <p className="melding melding-let-op" role="status" style={{ marginTop: 12 }}>
        De gekozen foto is {gekozen.breedte} pixels breed{k.openingsbeeld.norm ? ` (aanbevolen: ${k.openingsbeeld.norm})` : ''}. Op grote schermen kan hij minder scherp ogen. Heeft u het originele bestand, dan kan Rhadix dat later gebruiken.</p>}
    </Kaart>
  );
}

function ZonSchaduwKeuze({ id, k, herlaad }: { id: string; k: Keuzes; herlaad: () => void }) {
  const [gewenst, setGewenst] = useState<boolean | null>(k.zonschaduw ? k.zonschaduw.gewenst : null);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  async function bewaar(g: boolean, bestand: string | null) {
    setBezig(true); setFout(null);
    try { await api(`/api/projecten/${id}/keuzes/zonschaduw`, { methode: 'PUT', data: { gewenst: g, bestand_id: bestand } }); herlaad(); }
    catch (x) { setFout(x instanceof ApiFout ? x.message : 'Het portaal is niet bereikbaar'); }
    finally { setBezig(false); }
  }
  const gekozen = k.zonschaduw?.gewenst ? k.zonschaduw.bestand_id : null;
  return (
    <Kaart titel="3. Zon- en schaduwvisualisatie">
      <fieldset className="keuze-ja-nee" disabled={bezig}>
        <legend>Zon- en schaduwvisualisatie gewenst?</legend>
        <label><input type="radio" name="zon" checked={gewenst === true} onChange={() => setGewenst(true)} /> Ja</label>
        <label><input type="radio" name="zon" checked={gewenst === false} onChange={() => { setGewenst(false); void bewaar(false, null); }} /> Nee</label>
      </fieldset>
      {fout && <p className="melding melding-fout" role="alert">{fout}</p>}
      {gewenst === true && <>
        <p className="stat-sub">Kies een foto waarop het pand of de tuin duidelijk herkenbaar is. Als locatie gebruikt Rhadix het adres uit de brochure{k.project.adres ? ` (${k.project.adres}${k.project.plaats ? `, ${k.project.plaats}` : ''})` : ''} en controleert die.</p>
        <FotoGalerij label="Foto voor de zon- en schaduwvisualisatie" fotos={k.fotos} gekozen={gekozen} bezig={bezig} onKies={(f) => void bewaar(true, f)} />
        {gekozen ? <p className="domein-uitkomst domein-beschikbaar" role="status"><span><strong>Aangevraagd.</strong> Rhadix verzorgt de visualisatie en controleert de locatie en de foto.</span></p>
          : <p className="stat-sub">Nog geen foto gekozen; de aanvraag is pas vastgelegd als u een foto kiest.</p>}
      </>}
      {k.zonschaduw && !k.zonschaduw.gewenst && gewenst === false && <p className="stat-sub">Vastgelegd: geen zon- en schaduwvisualisatie.</p>}
    </Kaart>
  );
}

/**
 * Afronding: de conceptwebsite aanmaken met de bestaande route. Geen tweede generator:
 *   1. een nog niet bewaarde domeinwens vastleggen (POST keuzes/domein, zonder controle);
 *   2. POST /api/projecten/:id/snelle-beoordeling: bron overnemen als uitgangspunt, de gekozen homepagefoto,
 *      het tijdelijke conceptadres, de bestaande kwaliteitscontrole en de vrijgave voor conceptgeneratie;
 *   3. POST /api/projecten/:id/concepten: de bestaande conceptgeneratie (verwerkingswachtrij);
 *   4. de bestaande voortgangsbalk (VerwerkingVoortgang) tot het concept klaar is.
 * Dubbel starten: de knop is tijdens het hele traject geblokkeerd, en de server weigert een tweede
 * lopende verwerking (unieke index verwerking_een_lopend).
 */
function ConceptAanmaken({ id, k, c, domein, herlaad }: { id: string; k: Keuzes; c: ConceptenOverzicht; domein: string; herlaad: () => Promise<void> }) {
  const [stap, setStap] = useState<string | null>(null);
  const [melding, setMelding] = useState<{ toon: 'goed' | 'fout' | 'let-op'; tekst: string; open?: string[] } | null>(null);
  const [gestart, setGestart] = useState<Verwerking | null>(null);
  const lopend = gestart ?? (c.generatie && ['wachtrij', 'bezig'].includes(c.generatie.status) ? c.generatie : null);
  const nieuwste = c.concepten[0] ?? null;

  const foto = !!k.openingsbeeld.gekozen;
  const zon = !!k.zonschaduw && (!k.zonschaduw.gewenst || !!k.zonschaduw.bestand_id);
  const dn = normaliseer(domein);
  const domeinTekst = k.domein.wens?.domein
    ? `${k.domein.wens.domein}${k.domein.wens.uitkomst ? ` (${({ beschikbaar: 'beschikbaar', bezet: 'bezet', onbekend: 'controle niet mogelijk' } as const)[k.domein.wens.uitkomst.status]})` : ' (opgegeven, niet gecontroleerd)'}`
    : dn ? `${dn} (wordt bewaard als wens, niet gecontroleerd)` : 'geen wens; Rhadix kiest later';
  const kan = foto && zon && !stap && !lopend;

  async function maakAan() {
    setMelding(null);
    try {
      if (dn && geldigDomein(dn) && dn !== k.domein.wens?.domein) {
        setStap('Uw domeinwens wordt bewaard…');
        await api(`/api/projecten/${id}/keuzes/domein`, { methode: 'POST', data: { domein: dn, controleer: false } });
      }
      setStap('Gegevens vastleggen en controleren…');
      const sb = await api<{ open: { titel: string; actie: string | null }[] }>(`/api/projecten/${id}/snelle-beoordeling`,
        { methode: 'POST', data: { overnemen: true, openingsbeeld: k.openingsbeeld.gekozen } });
      if (sb.open.length) {
        setMelding({ toon: 'let-op', tekst: 'De conceptwebsite kan nog niet worden aangemaakt. Uw keuzes zijn bewaard; Rhadix lost het volgende op en maakt dan het concept:', open: sb.open.map((x) => x.actie ?? x.titel) });
        return;
      }
      setStap('Conceptgeneratie wordt gestart…');
      const v = await api<Verwerking>(`/api/projecten/${id}/concepten`, { methode: 'POST' });
      setGestart({ ...v, soort: 'conceptgeneratie' });
      setMelding({ toon: 'goed', tekst: 'De conceptwebsite wordt gemaakt. U kunt deze pagina sluiten; de verwerking gaat door.' });
    } catch (x) {
      setMelding({ toon: 'fout', tekst: x instanceof ApiFout ? x.message : 'Het portaal is niet bereikbaar. Probeer het opnieuw.' });
    } finally { setStap(null); void herlaad(); }
  }
  const einde = (n: Verwerking) => {
    setGestart(null);
    if (n.status === 'klaar') setMelding({ toon: 'goed', tekst: `De conceptwebsite is klaar${n.concept ? ` (versie ${n.concept.versie})` : ''}.` });
    else setMelding({ toon: 'fout', tekst: n.melding ?? 'De conceptgeneratie is niet gelukt. Rhadix is op de hoogte en bekijkt het.' });
    void herlaad();
  };

  return (
    <Kaart titel="4. Conceptwebsite">
      <ul className="concept-stappen" aria-label="Uw keuzes">
        <li><span className="vink-ok">✓</span><span>Gegevens uit de brochure: worden overgenomen als uitgangspunt; Rhadix controleert ze vóór publicatie.</span></li>
        <li><span className="vink-ok">✓</span><span>Domeinnaam: {domeinTekst}</span></li>
        <li><span className={foto ? 'vink-ok' : 'vink-open'}>{foto ? '✓' : '○'}</span><span>Homepagefoto: {foto ? 'gekozen' : 'kies eerst een foto (stap 2)'}</span></li>
        <li><span className={zon ? 'vink-ok' : 'vink-open'}>{zon ? '✓' : '○'}</span><span>Zon- en schaduwvisualisatie: {!k.zonschaduw ? 'kies ja of nee (stap 3)' : !k.zonschaduw.gewenst ? 'niet gewenst' : k.zonschaduw.bestand_id ? 'aangevraagd. De simulatie zelf is nog niet beschikbaar; in de afgeschermde preview staat een interne plaatshouder die niet wordt gepubliceerd' : 'kies een foto (stap 3)'}</span></li>
      </ul>

      {lopend && <VerwerkingVoortgang key={lopend.id} projectId={id} start={lopend} onEinde={einde} />}
      {melding && <div className={`melding melding-${melding.toon}`} role={melding.toon === 'fout' ? 'alert' : 'status'} style={{ marginBottom: 12 }}>
        {melding.tekst}{melding.open && <ul style={{ margin: '6px 0 0' }}>{melding.open.map((t) => <li key={t}>{t}</li>)}</ul>}</div>}
      {!lopend && nieuwste && <p className="domein-uitkomst domein-beschikbaar" role="status">
        <span><strong>Conceptwebsite versie {nieuwste.versie}</strong> gemaakt op {new Date(nieuwste.aangemaakt_op).toLocaleString('nl-NL')}. Het concept is afgeschermd en niet gepubliceerd.</span>
        <span><a href={`/api/voorbeeld/${nieuwste.voorbeeld_token}/`} target="_blank" rel="noreferrer noopener">Concept bekijken (nieuw tabblad) →</a>{' · '}<a href={`#/projecten/${id}/concept/v${nieuwste.versie}`}>Verbeterpunten doorgeven</a></span></p>}

      <div className="knoppen">
        <button type="button" className="knop knop-primair" disabled={!kan} onClick={() => void maakAan()}>
          {stap ?? (lopend ? 'Conceptwebsite wordt gemaakt…' : nieuwste ? 'Nieuwe conceptversie aanmaken' : 'Conceptwebsite aanmaken')}</button>
      </div>
      <p className="stat-sub">{nieuwste ? 'Heeft u een keuze gewijzigd? Maak dan een nieuwe conceptversie; eerdere versies blijven bewaard.' : 'Er wordt niets gepubliceerd. Rhadix beoordeelt het concept voordat het online gaat.'}</p>
    </Kaart>
  );
}
