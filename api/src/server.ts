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
  const app = bouwApp();
  await app.listen({ host: config.host, port: config.apiPoort });
  console.log(`studio-API op http://${config.host}:${config.apiPoort}`);
}
