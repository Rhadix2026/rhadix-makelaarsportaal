// Instellingen uit .env (niet in git). Alleen lokale adressen: de studio is in deze fase niet
// van buitenaf bereikbaar.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const ROOT = resolve(new URL('../..', import.meta.url).pathname);

function leesEnv(pad: string): Record<string, string> {
  if (!existsSync(pad)) return {};
  const uit: Record<string, string> = {};
  for (const regel of readFileSync(pad, 'utf8').split('\n')) {
    const m = regel.match(/^([A-Z_]+)=(.*)$/);
    if (m) uit[m[1]] = m[2];
  }
  return uit;
}

const env = { ...leesEnv(join(ROOT, '.env')), ...process.env } as Record<string, string | undefined>;
const pad = (p: string) => resolve(p.replace(/^~(?=\/)/, homedir()));

export const config = {
  dbUrl: env.STUDIO_DB_URL ?? '',
  generator: pad(env.STUDIO_GENERATOR ?? '~/Developer/makelaarsplatform-productie'),
  // Luisteradres: lokaal altijd 127.0.0.1; in een container 0.0.0.0 (de poort wordt dan alleen op 127.0.0.1 van de host gepubliceerd).
  host: env.STUDIO_HOST ?? '127.0.0.1',
  // Online: de publieke herkomst (https://…) voor de herkomstcontrole, en het Secure-cookie achter HTTPS.
  herkomst: (env.STUDIO_HERKOMST ?? '').split(',').map((h) => h.trim()).filter(Boolean),
  cookieSecure: env.STUDIO_COOKIE_SECURE === '1',
  omgeving: env.STUDIO_OMGEVING ?? 'lokaal',
  // Rol van dit proces: 'alles' (lokaal: API en verwerker samen), 'api' of 'verwerker' (online: aparte containers).
  rol: (['api', 'verwerker'].includes(env.STUDIO_ROL ?? '') ? env.STUDIO_ROL : 'alles') as 'alles' | 'api' | 'verwerker',
  apiPoort: Number(env.STUDIO_API_POORT ?? 8480),
  webPoort: Number(env.STUDIO_WEB_POORT ?? 5480),
  // Opslag van aangeleverde bestanden en importresultaten (klantgegevens; data/ staat niet in git).
  opslag: pad(env.STUDIO_OPSLAG ?? join(ROOT, 'data', 'opslag')),
  // Lokale beeldclassificatie (SigLIP) bij verwerkingen; 'uit' slaat haar over (tests).
  classificatie: env.STUDIO_CLASSIFICATIE !== 'uit',
  // Inactiviteitsgrens voor de actieve gebruikerstijd: een langere pauze tussen twee interacties telt niet mee.
  inactiviteitMs: Math.max(1, Number(env.STUDIO_INACTIVITEIT_MIN ?? 5)) * 60e3,
  // Centrale Rhadix-login (Datavalidatie als identity provider). Zonder sleutel staat de koppeling uit.
  // Alleen de PUBLIEKE sleutel: het portaal kan tokens controleren, nooit uitgeven.
  sso: {
    sleutel: leesSleutel(env.STUDIO_SSO_SLEUTEL),
    uitgever: env.STUDIO_SSO_UITGEVER ?? 'suresync-id',
    cookie: env.STUDIO_SSO_COOKIE ?? 'rhadix_sso',
    app: env.STUDIO_SSO_APP ?? 'rhadix-makelaarsportaal',
    // Het Rhadix-platform (inloggen en centraal uitloggen), bijvoorbeeld https://app-staging.rhadix.nl
    platform: (env.STUDIO_SSO_PLATFORM ?? '').replace(/\/+$/, ''),
  },
  // Eigen wachtwoordlogin: 'aan' (lokale studio), 'tunnel' (online: alleen via een SSH-tunnel naar
  // 127.0.0.1, als noodtoegang wanneer Rhadix niet bereikbaar is) of 'uit'.
  lokaleLogin: (['tunnel', 'uit'].includes(env.STUDIO_LOKALE_LOGIN ?? '') ? env.STUDIO_LOKALE_LOGIN : 'aan') as 'aan' | 'tunnel' | 'uit',
  // Preview van een concept alleen voor aangemelde gebruikers van het eigen kantoor (online standaard aan;
  // lokaal, op 127.0.0.1, standaard uit). Zie /api/voorbeeld in server.ts.
  voorbeeldAfgeschermd: env.STUDIO_VOORBEELD_AFGESCHERMD ? env.STUDIO_VOORBEELD_AFGESCHERMD === '1' : env.STUDIO_COOKIE_SECURE === '1',
};

/** PEM rechtstreeks, met \n als regelscheiding (één regel in .env), of base64 van de PEM. */
function leesSleutel(v: string | undefined): string | null {
  if (!v?.trim()) return null;
  const s = v.trim().replace(/\\n/g, '\n');
  return s.includes('BEGIN') ? s : Buffer.from(s, 'base64').toString('utf8');
}

if (!config.dbUrl) throw new Error('STUDIO_DB_URL ontbreekt (zie .env.voorbeeld)');

// Borging: onder de testrunner (node --test zet NODE_TEST_CONTEXT in elk testproces) of met
// STUDIO_TEST=1 is alleen de aparte testdatabase toegestaan. Zo kan een test nooit de echte
// studio-database raken, ook niet bij een verkeerde importvolgorde.
export const IS_TEST = !!process.env.NODE_TEST_CONTEXT || process.env.STUDIO_TEST === '1';
if (IS_TEST && new URL(config.dbUrl).pathname !== '/studio_test')
  throw new Error(`tests mogen alleen de database studio_test gebruiken (nu: ${new URL(config.dbUrl).pathname.slice(1)})`);
if (IS_TEST && config.opslag === join(ROOT, 'data', 'opslag'))
  throw new Error('tests mogen de echte opslag (data/opslag) niet gebruiken; zet STUDIO_OPSLAG');
// De database is nooit extern: lokaal 127.0.0.1, online de service 'db' op het interne Compose-netwerk.
if (!/@(127\.0\.0\.1|localhost|db):/.test(config.dbUrl)) throw new Error('STUDIO_DB_URL moet naar 127.0.0.1 (lokaal) of db (intern containernetwerk) wijzen');
