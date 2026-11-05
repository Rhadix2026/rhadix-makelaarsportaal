// API van de productiestudio. Luistert alleen op 127.0.0.1.
//
// Elke route behalve /api/inloggen vraagt een geldige sessie. Gebruikersgegevens worden altijd
// gelezen en geschreven via alsGebruiker(): de database (RLS) bepaalt wat iemand ziet.
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, ROOT } from './config.ts';
import { alsGebruiker, databaseStatus, migreer, pool } from './db.ts';
import { generatorStatus, profielCatalogus, profielen, standaardOntwerpsysteem } from './generator.ts';
import { COOKIE, beeindigSessie, leesCookie, meldAan, sessieCookie, sessieGebruiker, wisCookie } from './auth.ts';
import { leesKantoor, lijstKantoren, maakKantoor, valideerKantoor, wijzigKantoor } from './kantoren.ts';
import { bulkGoedkeuren, conflictVoor, extractieVoor, herstelVerwerkingen, leverAan, overzicht, slaOp, trekIn, vraagVerwerking, wekVerwerker } from './aanlevering.ts';
import { bewerkGegeven } from './gegevens.ts';
import { bevestigVoorstel, leesHuisstijl, logoUitBrochure, uploadLogo } from './huisstijl.ts';
import { miniatuur, opslagPad } from './opslag.ts';
import { createReadStream } from 'node:fs';
import { beoordeling, beslis, kwaliteitscontrole } from './controle.ts';
import { leesProject, lijstProjecten, maakProject, STATUSSEN, telling, valideerProject, wijzigProject, WONINGTYPEN } from './projecten.ts';

const STUDIO_VERSIE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module 'fastify' { interface FastifyRequest { gebruiker: string } }

type Ik = { id: string; email: string; naam: string; platformbeheer: boolean; kantoren: { id: string; naam: string; rol: string }[] };

async function ik(gebruiker: string): Promise<Ik> {
  return alsGebruiker(gebruiker, async (c) => {
    const g = (await c.query('SELECT id, email, naam, platformrol FROM gebruiker WHERE id = $1', [gebruiker])).rows[0];
    const k = (await c.query(`SELECT k.id, k.merknaam AS naam, l.rol FROM lidmaatschap l JOIN kantoor k ON k.id = l.kantoor_id
      WHERE l.gebruiker_id = $1 ORDER BY lower(k.merknaam)`, [gebruiker])).rows;
    return { id: g.id, email: g.email, naam: g.naam, platformbeheer: g.platformrol === 'platformbeheer', kantoren: k };
  });
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
  // Bestanden komen als ruwe inhoud binnen (één bestand per verzoek); het type volgt uit de inhoud zelf.
  for (const type of ['application/pdf', 'application/octet-stream', /^image\//])
    app.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: 160 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  const toegestaneHerkomst = new Set([`http://127.0.0.1:${config.webPoort}`, `http://localhost:${config.webPoort}`]);

  app.addHook('onRequest', async (req, reply) => {
    // Wijzigende verzoeken alleen vanaf de eigen interface (naast SameSite=Strict op het cookie).
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin && !toegestaneHerkomst.has(origin)) return reply.code(403).send({ fout: 'Onbekende herkomst' });
    if (req.url === '/api/inloggen') return;
    const g = await sessieGebruiker(leesCookie(req.headers.cookie));
    if (!g) return reply.code(401).send({ fout: 'Niet ingelogd' });
    req.gebruiker = g;
  });

  const alleenPlatform = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await ik(req.gebruiker)).platformbeheer) return reply.code(403).send({ fout: 'Alleen voor platformbeheer' });
  };

  // ── Inloggen en sessie ──────────────────────────────────────────────────
  app.post<{ Body: { email?: string; wachtwoord?: string } }>('/api/inloggen', async (req, reply) => {
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

  app.get('/api/ik', async (req) => ik(req.gebruiker));

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

  // ── Systeembeheer (technische status; alleen platformbeheer) ────────────
  app.get('/api/status', { preHandler: alleenPlatform }, async () => {
    const [database, generator] = await Promise.all([databaseStatus(), generatorStatus()]);
    return {
      studio: { versie: STUDIO_VERSIE, node: process.versions.node, omgeving: 'lokaal', adres: `${config.host}:${config.apiPoort}` },
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
  await herstelVerwerkingen();
  const app = bouwApp();
  await app.listen({ host: config.host, port: config.apiPoort });
  console.log(`studio-API op http://${config.host}:${config.apiPoort}`);
  void wekVerwerker();
}
