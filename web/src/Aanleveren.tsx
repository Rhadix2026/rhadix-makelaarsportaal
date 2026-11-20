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

/** Na het aanleveren: de voortgang van de bestaande brochure-import en een korte samenvatting. */
export function AangeleverdScherm({ id }: { id: string }) {
  const [d, setD] = useState<Aanlevering | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const laad = () => api<Aanlevering>(`/api/projecten/${id}/aanlevering`).then(setD, (e) => setFout(e.message));
  useEffect(() => { void laad(); }, [id]);

  if (fout) return <p className="melding melding-fout" role="alert">{fout}</p>;
  if (!d) return null;
  const lopend = d.verwerkingen.find((v) => v.soort === 'brochure-import' && (v.status === 'wachtrij' || v.status === 'bezig'));
  const laatste = d.verwerkingen.find((v) => v.soort === 'brochure-import');
  const actief = d.bestanden.filter((b) => !b.vervallen);
  const fotos = actief.filter((b) => b.soort === 'foto').length;
  const gegevens = d.gegevens.filter((g) => g.vastgelegd).length;
  const aandacht = d.gegevens.filter((g) => g.conflict || g.afwijking).length;

  return (
    <div className="aanleveren">
      <PaginaTitel badge="Aangeleverd" titel={d.project.naam}
        sub={lopend ? 'De brochure wordt verwerkt. U kunt deze pagina sluiten; de verwerking gaat door.' : 'Rhadix neemt de woning vanaf hier over.'} />
      <Kaart titel="Brochureverwerking">
        {lopend ? <VerwerkingVoortgang key={lopend.id} projectId={id} start={lopend} onEinde={() => void laad()} />
          : laatste?.status === 'mislukt' ? <p className="melding melding-fout" role="alert">{laatste.melding ?? 'De verwerking is mislukt.'} Rhadix bekijkt de brochure.</p>
          : laatste?.status === 'klaar' ? (
            <div className="raster raster-2" style={{ gap: 12 }}>
              <div><div className="stat-waarde">{fotos}</div><div className="stat-label">foto's uit de brochure</div></div>
              <div><div className="stat-waarde">{gegevens}</div><div className="stat-label">woninggegevens gevonden</div></div>
            </div>
          ) : <p className="stat-sub">Nog niet gestart.</p>}
        {laatste?.status === 'klaar' && aandacht > 0 && (
          <p className="stat-sub">{aandacht} {aandacht === 1 ? 'gegeven vraagt' : 'gegevens vragen'} nog aandacht; Rhadix controleert dit.</p>)}
      </Kaart>
      <div className="knoppen" style={{ marginTop: 20 }}>
        <a className="knop knop-primair" href="#/projecten" style={{ textDecoration: 'none' }}>Naar woningprojecten</a>
        <a className="knop knop-lijn" href="#/aanleveren" style={{ textDecoration: 'none' }}>Nog een woning aanleveren</a>
      </div>
    </div>
  );
}
