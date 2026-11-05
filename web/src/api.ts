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
  id: string; naam: string; slug: string; telefoon: string | null; email: string | null; website: string | null;
  adresregels: string[]; standaard_profiel: string | null; merkkleur: string | null; status: 'actief' | 'inactief';
  aangemaakt_op: string; gewijzigd_op: string; gebruikers?: number;
  leden?: { id: string; naam: string; email: string; rol: string }[];
};
