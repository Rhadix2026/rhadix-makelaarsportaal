// API van de productiestudio. Luistert alleen op 127.0.0.1.
//
// Elke route behalve /api/inloggen en /api/inlogopties vraagt een aangemelde gebruiker: via de
// centrale Rhadix-login (api/src/rhadixsso.ts) of, als noodtoegang, de eigen sessie (STUDIO_LOKALE_LOGIN).
// Gebruikersgegevens worden altijd gelezen en geschreven via alsGebruiker(): de database (RLS)
// bepaalt wat iemand ziet.
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, ROOT } from './config.ts';
import { alsGebruiker, audit, databaseStatus, migreer, pool } from './db.ts';
import { generatorStatus, profielCatalogus, profielen, standaardOntwerpsysteem } from './generator.ts';
import { COOKIE, beeindigSessie, leesCookie, meldAan, sessieCookie, sessieGebruiker, wisCookie } from './auth.ts';
import { meldAanViaRhadix, SSO_MELDING, ssoActief, wisSsoCache, type Huisstijl } from './rhadixsso.ts';
import { leesKantoor, lijstKantoren, maakKantoor, valideerKantoor, wijzigKantoor } from './kantoren.ts';
import { bulkGoedkeuren, conflictVoor, extractieVoor, herstelVerwerkingen, leverAan, overzicht, slaOp, trekIn, vraagVerwerking, wekVerwerker } from './aanlevering.ts';
import { bewerkGegeven } from './gegevens.ts';
import { bevestigVoorstel, leesHuisstijl, logoUitBrochure, uploadLogo } from './huisstijl.ts';
import { miniatuur, opslagPad } from './opslag.ts';
import { createReadStream } from 'node:fs';
import { beoordeling, beslis, kwaliteitscontrole, snelleBeoordeling } from './controle.ts';
import { registreerActiviteit } from './tijd.ts';
import { beoordeelConcept, conceptBestand, leesConcept, lijstConcepten, magGenereren, vraagConcept } from './concepten.ts';
import { leesProject, lijstProjecten, maakProject, STATUSSEN, telling, valideerProject, wijzigProject, WONINGTYPEN } from './projecten.ts';

const STUDIO_VERSIE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module 'fastify' { interface FastifyRequest { gebruiker: string; huisstijl: Huisstijl | null } }

type Ik = { id: string; email: string; naam: string; platformbeheer: boolean; kantoren: { id: string; naam: string; rol: string }[]; bron: 'rhadix' | 'lokaal' };

async function ik(gebruiker: string): Promise<Ik> {
  return alsGebruiker(gebruiker, async (c) => {
    const g = (await c.query('SELECT id, email, naam, platformrol, extern_bron FROM gebruiker WHERE id = $1', [gebruiker])).rows[0];
    const k = (await c.query(`SELECT k.id, k.merknaam AS naam, l.rol FROM lidmaatschap l JOIN kantoor k ON k.id = l.kantoor_id
      WHERE l.gebruiker_id = $1 ORDER BY lower(k.merknaam)`, [gebruiker])).rows;
    return { id: g.id, email: g.email, naam: g.naam, platformbeheer: g.platformrol === 'platformbeheer', kantoren: k,
      bron: g.extern_bron === 'rhadix' ? 'rhadix' : 'lokaal' };
  });
}

/** Mag de eigen wachtwoordlogin hier? Online alleen via een SSH-tunnel (Host 127.0.0.1, niet via Cloudflare). */
export function lokaleLoginToegestaan(req: FastifyRequest) {
  if (config.lokaleLogin === 'aan') return true;
  if (config.lokaleLogin === 'uit') return false;
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  return (host === '127.0.0.1' || host === 'localhost') && !req.headers['cf-connecting-ip'];
}

// Fouten uit de database die op een rechten- of uniciteitsprobleem wijzen, netjes vertalen.
function dbFout(e: unknown, reply: FastifyReply) {
  const code = (e as { code?: string }).code;
  if (code === '42501') return reply.code(403).send({ fout: 'Geen rechten voor deze handeling' });
  if (code === '23505') return reply.code(409).send({ fout: 'Bestaat al', fouten: { slug: 'Deze korte naam is al in gebruik' } });
  throw e;
}

export function bouwApp() {
  const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 64 * 1024 });
  app.decorateRequest('gebruiker', '');
  app.decorateRequest('huisstijl', null);
  // Bestanden komen als ruwe inhoud binnen (één bestand per verzoek); het type volgt uit de inhoud zelf.
  for (const type of ['application/pdf', 'application/octet-stream', /^image\//])
    app.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: 160 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  const toegestaneHerkomst = new Set([`http://127.0.0.1:${config.webPoort}`, `http://localhost:${config.webPoort}`, ...config.herkomst]);

  app.addHook('onRequest', async (req, reply) => {
    // Wijzigende verzoeken alleen vanaf de eigen interface (naast SameSite=Strict op het cookie).
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin && !toegestaneHerkomst.has(origin)) return reply.code(403).send({ fout: 'Onbekende herkomst' });
    if (req.url === '/api/inloggen' || req.url === '/api/gezond' || req.url === '/api/inlogopties') return;
    // Preview van een concept: toegang via het geheime voorbeeldtoken in het pad (alleen lezen).
    if (req.method === 'GET' && req.url.startsWith('/api/voorbeeld/')) return;
    // Noodtoegang: de eigen sessie, alleen waar de eigen login is toegestaan.
    const g = lokaleLoginToegestaan(req) ? await sessieGebruiker(leesCookie(req.headers.cookie)) : null;
    if (g) { req.gebruiker = g; return; }
    // Centrale Rhadix-login: het token uit het cookie op .rhadix.nl, bij elk verzoek gecontroleerd.
    const token = ssoActief() ? leesCookie(req.headers.cookie, config.sso.cookie) : undefined;
    if (token) {
      const r = await meldAanViaRhadix(token);
      if (r.ok) {
        // Het Rhadix-cookie gaat naar elke rhadix.nl-app (SameSite=Lax); wijzigingen daarom alleen met
        // een expliciete, eigen herkomst: een andere rhadix.nl-app kan hier niets namens de gebruiker doen.
        if (req.method !== 'GET' && !(origin && toegestaneHerkomst.has(origin))) return reply.code(403).send({ fout: 'Onbekende herkomst' });
        req.gebruiker = r.gebruikerId; req.huisstijl = r.huisstijl;
        return;
      }
      if (r.fout !== 'ongeldig') return reply.code(403).send({ fout: SSO_MELDING[r.fout], sso: r.fout });
    }
    return reply.code(401).send({ fout: 'Niet ingelogd' });
  });

  const alleenPlatform = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await ik(req.gebruiker)).platformbeheer) return reply.code(403).send({ fout: 'Alleen voor platformbeheer' });
  };

  // ── Inloggen en sessie ──────────────────────────────────────────────────
  // Wat het inlogscherm toont: de Rhadix-login en/of de eigen login, en waarom een Rhadix-aanmelding
  // (nog) niet lukt. Geeft alleen iets over het cookie van de aanvrager zelf.
  app.get('/api/inlogopties', async (req) => {
    let melding: string | null = null;
    const token = ssoActief() ? leesCookie(req.headers.cookie, config.sso.cookie) : undefined;
    if (token) { const r = await meldAanViaRhadix(token); if (!r.ok && r.fout !== 'ongeldig') melding = SSO_MELDING[r.fout]; }
    return { rhadix: ssoActief() ? config.sso.platform : null, lokaal: lokaleLoginToegestaan(req), melding };
  });

  app.post<{ Body: { email?: string; wachtwoord?: string } }>('/api/inloggen', async (req, reply) => {
    if (!lokaleLoginToegestaan(req)) return reply.code(403).send({ fout: 'Inloggen gaat via Rhadix' });
    const { email, wachtwoord } = req.body ?? {};
    if (typeof email !== 'string' || typeof wachtwoord !== 'string' || !email || !wachtwoord)
      return reply.code(400).send({ fout: 'Vul e-mailadres en wachtwoord in' });
    const r = await meldAan(email.trim(), wachtwoord);
    if (!r.ok) return r.reden === 'geblokkeerd'
      ? reply.code(429).send({ fout: 'Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw.' })
      : reply.code(401).send({ fout: 'E-mailadres of wachtwoord onjuist' });
    reply.header('set-cookie', sessieCookie(r.token));
    return ik(r.gebruikerId);
  });

  app.post('/api/uitloggen', async (req, reply) => {
    await beeindigSessie(leesCookie(req.headers.cookie, COOKIE));
    reply.header('set-cookie', wisCookie());
    return { ok: true };
  });

  app.get('/api/ik', async (req) => ({ ...(await ik(req.gebruiker)), huisstijl: req.huisstijl,
    uitloggen: ssoActief() ? `${config.sso.platform}/api/auth/logout` : null }));

  // ── Koppeling kantoor ↔ Rhadix-organisatie (alleen platformbeheer; op ID, nooit op naam) ──
  app.get('/api/rhadix-organisaties', { preHandler: alleenPlatform }, async (req) => alsGebruiker(req.gebruiker, async (c) =>
    (await c.query(`SELECT o.tenant_id, o.naam, o.laatst_gezien, k.id AS kantoor_id, k.merknaam AS kantoor
      FROM rhadix_organisatie o LEFT JOIN kantoor k ON k.rhadix_tenant_id = o.tenant_id ORDER BY lower(o.naam)`)).rows));

  app.put<{ Params: { id: string }; Body: { tenant_id?: string | null } }>('/api/kantoren/:id/rhadix-organisatie', { preHandler: alleenPlatform }, async (req, reply) => {
    const t = req.body?.tenant_id ?? null;
    if (!UUID.test(req.params.id) || (t !== null && (typeof t !== 'string' || !UUID.test(t))))
      return reply.code(400).send({ fout: 'Ongeldig organisatie-ID', fouten: { tenant_id: 'Een organisatie-ID (UUID) uit Rhadix' } });
    try {
      const r = await alsGebruiker(req.gebruiker, async (c) => {
        const oud = (await c.query('SELECT rhadix_tenant_id FROM kantoor WHERE id = $1', [req.params.id])).rows[0];
        if (!oud) return null;
        await c.query('UPDATE kantoor SET rhadix_tenant_id = $2, gewijzigd_op = now() WHERE id = $1', [req.params.id, t?.toLowerCase() ?? null]);
        await audit(c, { gebruiker: req.gebruiker, actie: 'rhadix-koppeling', tabel: 'kantoor', id: req.params.id, oud, nieuw: { rhadix_tenant_id: t } });
        return { id: req.params.id, rhadix_tenant_id: t?.toLowerCase() ?? null };
      });
      wisSsoCache();
      return r ?? reply.code(404).send({ fout: 'Kantoor niet gevonden' });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ fout: 'Deze Rhadix-organisatie is al aan een ander kantoor gekoppeld' });
      return dbFout(e, reply);
    }
  });

  // ── Makelaarskantoren ───────────────────────────────────────────────────
  app.get('/api/kantoren', async (req) => alsGebruiker(req.gebruiker, lijstKantoren));

  app.get<{ Params: { id: string } }>('/api/kantoren/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Kantoor niet gevonden' });
    const k = await alsGebruiker(req.gebruiker, (c) => leesKantoor(c, req.params.id));
    return k ?? reply.code(404).send({ fout: 'Kantoor niet gevonden' });
  });

  app.post<{ Body: Record<string, unknown> }>('/api/kantoren', { preHandler: alleenPlatform }, async (req, reply) => {
    const v = valideerKantoor(req.body ?? {}, await profielen());
    if (!v.ok) return reply.code(400).send({ fout: 'Controleer de invoer', fouten: v.fouten });
    try { return reply.code(201).send(await alsGebruiker(req.gebruiker, (c) => maakKantoor(c, req.gebruiker, v.kantoor))); }
    catch (e) { return dbFout(e, reply); }
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/kantoren/:id', { preHandler: alleenPlatform }, async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Kantoor niet gevonden' });
    const v = valideerKantoor(req.body ?? {}, await profielen());
    if (!v.ok) return reply.code(400).send({ fout: 'Controleer de invoer', fouten: v.fouten });
    try {
      const r = await alsGebruiker(req.gebruiker, (c) => wijzigKantoor(c, req.gebruiker, req.params.id, v.kantoor));
      if (r === null) return reply.code(404).send({ fout: 'Kantoor niet gevonden' });
      if (r === 'geweigerd') return reply.code(403).send({ fout: 'Geen rechten voor deze handeling' });
      return r;
    } catch (e) { return dbFout(e, reply); }
  });

  // ── Catalogus: keuzelijsten uit de generator en het projectmodel ────────
  app.get('/api/catalogus/profielen', async () => ({ profielen: await profielen(), details: await profielCatalogus() }));
  app.get('/api/catalogus/project', async () => ({
    woningtypen: WONINGTYPEN, statussen: STATUSSEN.map(([waarde, label]) => ({ waarde, label })),
    profielen: await profielCatalogus(), ontwerpsysteem: await standaardOntwerpsysteem(),
  }));

  // ── Woningprojecten ─────────────────────────────────────────────────────
  app.get<{ Querystring: { kantoor?: string; status?: string; zoek?: string } }>('/api/projecten', async (req) =>
    alsGebruiker(req.gebruiker, async (c) => ({ projecten: await lijstProjecten(c, req.query), telling: await telling(c) })));

  app.get<{ Params: { id: string } }>('/api/projecten/:id', async (req, reply) => {
    const p = await alsGebruiker(req.gebruiker, (c) => leesProject(c, req.params.id));
    return p ?? reply.code(404).send({ fout: 'Woningproject niet gevonden' });
  });

  const projectFout = (reply: FastifyReply, fout: string) => ({
    kantoor: () => reply.code(400).send({ fout: 'Controleer de invoer', fouten: { kantoor_id: 'Kantoor niet gevonden' } }),
    inactief: () => reply.code(400).send({ fout: 'Controleer de invoer', fouten: { kantoor_id: 'Dit kantoor is inactief' } }),
    gereserveerd: () => reply.code(400).send({ fout: 'Controleer de invoer', fouten: { slug: 'Deze korte naam is gereserveerd' } }),
    kantoor_vast: () => reply.code(409).send({ fout: 'Het kantoor kan niet meer wijzigen: de aanlevering is al begonnen', fouten: { kantoor_id: 'Vast na de start van de aanlevering' } }),
    onbekend: () => reply.code(404).send({ fout: 'Woningproject niet gevonden' }),
    geweigerd: () => reply.code(403).send({ fout: 'Geen rechten voor deze handeling' }),
  } as Record<string, () => FastifyReply>)[fout]();

  app.post<{ Body: Record<string, unknown> }>('/api/projecten', { preHandler: alleenPlatform }, async (req, reply) => {
    const v = valideerProject(req.body ?? {}, await profielen());
    if (!v.ok) return reply.code(400).send({ fout: 'Controleer de invoer', fouten: v.fouten });
    const ds = await standaardOntwerpsysteem();
    try {
      const r = await alsGebruiker(req.gebruiker, (c) => maakProject(c, req.gebruiker, v.project, ds));
      return 'fout' in r ? projectFout(reply, r.fout!) : reply.code(201).send(r.project);
    } catch (e) { return dbFout(e, reply); }
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/projecten/:id', { preHandler: alleenPlatform }, async (req, reply) => {
    const v = valideerProject(req.body ?? {}, await profielen());
    if (!v.ok) return reply.code(400).send({ fout: 'Controleer de invoer', fouten: v.fouten });
    try {
      const r = await alsGebruiker(req.gebruiker, (c) => wijzigProject(c, req.gebruiker, req.params.id, v.project));
      return 'fout' in r ? projectFout(reply, r.fout!) : r.project;
    } catch (e) { return dbFout(e, reply); }
  });

  // ── Aanlevering: bestanden, verwerkingen, gegevens ─────────────────────
  const UPLOAD = { preHandler: alleenPlatform, bodyLimit: 160 * 1024 * 1024 };
  const bestandsnaam = (req: FastifyRequest) => { try { return decodeURIComponent(String(req.headers['x-bestandsnaam'] ?? '')); } catch { return ''; } };
  const isBuffer = (b: unknown): b is Buffer => Buffer.isBuffer(b);

  app.post<{ Params: { id: string }; Querystring: { soort?: string } }>('/api/projecten/:id/bestanden', UPLOAD, async (req, reply) => {
    const soort = req.query.soort;
    if (soort !== 'brochure' && soort !== 'foto') return reply.code(400).send({ fout: 'soort moet brochure of foto zijn' });
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Woningproject niet gevonden' });
    if (!isBuffer(req.body)) return reply.code(415).send({ fout: 'Stuur het bestand als ruwe inhoud' });
    const body = req.body;
    const r = await alsGebruiker(req.gebruiker, (c) => leverAan(c, req.gebruiker, req.params.id, soort, bestandsnaam(req), body));
    if ('fout' in r) return reply.code(r.fout === 'onbekend' ? 404 : r.fout === 'grootte' ? 413 : 415).send({ fout: r.melding });
    return reply.code(r.al_aanwezig ? 200 : 201).send(r);
  });

  app.delete<{ Params: { id: string } }>('/api/bestanden/:id', { preHandler: alleenPlatform }, async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Bestand niet gevonden' });
    const ok = await alsGebruiker(req.gebruiker, (c) => trekIn(c, req.gebruiker, req.params.id));
    return ok ? { ok } : reply.code(404).send({ fout: 'Bestand niet gevonden of niet in te trekken' });
  });

  // Bestanden tonen: alleen wie het project (of kantoor) mag zien; nooit als uitvoerbare pagina.
  const toonBestand = (klein: boolean) => async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Bestand niet gevonden' });
    const b = await alsGebruiker(req.gebruiker, async (c) => (await c.query('SELECT opslag, mime, sha256, originele_naam FROM bestand WHERE id = $1', [req.params.id])).rows[0]);
    if (!b) return reply.code(404).send({ fout: 'Bestand niet gevonden' });
    reply.header('x-content-type-options', 'nosniff').header('cache-control', 'private, max-age=3600')
      .header('content-security-policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
    if (klein && b.mime.startsWith('image/')) return reply.type('image/webp').send(await miniatuur(b.opslag, b.sha256));
    reply.header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(b.originele_naam.split('/').pop())}`);
    return reply.type(b.mime).send(createReadStream(opslagPad(b.opslag)));
  };
  app.get('/api/bestanden/:id', toonBestand(false));
  app.get('/api/bestanden/:id/miniatuur', toonBestand(true));

  app.get<{ Params: { id: string } }>('/api/projecten/:id/aanlevering', async (req, reply) => {
    const o = await alsGebruiker(req.gebruiker, (c) => overzicht(c, req.params.id));
    return o ?? reply.code(404).send({ fout: 'Woningproject niet gevonden' });
  });

  app.post<{ Params: { id: string }; Body: { soort?: string } }>('/api/projecten/:id/verwerkingen', { preHandler: alleenPlatform }, async (req, reply) => {
    const soort = req.body?.soort;
    if (soort !== 'brochure-import' && soort !== 'foto-indeling') return reply.code(400).send({ fout: 'Onbekende verwerking' });
    const r = await alsGebruiker(req.gebruiker, (c) => vraagVerwerking(c, req.gebruiker, req.params.id, soort));
    if ('fout' in r) return reply.code(r.fout === 'onbekend' ? 404 : 409).send({ fout: ({
      onbekend: 'Woningproject niet gevonden', lopend: 'Er loopt al een verwerking voor dit project',
      geen_brochure: 'Lever eerst een brochure aan', geen_fotos: 'Er zijn nog geen foto\'s om in te delen' } as Record<string, string>)[r.fout!] });
    void wekVerwerker();
    return reply.code(202).send(r.verwerking);
  });

  app.put<{ Params: { id: string; sleutel: string }; Body: { actie?: string; waarde?: unknown; label?: string; eenheid?: string | null; bevestigd?: boolean; motivering?: string } }>(
    '/api/projecten/:id/gegevens/:sleutel', { preHandler: alleenPlatform }, async (req, reply) => {
      const { id, sleutel } = req.params;
      if (!UUID.test(id)) return reply.code(404).send({ fout: 'Woningproject niet gevonden' });
      if (!/^[a-z][a-z0-9_:.-]{0,80}$/.test(sleutel)) return reply.code(400).send({ fout: 'Ongeldig gegeven' });
      const r = await alsGebruiker(req.gebruiker, async (c) => {
        const p = await leesProject(c, id);
        if (!p) return { fout: 'project' as const };
        return bewerkGegeven(c, req.gebruiker, p, sleutel, { actie: String(req.body?.actie ?? ''), ...req.body }, await extractieVoor(c, id, sleutel), await conflictVoor(c, id, sleutel));
      });
      if ('fout' in r) {
        const [code, fout] = ({
          project: [404, 'Woningproject niet gevonden'], onbekend: [404, 'Dit gegeven is nog niet vastgelegd'], label: [400, 'Geef een omschrijving van het gegeven'],
          waarde: [400, ('melding' in r && r.melding) || 'Ongeldige waarde'], geen_extractie: [409, 'De brochure bevat dit gegeven niet'],
          bevestiging: [409, 'Dit gegeven is goedgekeurd of handmatig ingevoerd. Bevestig dat de brochurewaarde het mag vervangen.'],
          besluit: [409, 'Dit gegeven is tegenstrijdig in de brochure. Leg het besluit vast: bevestig de keuze en geef een korte motivering.'],
          motivering: [400, 'Geef een motivering voor het afwijzen'],
          actie: [400, 'Onbekende handeling'], geweigerd: [403, 'Geen rechten voor deze handeling'],
        } as Record<string, [number, string]>)[r.fout as string];
        return reply.code(code).send({ fout });
      }
      return r.gegeven;
    });

  app.post<{ Params: { id: string } }>('/api/projecten/:id/gegevens/bulkgoedkeuring', { preHandler: alleenPlatform }, async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Woningproject niet gevonden' });
    const r = await alsGebruiker(req.gebruiker, (c) => bulkGoedkeuren(c, req.gebruiker, req.params.id));
    return r ?? reply.code(404).send({ fout: 'Woningproject niet gevonden' });
  });

  app.post<{ Params: { id: string } }>('/api/projecten/:id/aanleveringen', { preHandler: alleenPlatform }, async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Woningproject niet gevonden' });
    const r = await alsGebruiker(req.gebruiker, (c) => slaOp(c, req.gebruiker, req.params.id));
    if ('fout' in r) return reply.code(r.fout === 'onbekend' ? 404 : 409).send({ fout: r.fout === 'onbekend' ? 'Woningproject niet gevonden' : 'Wacht tot de verwerking klaar is' });
    return reply.code(201).send(r.aanlevering);
  });

  // ── Broncontrole, kwaliteitscontrole en vrijgave (stap 5) ──────────────
  app.get<{ Params: { id: string } }>('/api/projecten/:id/beoordeling', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Woningproject niet gevonden' });
    const b = await alsGebruiker(req.gebruiker, (c) => beoordeling(c, req.params.id));
    return b ?? reply.code(404).send({ fout: 'Woningproject niet gevonden' });
  });

  app.post<{ Params: { id: string } }>('/api/projecten/:id/kwaliteitscontrole', { preHandler: alleenPlatform }, async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Woningproject niet gevonden' });
    const r = await alsGebruiker(req.gebruiker, (c) => kwaliteitscontrole(c, req.gebruiker, req.params.id));
    if ('fout' in r) return reply.code(r.fout === 'onbekend' ? 404 : 409).send({ fout: r.fout === 'onbekend' ? 'Woningproject niet gevonden' : 'Importeer eerst de brochure' });
    return reply.code(201).send(r.controle);
  });

  app.put<{ Params: { id: string; onderwerp: string }; Body: Record<string, unknown> }>('/api/projecten/:id/beslissingen/:onderwerp', { preHandler: alleenPlatform }, async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Woningproject niet gevonden' });
    const r = await alsGebruiker(req.gebruiker, (c) => beslis(c, req.gebruiker, req.params.id, req.params.onderwerp, req.body ?? {}));
    if ('fout' in r) {
      const x = r as { fout: string; melding?: string; open?: { titel: string; actie: string }[] };
      const [code, fout] = ({
        onbekend: [404, 'Woningproject niet gevonden'], motivering: [400, 'Geef een korte motivering of toelichting'],
        waarde: [400, x.melding ?? 'Ongeldige waarde'], onderwerp: [400, 'Onbekende beslissing'],
        niet_klaar: [409, `Nog niet alle verplichte controles zijn afgerond: ${(x.open ?? []).map((o) => o.titel).join('; ')}`],
      } as Record<string, [number, string]>)[x.fout];
      return reply.code(code).send({ fout, ...(x.open ? { open: x.open } : {}) });
    }
    return r.beoordeling;
  });

  // Snelle beoordeling: bron overnemen als uitgangspunt, verplichte keuzes, kwaliteitscontrole en vrijgave in één handeling.
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/projecten/:id/snelle-beoordeling', { preHandler: alleenPlatform }, async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Woningproject niet gevonden' });
    const r = await alsGebruiker(req.gebruiker, (c) => snelleBeoordeling(c, req.gebruiker, req.params.id, req.body ?? {}));
    if ('fout' in r) return reply.code(r.fout === 'onbekend' ? 404 : 400).send({ fout: r.fout === 'onbekend' ? 'Woningproject niet gevonden' : r.melding });
    return r;
  });

  // Interactiemoment voor de actieve gebruikerstijd (gedempt; geen inhoud, alleen tijdstip en scherm).
  app.post<{ Params: { id: string }; Body: { scherm?: string } }>('/api/projecten/:id/activiteit', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Woningproject niet gevonden' });
    const r = await alsGebruiker(req.gebruiker, (c) => registreerActiviteit(c, req.gebruiker, req.params.id, String(req.body?.scherm ?? '')));
    if ('fout' in r) return reply.code(r.fout === 'onbekend' ? 404 : 400).send({ fout: r.fout === 'onbekend' ? 'Woningproject niet gevonden' : 'Onbekend scherm' });
    return reply.code(204).send();
  });

  // ── Conceptgeneratie en preview (stap 6) ───────────────────────────────
  app.get<{ Params: { id: string } }>('/api/projecten/:id/concepten', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Woningproject niet gevonden' });
    const r = await alsGebruiker(req.gebruiker, async (c) => {
      const p = await leesProject(c, req.params.id);
      if (!p) return null;
      const m = await magGenereren(c, req.params.id);
      const v = (await c.query(`SELECT id, status, volgnummer, aangevraagd_op, gestart_op, klaar_op, duur_ms, fout FROM verwerking
        WHERE project_id = $1 AND soort = 'conceptgeneratie' ORDER BY volgnummer DESC LIMIT 1`, [req.params.id])).rows[0] ?? null;
      return { project: p, concepten: await lijstConcepten(c, req.params.id), mag_genereren: { ok: m.ok, reden: m.reden }, generatie: v };
    });
    return r ?? reply.code(404).send({ fout: 'Woningproject niet gevonden' });
  });

  app.post<{ Params: { id: string } }>('/api/projecten/:id/concepten', { preHandler: alleenPlatform }, async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Woningproject niet gevonden' });
    const r = await alsGebruiker(req.gebruiker, (c) => vraagConcept(c, req.gebruiker, req.params.id));
    if ('fout' in r) return reply.code(409).send({ fout: r.reden });
    void wekVerwerker();
    return reply.code(202).send(r.verwerking);
  });

  app.get<{ Params: { id: string } }>('/api/concepten/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Concept niet gevonden' });
    const k = await alsGebruiker(req.gebruiker, (c) => leesConcept(c, req.params.id));
    return k ?? reply.code(404).send({ fout: 'Concept niet gevonden' });
  });

  app.put<{ Params: { id: string }; Body: { besluit?: string; motivering?: string; verbeterpunten?: unknown } }>('/api/concepten/:id/beoordeling', { preHandler: alleenPlatform }, async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Concept niet gevonden' });
    const r = await alsGebruiker(req.gebruiker, (c) => beoordeelConcept(c, req.gebruiker, req.params.id, req.body ?? {}));
    if ('fout' in r) return reply.code(r.fout === 'onbekend' ? 404 : 400).send({ fout: ({ onbekend: 'Concept niet gevonden', punten: 'Leg minstens één verbeterpunt vast', besluit: 'Kies accepteren of verbeterpunten' } as Record<string, string>)[r.fout as string] });
    return r.concept;
  });

  // Lokale preview: de gegenereerde site, in een afgeschermde omgeving (sandbox, geen cookies, geen referrer, niet indexeren).
  app.get<{ Params: { token: string; '*': string } }>('/api/voorbeeld/:token/*', async (req, reply) => {
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(req.params.token)) return reply.code(404).send({ fout: 'Niet gevonden' });
    const k = (await pool.query('SELECT map FROM concept WHERE voorbeeld_token = $1', [req.params.token])).rows[0];
    const b = k && conceptBestand(k.map, req.params['*']);
    if (!b) return reply.code(404).send({ fout: 'Niet gevonden' });
    reply.header('content-security-policy', "sandbox allow-scripts; frame-ancestors 'self'").header('referrer-policy', 'no-referrer')
      .header('x-robots-tag', 'noindex, nofollow').header('x-content-type-options', 'nosniff').header('cache-control', 'private, max-age=300');
    // De sandbox geeft de preview een anonieme herkomst; lettertypes worden altijd met CORS opgehaald.
    if (b.type === 'font/woff2') reply.header('access-control-allow-origin', '*');
    return reply.type(b.type).send(createReadStream(b.pad));
  });

  // ── Kantoorhuisstijl ────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/kantoren/:id/huisstijl', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Kantoor niet gevonden' });
    const h = await alsGebruiker(req.gebruiker, (c) => leesHuisstijl(c, req.params.id));
    return h ?? reply.code(404).send({ fout: 'Kantoor niet gevonden' });
  });

  const huisstijlAntwoord = (reply: FastifyReply, r: { fout?: string; melding?: string; huisstijl?: unknown }) => r.fout
    ? reply.code(r.fout === 'onbekend' ? 404 : r.fout === 'geweigerd' ? 403 : r.fout === 'grootte' ? 413 : r.fout === 'geen_voorstel' ? 409 : 415)
      .send({ fout: r.melding ?? (r.fout === 'geen_voorstel' ? 'Er is geen voorstel uit een logo' : 'Geen rechten voor deze handeling') })
    : r.huisstijl;

  app.post<{ Params: { id: string } }>('/api/kantoren/:id/logo', UPLOAD, async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Kantoor niet gevonden' });
    if (!isBuffer(req.body)) return reply.code(415).send({ fout: 'Stuur het logo als ruwe inhoud' });
    const body = req.body;
    return huisstijlAntwoord(reply, await alsGebruiker(req.gebruiker, (c) => uploadLogo(c, req.gebruiker, req.params.id, bestandsnaam(req), body)));
  });

  app.post<{ Params: { id: string }; Body: { bestand_id?: string } }>('/api/kantoren/:id/logo/brochure', { preHandler: alleenPlatform }, async (req, reply) => {
    if (!UUID.test(req.params.id) || !UUID.test(String(req.body?.bestand_id))) return reply.code(404).send({ fout: 'Niet gevonden' });
    return huisstijlAntwoord(reply, await alsGebruiker(req.gebruiker, (c) => logoUitBrochure(c, req.gebruiker, req.params.id, String(req.body.bestand_id))));
  });

  app.post<{ Params: { id: string } }>('/api/kantoren/:id/huisstijl/voorstel', { preHandler: alleenPlatform }, async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ fout: 'Kantoor niet gevonden' });
    return huisstijlAntwoord(reply, await alsGebruiker(req.gebruiker, (c) => bevestigVoorstel(c, req.gebruiker, req.params.id)));
  });

  // Gezondheidscontrole voor de container en de beschikbaarheidsmeting: zonder sessie, zonder details.
  app.get('/api/gezond', async (_req, reply) => {
    try { await pool.query('SELECT 1'); return { ok: true }; } catch { return reply.code(503).send({ ok: false }); }
  });

  // ── Systeembeheer (technische status; alleen platformbeheer) ────────────
  app.get('/api/status', { preHandler: alleenPlatform }, async () => {
    const [database, generator] = await Promise.all([databaseStatus(), generatorStatus()]);
    return {
      studio: { versie: STUDIO_VERSIE, node: process.versions.node, omgeving: config.omgeving, rol: config.rol, adres: `${config.host}:${config.apiPoort}` },
      database,
      generator,
      tijd: new Date().toISOString(),
    };
  });

  app.addHook('onClose', async () => { await pool.end(); });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migreer();
  // Alleen het proces dat de wachtrij verwerkt, mag onderbroken verwerkingen afsluiten (online: de verwerker).
  if (config.rol === 'alles') await herstelVerwerkingen();
  const app = bouwApp();
  await app.listen({ host: config.host, port: config.apiPoort });
  console.log(`studio-API op http://${config.host}:${config.apiPoort} (${config.rol})`);
  void wekVerwerker();
}
