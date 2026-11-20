// Vereenvoudigde woningaanlevering (stap 3A.1). Een andere ingang op dezelfde workflow: er komt geen
// tweede proces bij. De makelaar vult alleen de naam of het adres in en voegt de verkoopbrochure toe.
// Daarna gebeurt precies wat het uitgebreide aanleverscherm ook doet, met dezelfde API's:
//   1. POST /api/projecten                        (eigen kantoor, profiel van het kantoor of 'buitenplaats')
//   2. POST /api/projecten/:id/bestanden?soort=brochure
//   3. POST /api/projecten/:id/verwerkingen        (brochure-import, met de bestaande beeldclassificatie)
// De server controleert bij elke stap het kantoorrecht (zelfde regels en RLS als altijd). De overige
// velden blijven in het datamodel en in het uitgebreide beheer van Rhadix; de import vult ze aan.
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiFout, upload, type Aanlevering, type Bestand, type Ik, type Kantoor, type Project, type Verwerking } from './api.ts';
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
  openingsbeeld: { gekozen: string | null; voorstel: string | null; norm: number | null };
  zonschaduw: { gewenst: boolean; bestand_id: string | null; adres: string | null; op: string } | null;
  fotos: (GalerijFoto & { geschikt_als_homepagefoto: boolean })[];
};
type Uitkomst = { status: 'beschikbaar' | 'bezet' | 'onbekend'; bron: string; op: string; reden?: string };

/** Woningpagina voor de makelaar: voortgang van de bestaande import, herkende gegevens en de drie keuzes. */
export function AangeleverdScherm({ id }: { id: string }) {
  const [d, setD] = useState<Aanlevering | null>(null);
  const [k, setK] = useState<Keuzes | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const laad = () => Promise.all([
    api<Aanlevering>(`/api/projecten/${id}/aanlevering`).then(setD),
    api<Keuzes>(`/api/projecten/${id}/keuzes`).then(setK),
  ]).catch((e) => setFout(e.message));
  useEffect(() => { void laad(); }, [id]);

  if (fout) return <p className="melding melding-fout" role="alert">{fout}</p>;
  if (!d || !k) return null;
  const lopend = d.verwerkingen.find((v) => v.soort === 'brochure-import' && (v.status === 'wachtrij' || v.status === 'bezig'));
  const laatste = d.verwerkingen.find((v) => v.soort === 'brochure-import');
  const klaar = !lopend && laatste?.status === 'klaar';
  const gegevens = d.gegevens.filter((g) => g.vastgelegd).length;
  const aandacht = d.gegevens.filter((g) => g.conflict || g.afwijking).length;
  const adresregel = [k.project.adres, [k.project.postcode, k.project.plaats].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  return (
    <div className="aanleveren">
      <PaginaTitel badge="Woning" titel={k.project.naam}
        sub={lopend ? 'De brochure wordt verwerkt. U kunt deze pagina sluiten; de verwerking gaat door.' : klaar ? 'Controleer de herkende gegevens en maak drie keuzes. Rhadix verzorgt daarna de verdere uitwerking.' : undefined} />

      <Kaart titel="Uit de brochure">
        {lopend ? <VerwerkingVoortgang key={lopend.id} projectId={id} start={lopend} onEinde={() => void laad()} />
          : laatste?.status === 'mislukt' ? <p className="melding melding-fout" role="alert">{laatste.melding ?? 'De verwerking is mislukt.'} Rhadix bekijkt de brochure.</p>
          : klaar ? (
            <dl className="herkend">
              <dt>Adres</dt><dd>{adresregel || <em>niet herkend; Rhadix vult dit aan</em>}</dd>
              <dt>Woningtype</dt><dd>{k.project.woningtype || <em>niet herkend</em>}</dd>
              <dt>Foto's</dt><dd>{k.fotos.length}</dd>
              <dt>Gegevens</dt><dd>{gegevens}{aandacht > 0 ? ` (${aandacht} ${aandacht === 1 ? 'vraagt' : 'vragen'} nog aandacht; Rhadix controleert dit)` : ''}</dd>
            </dl>
          ) : <p className="stat-sub">Nog niet gestart.</p>}
      </Kaart>

      {klaar && <>
        <DomeinKeuze id={id} k={k} />
        <HomepageFotoKeuze id={id} k={k} herlaad={laad} />
        <ZonSchaduwKeuze id={id} k={k} herlaad={laad} />
      </>}

      <div className="knoppen" style={{ marginTop: 20 }}>
        <a className="knop knop-primair" href="#/projecten" style={{ textDecoration: 'none' }}>Naar woningprojecten</a>
        <a className="knop knop-lijn" href="#/aanleveren" style={{ textDecoration: 'none' }}>Nog een woning aanleveren</a>
      </div>
    </div>
  );
}

function DomeinKeuze({ id, k }: { id: string; k: Keuzes }) {
  const [domein, setDomein] = useState(k.domein.wens?.domein ?? k.domein.voorstel ?? '');
  const [uitkomst, setUitkomst] = useState<Uitkomst | null>(k.domein.wens?.domein === domein ? k.domein.wens?.uitkomst ?? null : null);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  async function controleer() {
    setBezig(true); setFout(null);
    try { setUitkomst((await api<{ uitkomst: Uitkomst }>(`/api/projecten/${id}/keuzes/domein`, { methode: 'POST', data: { domein, controleer: true } })).uitkomst); }
    catch (x) { setFout(x instanceof ApiFout ? x.message : 'Het portaal is niet bereikbaar'); setUitkomst(null); }
    finally { setBezig(false); }
  }
  return (
    <Kaart titel="1. Domeinnaam">
      <p className="stat-sub">{k.domein.voorstel ? 'Voorgesteld op basis van het adres uit de brochure. U kunt de naam aanpassen.' : 'Vul de gewenste domeinnaam in.'}</p>
      <div className="domein-rij">
        <div className="veld" style={{ flex: '1 1 260px' }}>
          <label htmlFor="domein">Gewenste domeinnaam</label>
          <input id="domein" value={domein} onChange={(e) => { setDomein(e.target.value); setUitkomst(null); }} placeholder="bijvoorbeeld denekamperstraat23b.nl" autoComplete="off" inputMode="url" />
        </div>
        <button type="button" className="knop knop-primair" disabled={bezig || !domein.trim()} onClick={() => void controleer()}>{bezig ? 'Controleren…' : 'Controleer domeinnaam'}</button>
      </div>
      {fout && <p className="melding melding-fout" role="alert">{fout}</p>}
      {uitkomst && (
        <p className={`domein-uitkomst domein-${uitkomst.status}`} role="status">
          {uitkomst.status === 'beschikbaar' && <><strong>Beschikbaar.</strong> Deze naam is nog niet geregistreerd. Hij is nog <strong>niet gereserveerd</strong>: Rhadix verzorgt de registratie.</>}
          {uitkomst.status === 'bezet' && <><strong>Bezet.</strong> Deze naam is al geregistreerd. Kies een andere naam.</>}
          {uitkomst.status === 'onbekend' && <><strong>Controle niet mogelijk.</strong> {uitkomst.reden ?? ''} Uw wens is wel bewaard.</>}
          <span className="domein-bron">Bron: {uitkomst.bron}, {new Date(uitkomst.op).toLocaleString('nl-NL')}</span>
        </p>
      )}
      <p className="stat-sub">U koopt hier geen domeinnaam. Registratie, betaling en beheer verzorgt Rhadix.</p>
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
  const geschikt = k.fotos.filter((f) => f.geschikt_als_homepagefoto).length;
  return (
    <Kaart titel="2. Homepagefoto">
      <p className="stat-sub">Kies de foto die bovenaan de website komt. {k.openingsbeeld.norm ? `Geschikt: liggende foto's van minimaal ${k.openingsbeeld.norm} pixels breed (${geschikt} van ${k.fotos.length}).` : ''}</p>
      {fout && <p className="melding melding-fout" role="alert">{fout}</p>}
      <FotoGalerij label="Homepagefoto" fotos={k.fotos} gekozen={k.openingsbeeld.gekozen} voorstel={k.openingsbeeld.voorstel} bezig={bezig}
        onKies={(f) => void kies(f)} kiesbaar={(f) => (k.fotos.find((x) => x.id === f.id)?.geschikt_als_homepagefoto ? null : 'Te klein of staand')} />
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
        {gekozen ? <p className="domein-uitkomst domein-beschikbaar" role="status"><strong>Aangevraagd.</strong> Rhadix verzorgt de visualisatie en controleert de locatie en de foto.</p>
          : <p className="stat-sub">Nog geen foto gekozen; de aanvraag is pas vastgelegd als u een foto kiest.</p>}
      </>}
      {k.zonschaduw && !k.zonschaduw.gewenst && gewenst === false && <p className="stat-sub">Vastgelegd: geen zon- en schaduwvisualisatie.</p>}
    </Kaart>
  );
}
