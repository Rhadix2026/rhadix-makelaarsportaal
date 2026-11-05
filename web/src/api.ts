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
export type Gegeven = { sleutel: string; label: string; waarde: unknown; eenheid: string | null; herkomst: 'brochure' | 'handmatig'; status: 'overgenomen' | 'goedgekeurd';
  bron: string | null; gewijzigd_op: string; besluit: { soort: string; motivering: string; keuze: unknown } | null };
export type Niveau = 'blokkerend' | 'aandacht' | 'info';
export type Aanlevering = {
  project: Project; kantoor: { id: string; merknaam: string; juridische_naam: string | null; telefoon: string | null; email: string | null; website: string | null; adresregels: string[]; logo_id: string | null };
  bestanden: Bestand[]; verwerkingen: Verwerking[]; brochure_logo: Bestand | null;
  gegevens: { sleutel: string; label: string; extractie: Kandidaat | null; vastgelegd: Gegeven | null; afwijking: boolean; conflict: { ernst: string; bronnen: string[] } | null;
    signalen: ('tegenstrijdigheid' | 'terminologie' | 'afwijking' | 'onzeker')[]; bulk: boolean }[];
  meldingen: { niveau: Niveau; titel: string; tekst?: string; sleutel?: string }[];
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
