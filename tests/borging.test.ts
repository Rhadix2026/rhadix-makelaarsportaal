// Borging en regressie: tests raken nooit de echte studio-database, en de generator, de
// referentiewoningen en de goedgekeurde concepten blijven ongewijzigd.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pool } from '../api/src/db.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const env = Object.fromEntries(readFileSync(join(ROOT, '.env'), 'utf8').split('\n')
  .map((r) => r.match(/^([A-Z_]+)=(.*)$/)).filter((m): m is RegExpMatchArray => !!m).map((m) => [m[1], m[2]]));

test('de testprocessen zijn verbonden met studio_test', async () => {
  assert.equal((await pool.query('SELECT current_database() AS d')).rows[0].d, 'studio_test');
});

test('onder de testrunner weigert de configuratie elke andere database dan studio_test', () => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', "await import('./api/src/config.ts')"], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, STUDIO_DB_URL: env.STUDIO_DB_URL, NODE_TEST_CONTEXT: 'child', STUDIO_TEST: '' },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /tests mogen alleen de database studio_test gebruiken \(nu: studio\)/);
});

test('ook met STUDIO_TEST=1 buiten de testrunner is alleen studio_test toegestaan', () => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', "await import('./api/src/config.ts')"], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, STUDIO_DB_URL: env.STUDIO_DB_URL, NODE_TEST_CONTEXT: '', STUDIO_TEST: '1' },
  });
  assert.notEqual(r.status, 0);
});

// ── Regressie: bestaande onderdelen buiten de studio ──────────────────────
const GEN = join(homedir(), 'Developer', 'makelaarsplatform-generator');
const PROD = join(homedir(), 'Developer', 'makelaarsplatform-productie');
const git = (dir: string, ...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).trim();

test('generator (ontwikkelrepo) en productie-instantie: vaste commit, schone werkmap', () => {
  assert.equal(git(GEN, 'rev-parse', 'HEAD'), '4eb7f2cc3f91cb1171120bc6c5657b773aef31ae');
  assert.equal(git(GEN, 'status', '--porcelain'), '');
  assert.equal(git(PROD, 'rev-parse', 'HEAD'), '4eb7f2cc3f91cb1171120bc6c5657b773aef31ae');
  assert.equal(git(PROD, 'status', '--porcelain'), '');
});

test('referentiemanifesten ongewijzigd', () => {
  const verwacht: Record<string, string> = {
    'beusemkolkweg-16': '16e454fe50a949b5695956481c9d89a8c50bf0e7787e723dd8b573690290f2a9',
    'landgoed-rhoderlanden': 'de39a72197ba9a7463acc553cce45ad9116c8d4fc2316e90fdd9b2d5a48fa0cd',
    'markt-27-wolvega': 'c4bd101f8416e1ed7e799fcc2f713c9c833b4cd7e1e6b682b84d4e37aa547510',
  };
  for (const [w, h] of Object.entries(verwacht))
    assert.equal(createHash('sha256').update(readFileSync(join(GEN, 'woningen', w, 'manifest.json'))).digest('hex'), h, w);
});

test('goedgekeurde concepten 1, 3, 4 en 5 ongewijzigd (sha256-lijsten)', () => {
  const basis = join(GEN, 'praktijktest', 'markt-27-wolvega');
  for (const c of [1, 3, 4, 5]) {
    const lijst = readFileSync(join(basis, `concept-${c}.sha256`), 'utf8').trim().split('\n');
    for (const regel of lijst) {
      const [hash, pad] = regel.split(/\s+/);
      const bestand = join(basis, `concept-${c}`, pad);
      assert.ok(existsSync(bestand), `${bestand} bestaat`);
      assert.equal(createHash('sha256').update(readFileSync(bestand)).digest('hex'), hash, `concept-${c}/${pad}`);
    }
  }
});
