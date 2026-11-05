// Kleine fetch-hulp voor de studio-API. Het sessiecookie gaat automatisch mee (zelfde herkomst).
export class ApiFout extends Error {
  constructor(public status: number, message: string, public fouten: Record<string, string> = {}) { super(message); }
}

export async function api<T>(pad: string, opties: { methode?: string; data?: unknown } = {}): Promise<T> {
  const r = await fetch(pad, {
    method: opties.methode ?? 'GET',
    headers: opties.data !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: opties.data !== undefined ? JSON.stringify(opties.data) : undefined,
    credentials: 'same-origin',
  });
  const body = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (r.status === 401 && pad !== '/api/inloggen') window.dispatchEvent(new Event('studio:uitgelogd'));
  if (!r.ok) throw new ApiFout(r.status, body?.fout ?? `Fout ${r.status}`, body?.fouten ?? {});
  return body as T;
}

export type Ik = { id: string; email: string; naam: string; platformbeheer: boolean; kantoren: { id: string; naam: string; rol: string }[] };

export type Kantoor = {
  id: string; merknaam: string; juridische_naam: string | null; slug: string; telefoon: string | null; email: string | null; website: string | null;
  adresregels: string[]; standaard_profiel: string | null; merkkleur: string | null; detailkleur: string | null; status: 'actief' | 'inactief';
  huisstijl_herkomst: 'handmatig' | 'logo' | null; logo_id: string | null;
  aangemaakt_op: string; gewijzigd_op: string; gebruikers?: number;
  leden?: { id: string; naam: string; email: string; rol: string }[];
};

export type Project = {
  id: string; kantoor_id: string; kantoor: string; kantoor_slug: string; slug: string; naam: string;
  adres: string | null; postcode: string | null; plaats: string | null; woningtype: string | null; profiel: string | null;
  ontwerpsysteem: string; domein: string | null; contactpersoon: string | null; status: string;
  aangemaakt_op: string; gewijzigd_op: string; aanlevering_gestart: boolean;
  /** Aantal conceptversies. */
  concepten: number;
};

export type ProjectCatalogus = {
  woningtypen: string[]; statussen: { waarde: string; label: string }[];
  profielen: { naam: string; omschrijving: string }[]; ontwerpsysteem: string;
};

/** Bestand uploaden als ruwe inhoud, met voortgang (fetch kent geen uploadvoortgang). */
export function upload<T>(pad: string, bestand: File, voortgang: (fractie: number) => void): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', pad);
    x.setRequestHeader('content-type', bestand.type || 'application/octet-stream');
    x.setRequestHeader('x-bestandsnaam', encodeURIComponent(bestand.name));
    x.upload.onprogress = (e) => { if (e.lengthComputable) voortgang(e.loaded / e.total); };
    x.onload = () => {
      let body: unknown = null; try { body = JSON.parse(x.responseText); } catch { /* geen json */ }
      if (x.status === 401) window.dispatchEvent(new Event('studio:uitgelogd'));
      if (x.status >= 400) reject(new ApiFout(x.status, (body as { fout?: string })?.fout ?? `Fout ${x.status}`));
      else resolve({ status: x.status, body: body as T });
    };
    x.onerror = () => reject(new ApiFout(0, 'De studio is niet bereikbaar'));
    x.send(bestand);
  });
}

export type Bestand = {
  id: string; soort: 'brochure' | 'foto' | 'plattegrond' | 'logo'; herkomst: 'upload' | 'brochure'; originele_naam: string; mime: string; grootte: number;
  sha256: string; breedte: number | null; hoogte: number | null; pagina: number | null; hoofdstuk: string | null; dubbel_van: string | null; dubbel_reden: string | null;
  classificatie: { categorie: string; score: number; alternatief: string; controle: boolean; model: string } | null; vervallen: boolean; geupload_op: string;
};
export type Verwerking = { id: string; soort: string; volgnummer: number; status: 'wachtrij' | 'bezig' | 'klaar' | 'mislukt'; aangevraagd_op: string;
  gestart_op: string | null; klaar_op: string | null; duur_ms: number | null; stappen: Record<string, unknown> | null; fout: string | null; generator_commit: string | null };
export type Kandidaat = { sleutel: string; label: string; waarde: unknown; eenheid?: string | null; bron: string; zekerheid?: string; verificatie?: string; toelichting?: string };
export type Gegeven = { sleutel: string; label: string; waarde: unknown; eenheid: string | null; herkomst: 'brochure' | 'handmatig'; status: 'overgenomen' | 'goedgekeurd' | 'afgewezen';
  bron: string | null; gewijzigd_op: string; besluit: { soort: string; motivering: string; keuze: unknown } | null };
export type Niveau = 'blokkerend' | 'aandacht' | 'info';
/** Waarvoor actie nodig is: de conceptgeneratie, de publicatie of geen van beide. */
export type Actie = 'conceptgeneratie' | 'publicatie' | 'geen';
export type Indeling = {
  samenvatting: { code: string; naam: string; conceptgeneratie: number; publicatie: number; geen: number }[];
  meldingen: { categorie: string; actie: Actie; tekst: string; detail: string | null; bron: string }[];
};
export type Aanlevering = {
  project: Project; kantoor: { id: string; merknaam: string; juridische_naam: string | null; telefoon: string | null; email: string | null; website: string | null; adresregels: string[]; logo_id: string | null };
  bestanden: Bestand[]; verwerkingen: Verwerking[]; brochure_logo: Bestand | null;
  gegevens: { sleutel: string; label: string; extractie: Kandidaat | null; vastgelegd: Gegeven | null; afwijking: boolean; conflict: { ernst: string; bronnen: string[] } | null;
    signalen: ('tegenstrijdigheid' | 'terminologie' | 'afwijking' | 'onzeker')[]; bulk: boolean }[];
  meldingen: { niveau: Niveau; actie: Actie; titel: string; tekst?: string; sleutel?: string }[];
  makelaar: { veld: string; brochure: string | null; kantoor: string | null; status: 'geen' | 'kantoor_leeg' | 'gelijk' | 'verschil' }[];
  fotokwaliteit: { norm: { goed: number; minimaal: number; openingsbeeld: number; aanbevolen: number }; in_gebruik: number; geschikt: number; onvoldoende: number;
    beperkt: number; te_klein: number; originelen_nodig: number; losse_onder_norm: number; openingsbeeld: boolean; losse: number; uit_brochure: number; dubbel: number; ter_controle: number };
  teksten: { id: string; titel?: string; alineas: { prose?: string; lijst?: string[]; accent?: string }[] }[];
  aanleveringen: { versie: number; opgeslagen_op: string; door: string; samenvatting: Record<string, number | boolean> }[];
  import: null | {
    id: string; volgnummer: number; klaar_op: string; duur_ms: number; stappen: Record<string, unknown>; generator_commit: string; paginas: number;
    telling: Record<string, number>; hoofdstukken: { id: string; titel: string; paginas: number[]; fotos: number }[]; ontbreekt: string[];
    conflicten: { gegeven: string; ernst: string; bronnen: string[] }[]; open_punten: { punt: string; uitleg: string }[]; uitgesloten: string[]; meldingen: string[];
    makelaar: { waarde: Record<string, unknown>; pagina: string; zekerheid: string } | null; profiel: { waarde: string; toelichting: string } | null;
    vraagprijs_gevonden: { pagina: number } | null; controle: { ok: boolean; fouten: string[]; waarschuwingen: string[] } | null;
  };
  ingrepen: { actie: string; n: number }[];
};
export type Huisstijl = {
  merkkleur: string | null; detailkleur: string | null; herkomst: 'handmatig' | 'logo' | null; logo: { id: string; mime: string; naam: string; herkomst: string } | null;
  voorstel: { merk: string | null; detail: string | null; bron: string; kleuren: { kleur: string; aandeel: number }[] } | null; voorstel_wijkt_af: boolean;
  toepassing: { profiel: string; licht: { achtergrond: string; accent: string; contrast: number; aangepast: boolean }; donker: { achtergrond: string; accent: string; contrast: number; aangepast: boolean } }[];
};

export type GegevenRegel = Aanlevering['gegevens'][number];
export type Beoordeling = {
  project: Project; vingerafdruk: string; klaar: boolean;
  fasen: { nr: number; naam: string; status: 'gereed' | 'open' | 'wacht'; open: number }[];
  checklist: { fase: number; code: string; titel: string; ok: boolean; verplicht: boolean; actie: string | null }[];
  broncontrole: { telling: Record<'totaal' | 'overgenomen' | 'gecontroleerd' | 'gecorrigeerd' | 'afgewezen' | 'tegenstrijdig' | 'opgelost' | 'ontbrekend', number>;
    te_beoordelen: GegevenRegel[]; vastgesteld: GegevenRegel[] };
  kwaliteit: null | { id: string; volgnummer: number; klaar_op: string; duur_ms: number; generator_commit: string; actueel: boolean;
    resultaat: Record<'blokkerend' | 'aandacht' | 'info', { bron: string; tekst: string }[]>; indeling: Indeling; taal: { criterium: string; waarde: unknown; norm: string; ok: boolean }[] };
  meldingen: Aanlevering['meldingen']; fotokwaliteit: Aanlevering['fotokwaliteit'];
  beslissingen: {
    rechten: { bevestigd: boolean; toelichting: string; op: string } | null; profiel: string | null; profiel_voorstel: { waarde: string; toelichting: string } | null;
    domein: string | null; conceptadres: boolean; openingsbeeld: Bestand | null; openingsbeeld_norm: number; openingsbeeld_kandidaten: Bestand[]; openingsbeeld_voorstel: string | null;
    fotokwaliteit: { nodig: boolean; akkoord: boolean; besluit: { motivering: string; door: string; op: string } | null };
  };
  vrijgave: { vrijgegeven: boolean; actueel: boolean; op?: string; motivering?: string | null; vervallen_op?: string; vervallen_door?: string; betekenis?: string };
  bronovername: { geldig: boolean; verouderd: boolean; verklaring: string; bron: { import: string; volgnummer: number; bestand: string | null; sha256: string | null } | null;
    besluit: { op: string; door: string | null; motivering: string | null; waarde: { bestand: string | null; sha256: string | null; volgnummer: number; overgenomen: number; open_tegenstrijdigheden: string[]; open_terminologie: string[] } } | null };
  besluiten: { id: number; onderwerp: string; handeling: string; waarde: unknown; motivering: string | null; op: string; door: string | null }[];
};

export type ConceptKort = {
  id: string; versie: number; status: 'te_beoordelen' | 'geaccepteerd' | 'verbeterpunten'; ontwerpsysteem: string; profiel: string; generator_commit: string;
  aangemaakt_op: string; aangemaakt_door: string | null; beoordeeld_op: string | null; beoordeeld_door: string | null; motivering: string | null;
  verbeterpunten: { onderdeel: string; tekst: string; op: string }[]; metingen: Metingen; voorbeeld_token: string; kwaliteit_kort: { blokkerend: number; waarschuwingen: number };
};
export type ActieveTijd = { ms: number; grens_ms: number; sessies: number; pauzes: number; gebruikers: number; interacties: number; handelingen: number;
  registratie_vanaf: string | null; betrouwbaar: boolean; toelichting: string };
/** Versie 2 (met actief en kalender) sinds de tijdregistratie; oudere versies hebben menselijke_controle. */
export type Metingen = {
  versie?: 2;
  aanlevering_import: { import_ms: number | null; upload_tot_import_ms: number | null };
  menselijke_controle?: { doorloop_ms: number | null; besluiten: number; toelichting: string };
  actief?: { totaal: ActieveTijd; tot_vrijgave: ActieveTijd | null; besluiten: number };
  kalender?: { ms: number | null; import_tot_vrijgave_ms: number | null; toelichting: string };
  conceptgeneratie: { totaal_ms: number; stappen: Record<string, number>; kwaliteitscontroles_ms: number };
  correcties: { gegevens_gecorrigeerd: number; gegevens_afgewezen: number; tegenstrijdigheden_besloten: number; compositie: number };
  totaal: { machine_ms: number; ambitie_ms: number; binnen_ambitie: boolean | null; binnen_ambitie_machine?: boolean; machine_en_actief_ms?: number; toelichting_machine: string;
    doorloop_ms?: number | null; toelichting_doorloop?: string; eerste_concept: boolean };
};
export type Uitgangspunten = {
  bronovername: null | { door: string | null; op: string; bestand: string | null; sha256: string | null; volgnummer: number; overgenomen: number };
  onzekerheden: { sleutel: string; gegeven: string; soort: 'tegenstrijdigheid' | 'terminologie'; gebruikte_waarde: string | null; verificatie: string; bronnen: string[]; bron: string | null }[];
  onbevestigd: string[]; ontbrekend: string[]; gecontroleerd: number;
};
export type Meetwaarde = { criterium: string; waarde: unknown; norm: string; ok: boolean };
export type Concept = ConceptKort & {
  map: string; aangemaakt_door_naam: string | null; beoordeeld_door_naam: string | null; build_vingerafdruk: string; invoer_vingerafdruk: string; bouw: { vingerafdruk: string; ontwerpsysteem: { versie: string; status: string }; profiel: string; lettertypepaar: string | null; onderdelen: string[];
    rapport: { modus: string; totaal_ms: number; correcties: number; besluiten: { regel: string; tekst: string }[]; regels: { code: string; t: string }[]; waarschuwingen: string[];
      qa: { feiten?: { getoetst: number; fouten: string[]; meldingen: string[] }; site?: { verwijzingen: number; fouten: string[] }; bijna_dubbel?: string[];
        presentatie?: { score: number; blokkerend?: { controle: string; melding: string }[]; aandacht?: { controle: string; melding: string }[] } } } };
  kwaliteit: null | { blokkerend: { controle: string; melding: string }[]; meetwaarden: Meetwaarde[]; waarschuwingen: { controle: string; melding: string }[];
    publiceerbaar: boolean; redenen: string[]; menselijk: { stappen: { stap: string; uitkomst: string }[] } };
  indeling: Indeling | null; uitgangspunten: Uitgangspunten | null; tijd_achteraf: (ActieveTijd & { afgeleid: string }) | null;
};
export type ConceptenOverzicht = { project: Project; concepten: ConceptKort[]; mag_genereren: { ok: boolean; reden: string | null };
  generatie: null | { id: string; status: string; aangevraagd_op: string; gestart_op: string | null; klaar_op: string | null; duur_ms: number | null; fout: string | null } };
