// Aansluiting op de centrale Rhadix-login. Datavalidatie is de identity provider: na het inloggen
// daar staat een RS256-getekend token (uitgever 'suresync-id') in het cookie op .rhadix.nl. Het
// portaal controleert dat token bij elk verzoek met de PUBLIEKE sleutel (vast ingesteld; er wordt
// tijdens een verzoek niets bij Rhadix opgevraagd) en kan zelf nooit tokens uitgeven.
//
// Zelfde regels als de andere Rhadix-apps (zie ~/Developer/CLAUDE.md, "Autorisatie"):
//   - toegang uitsluitend via de apps-claim (slug STUDIO_SSO_APP), zonder rol-bypass;
//   - machinetokens (typ machine/client, scope external) horen hier niet;
//   - de gebruiker wordt just-in-time aangemaakt, zonder wachtwoord.
// Afwijkend, bewust: de organisatie wordt gekoppeld op tenant_id, nooit op tenant_name.
//
// Rollen: RHADIX_ADMIN → platformbeheer; ORG_ADMIN → kantoorbeheerder; ORG_USER → makelaar, beide
// alleen in het kantoor dat aan de eigen organisatie is gekoppeld. RSO_ADMIN wordt in deze fase
// nog niet ondersteund.
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { pool } from './db.ts';
import { config } from './config.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KLOKMARGE_S = 30;
const LIDROL: Record<string, 'kantoorbeheerder' | 'makelaar'> = { ORG_ADMIN: 'kantoorbeheerder', ORG_USER: 'makelaar' };

let sleutel: KeyObject | null = null;
if (config.sso.sleutel) {
  sleutel = createPublicKey(config.sso.sleutel);
  if (sleutel.asymmetricKeyType !== 'rsa') throw new Error('STUDIO_SSO_SLEUTEL moet een publieke RSA-sleutel zijn');
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(config.sso.platform) && !/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(config.sso.platform))
    throw new Error('STUDIO_SSO_PLATFORM moet de https-herkomst van het Rhadix-platform zijn');
}
export const ssoActief = () => sleutel !== null;

export type Huisstijl = { primair: string | null; accent: string | null; woordmerk: string | null; logo: string | null };
export type Claims = { sub: string; email: string; naam: string; rol: string; tenantId: string; tenantNaam: string; huisstijl: Huisstijl };
export type SsoFout = 'ongeldig' | 'geen-toegang' | 'rso' | 'niet-gekoppeld' | 'conflict' | 'gedeactiveerd';

const b64 = (s: string) => Buffer.from(s, 'base64url');
const kleur = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v) ? v : null);

/** Controleert handtekening en claims. Geeft null bij elk gebrek (geen details naar buiten). */
export function controleerToken(token: string, nu = Date.now() / 1000): Claims | { fout: 'geen-toegang' } | null {
  if (!sleutel) return null;
  const delen = token.split('.');
  if (delen.length !== 3) return null;
  let kop: Record<string, unknown>, p: Record<string, unknown>;
  try { kop = JSON.parse(b64(delen[0]).toString('utf8')); p = JSON.parse(b64(delen[1]).toString('utf8')); } catch { return null; }
  // Alleen RS256: geen 'none', geen HS256 (een gedeeld geheim bestaat hier niet en mag niet worden geraden).
  if (kop.alg !== 'RS256') return null;
  if (!verify('RSA-SHA256', Buffer.from(`${delen[0]}.${delen[1]}`), sleutel, b64(delen[2]))) return null;
  if (p.iss !== config.sso.uitgever) return null;
  if (typeof p.exp !== 'number' || nu > p.exp + KLOKMARGE_S) return null;
  if (typeof p.nbf === 'number' && nu + KLOKMARGE_S < p.nbf) return null;
  if (typeof p.sub !== 'string' || !UUID.test(p.sub) || typeof p.tenant_id !== 'string' || !UUID.test(p.tenant_id)) return null;
  if (typeof p.email !== 'string' || !p.email.includes('@') || typeof p.role !== 'string') return null;
  // Machine-to-machine hoort op een externe API; dit portaal heeft die niet.
  if (p.typ === 'machine' || p.typ === 'client' || p.scope === 'external') return { fout: 'geen-toegang' };
  if (!Array.isArray(p.apps) || !p.apps.includes(config.sso.app)) return { fout: 'geen-toegang' };
  const b = (p.branding ?? {}) as Record<string, unknown>;
  const logo = typeof b.logo_url === 'string' && b.logo_url.startsWith(`${config.sso.platform}/api/branding/`) ? b.logo_url : null;
  return {
    sub: p.sub.toLowerCase(), email: p.email.trim().toLowerCase(), naam: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 200) : p.email,
    rol: p.role, tenantId: p.tenant_id.toLowerCase(), tenantNaam: typeof p.tenant_name === 'string' ? p.tenant_name.slice(0, 200) : '',
    huisstijl: { primair: kleur(b.primary_color), accent: kleur(b.accent_color), woordmerk: typeof b.wordmark === 'string' ? b.wordmark.slice(0, 120) : null, logo },
  };
}

// Een zojuist verwerkt token hoeft niet bij elk verzoek opnieuw naar de database: korte cache op
// de hash van het token (de inhoud kan niet veranderen zonder dat de hash verandert).
const CACHE_MS = 60e3, CACHE_MAX = 500;
const cache = new Map<string, { tot: number; uitkomst: Aanmelding }>();
export function wisSsoCache() { cache.clear(); }

export type Aanmelding = { ok: true; gebruikerId: string; huisstijl: Huisstijl } | { ok: false; fout: SsoFout };

/** Token → portaalgebruiker (aangemaakt of bijgewerkt), met rol en lidmaatschap uit het token. */
export async function meldAanViaRhadix(token: string): Promise<Aanmelding> {
  const sleutelHash = createHash('sha256').update(token).digest('hex');
  const c = cache.get(sleutelHash);
  if (c && c.tot > Date.now()) return c.uitkomst;
  const claims = controleerToken(token);
  if (!claims) return { ok: false, fout: 'ongeldig' };
  if ('fout' in claims) return { ok: false, fout: claims.fout };
  const uitkomst = await synchroniseer(claims);
  if (cache.size >= CACHE_MAX) cache.clear();
  if (uitkomst.ok || uitkomst.fout !== 'conflict') cache.set(sleutelHash, { tot: Date.now() + CACHE_MS, uitkomst });
  return uitkomst;
}

async function synchroniseer(k: Claims): Promise<Aanmelding> {
  if (k.rol === 'RSO_ADMIN') return { ok: false, fout: 'rso' };
  const platform = k.rol === 'RHADIX_ADMIN';
  const lidrol = LIDROL[k.rol];
  if (!platform && !lidrol) return { ok: false, fout: 'geen-toegang' };

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // De organisatie zichtbaar maken voor platformbeheer (ID + laatst bekende naam); niet bij elk verzoek schrijven.
    await c.query(`INSERT INTO rhadix_organisatie (tenant_id, naam) VALUES ($1, $2)
      ON CONFLICT (tenant_id) DO UPDATE SET naam = EXCLUDED.naam, laatst_gezien = now()
      WHERE rhadix_organisatie.naam IS DISTINCT FROM EXCLUDED.naam OR rhadix_organisatie.laatst_gezien < now() - interval '1 hour'`,
      [k.tenantId, k.tenantNaam || k.tenantId]);

    // Een bestaand portaalaccount met hetzelfde e-mailadres (zonder Rhadix-koppeling) wordt nooit
    // stilzwijgend overgenomen: dat is een bewuste handeling van platformbeheer.
    const bestaand = (await c.query(`SELECT id, extern_bron, extern_id FROM gebruiker WHERE lower(email) = $1`, [k.email])).rows[0];
    if (bestaand && !(bestaand.extern_bron === 'rhadix' && bestaand.extern_id === k.sub)) {
      await c.query('ROLLBACK');
      return { ok: false, fout: 'conflict' };
    }
    const g = (await c.query(`INSERT INTO gebruiker (email, naam, extern_bron, extern_id, platformrol, rhadix_tenant_id)
      VALUES ($1, $2, 'rhadix', $3, $4, $5)
      ON CONFLICT (extern_bron, extern_id) WHERE extern_id IS NOT NULL DO UPDATE
        SET email = EXCLUDED.email, naam = EXCLUDED.naam, platformrol = EXCLUDED.platformrol, rhadix_tenant_id = EXCLUDED.rhadix_tenant_id
        WHERE (gebruiker.email, gebruiker.naam, gebruiker.platformrol, gebruiker.rhadix_tenant_id)
          IS DISTINCT FROM (EXCLUDED.email, EXCLUDED.naam, EXCLUDED.platformrol, EXCLUDED.rhadix_tenant_id)
      RETURNING id, actief`, [k.email, k.naam, k.sub, platform ? 'platformbeheer' : null, k.tenantId])).rows[0]
      ?? (await c.query(`SELECT id, actief FROM gebruiker WHERE extern_bron = 'rhadix' AND extern_id = $1`, [k.sub])).rows[0];
    // In het portaal geblokkeerd (actief = false) blijft geblokkeerd, ook met een geldig Rhadix-token.
    if (!g.actief) { await c.query('COMMIT'); return { ok: false, fout: 'gedeactiveerd' }; }

    // Lidmaatschap volgt volledig uit het token: hooguit één kantoor (dat van de eigen organisatie).
    const kantoor = platform ? null
      : (await c.query(`SELECT id FROM kantoor WHERE rhadix_tenant_id = $1 AND status = 'actief'`, [k.tenantId])).rows[0]?.id as string | undefined;
    const gewenst = kantoor && lidrol ? [{ kantoor, rol: lidrol }] : [];
    const nu = (await c.query('SELECT kantoor_id, rol FROM lidmaatschap WHERE gebruiker_id = $1', [g.id])).rows;
    const gelijk = nu.length === gewenst.length && nu.every((l) => gewenst.some((w) => w.kantoor === l.kantoor_id && w.rol === l.rol));
    if (!gelijk) {
      await c.query('DELETE FROM lidmaatschap WHERE gebruiker_id = $1', [g.id]);
      for (const w of gewenst) await c.query('INSERT INTO lidmaatschap (gebruiker_id, kantoor_id, rol) VALUES ($1, $2, $3)', [g.id, w.kantoor, w.rol]);
      await c.query(`INSERT INTO auditregel (gebruiker_id, actie, tabel, rij_id, oud, nieuw) VALUES ($1, 'rhadix-lidmaatschap', 'lidmaatschap', $2, $3, $4)`,
        [g.id, g.id, JSON.stringify(nu), JSON.stringify({ rol: k.rol, tenant_id: k.tenantId, lidmaatschap: gewenst })]);
    }
    await c.query('COMMIT');
    if (!platform && !kantoor) return { ok: false, fout: 'niet-gekoppeld' };
    return { ok: true, gebruikerId: g.id, huisstijl: k.huisstijl };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    if ((e as { code?: string }).code === '23505') return { ok: false, fout: 'conflict' };
    throw e;
  } finally { c.release(); }
}

export const SSO_MELDING: Record<SsoFout, string> = {
  'ongeldig': 'Niet ingelogd',
  'geen-toegang': 'U heeft geen toegang tot Rhadix Makelaarsportaal. Vraag uw beheerder om de applicatie aan uw account toe te wijzen.',
  'rso': 'Beheer op RSO-niveau wordt in het Makelaarsportaal nog niet ondersteund. Gebruik een account van het kantoor zelf.',
  'niet-gekoppeld': 'Uw organisatie is nog niet aan een kantoor in het Makelaarsportaal gekoppeld. Neem contact op met Rhadix.',
  'conflict': 'Er bestaat al een portaalaccount met dit e-mailadres. Neem contact op met Rhadix om het te koppelen.',
  'gedeactiveerd': 'Uw toegang tot het Makelaarsportaal is geblokkeerd. Neem contact op met Rhadix.',
};
