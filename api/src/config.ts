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
  host: '127.0.0.1',
  apiPoort: Number(env.STUDIO_API_POORT ?? 8480),
  webPoort: Number(env.STUDIO_WEB_POORT ?? 5480),
  // Opslag van aangeleverde bestanden en importresultaten (klantgegevens; data/ staat niet in git).
  opslag: pad(env.STUDIO_OPSLAG ?? join(ROOT, 'data', 'opslag')),
  // Lokale beeldclassificatie (SigLIP) bij verwerkingen; 'uit' slaat haar over (tests).
  classificatie: env.STUDIO_CLASSIFICATIE !== 'uit',
};

if (!config.dbUrl) throw new Error('STUDIO_DB_URL ontbreekt (zie .env.voorbeeld)');

// Borging: onder de testrunner (node --test zet NODE_TEST_CONTEXT in elk testproces) of met
// STUDIO_TEST=1 is alleen de aparte testdatabase toegestaan. Zo kan een test nooit de echte
// studio-database raken, ook niet bij een verkeerde importvolgorde.
export const IS_TEST = !!process.env.NODE_TEST_CONTEXT || process.env.STUDIO_TEST === '1';
if (IS_TEST && new URL(config.dbUrl).pathname !== '/studio_test')
  throw new Error(`tests mogen alleen de database studio_test gebruiken (nu: ${new URL(config.dbUrl).pathname.slice(1)})`);
if (IS_TEST && config.opslag === join(ROOT, 'data', 'opslag'))
  throw new Error('tests mogen de echte opslag (data/opslag) niet gebruiken; zet STUDIO_OPSLAG');
if (!/@(127\.0\.0\.1|localhost):/.test(config.dbUrl)) throw new Error('STUDIO_DB_URL moet naar 127.0.0.1 wijzen');
