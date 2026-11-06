// Testomgeving: een aparte, telkens verse database studio_test in dezelfde studio-container.
// Moet als eerste worden geïmporteerd (vóór de API-modules), zodat config de testdatabase leest.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
  .map((r) => r.match(/^([A-Z_]+)=(.*)$/)).filter((m): m is RegExpMatchArray => !!m).map((m) => [m[1], m[2]]));
const basis = new URL(env.STUDIO_DB_URL);
if (basis.hostname !== '127.0.0.1') throw new Error('tests alleen tegen de lokale studio-database');

const beheer = new URL(basis); beheer.pathname = '/postgres';
const c = new pg.Client({ connectionString: beheer.toString() });
await c.connect();
await c.query('DROP DATABASE IF EXISTS studio_test WITH (FORCE)');
await c.query('CREATE DATABASE studio_test');
await c.end();

const test = new URL(basis); test.pathname = '/studio_test';
process.env.STUDIO_DB_URL = test.toString();
process.env.STUDIO_TEST = '1';
// Bestanden van de tests in een eigen tijdelijke map, nooit in data/opslag.
const opslag = mkdtempSync(join(tmpdir(), 'studio-test-opslag-'));
process.env.STUDIO_OPSLAG = opslag;
// Na afloop opruimen: de opslag kan kopieën van de praktijkbrochure bevatten.
process.on('exit', () => rmSync(opslag, { recursive: true, force: true }));
// De beeldclassificatie (SigLIP, ±4 GB) draait niet in de geautomatiseerde tests; wel in de praktijktest.
process.env.STUDIO_CLASSIFICATIE ??= 'uit';
// Centrale Rhadix-login in de tests: een TIJDELIJK sleutelpaar, per testrun nieuw gemaakt. Nooit een
// sleutel van Rhadix; de privésleutel bestaat alleen in dit testproces (tests/hulp.ts tekent ermee).
{
  const { generateKeyPairSync } = await import('node:crypto');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.STUDIO_SSO_SLEUTEL = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  process.env.TEST_SSO_PRIVE = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  process.env.STUDIO_SSO_PLATFORM = 'https://platform.rhadix.invalid';
  process.env.STUDIO_SSO_COOKIE = 'rhadix_sso_test';
}
