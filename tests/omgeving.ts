// Testomgeving: een aparte, telkens verse database studio_test in dezelfde studio-container.
// Moet als eerste worden geïmporteerd (vóór de API-modules), zodat config de testdatabase leest.
import { readFileSync } from 'node:fs';
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
