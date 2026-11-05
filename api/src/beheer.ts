// Gebruikersbeheer via de opdrachtregel (eerste fase; een beheerscherm volgt later).
// Het wachtwoord wordt verborgen gevraagd en komt nooit in de opdrachtregel, logs of git.
//
//   npm run gebruiker -- maak --email <adres> --naam "<naam>" [--platformbeheer] [--kantoor <slug> --rol makelaar|kantoorbeheerder]
//   npm run gebruiker -- lijst
//   npm run gebruiker -- deactiveer --email <adres>
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { migreer, pool } from './db.ts';
import { hashWachtwoord, MIN_WACHTWOORD } from './auth.ts';

const [opdracht, ...rest] = process.argv.slice(2);
const optie = (n: string) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined; };
const vlag = (n: string) => rest.includes(`--${n}`);

function vraagVerborgen(vraag: string): Promise<string> {
  const stil = new Writable({ write(_c, _e, cb) { cb(); } });
  process.stdout.write(vraag);
  const rl = createInterface({ input: process.stdin, output: stil, terminal: true });
  return new Promise((ok) => rl.question('', (a) => { rl.close(); process.stdout.write('\n'); ok(a); }));
}

async function maak() {
  const email = optie('email'), naam = optie('naam');
  if (!email || !naam) throw new Error('gebruik: maak --email <adres> --naam "<naam>" [--platformbeheer] [--kantoor <slug> --rol <rol>]');
  // STUDIO_NIEUW_WACHTWOORD alleen voor geautomatiseerde test- en demo-omgevingen, nooit voor echte accounts.
  const w1 = process.env.STUDIO_NIEUW_WACHTWOORD ?? await vraagVerborgen(`Wachtwoord voor ${email} (minimaal ${MIN_WACHTWOORD} tekens): `);
  if (w1.length < MIN_WACHTWOORD) throw new Error(`wachtwoord te kort (minimaal ${MIN_WACHTWOORD} tekens)`);
  if (!process.env.STUDIO_NIEUW_WACHTWOORD && w1 !== await vraagVerborgen('Herhaal het wachtwoord: ')) throw new Error('wachtwoorden verschillen');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const g = (await c.query(`INSERT INTO gebruiker (email, naam, wachtwoord_hash, platformrol) VALUES ($1, $2, $3, $4) RETURNING id`,
      [email, naam, await hashWachtwoord(w1), vlag('platformbeheer') ? 'platformbeheer' : null])).rows[0];
    const slug = optie('kantoor');
    if (slug) {
      const k = (await c.query('SELECT id FROM kantoor WHERE slug = $1', [slug])).rows[0];
      if (!k) throw new Error(`kantoor '${slug}' niet gevonden`);
      await c.query('INSERT INTO lidmaatschap (gebruiker_id, kantoor_id, rol) VALUES ($1, $2, $3)', [g.id, k.id, optie('rol') ?? 'makelaar']);
    }
    await c.query(`INSERT INTO auditregel (gebruiker_id, actie, tabel, rij_id, nieuw) VALUES (NULL, 'aanmaken (opdrachtregel)', 'gebruiker', $1, $2)`,
      [g.id, JSON.stringify({ email, naam, platformbeheer: vlag('platformbeheer'), kantoor: slug ?? null })]);
    await c.query('COMMIT');
    console.log(`gebruiker ${email} aangemaakt${vlag('platformbeheer') ? ' (platformbeheer)' : ''}${slug ? `, lid van ${slug}` : ''}`);
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

try {
  await migreer();
  if (opdracht === 'maak') await maak();
  else if (opdracht === 'lijst') {
    for (const r of (await pool.query(`SELECT email, naam, platformrol, actief FROM gebruiker ORDER BY lower(email)`)).rows)
      console.log(`${r.email.padEnd(36)} ${r.naam.padEnd(28)} ${r.platformrol ?? '-'} ${r.actief ? '' : '(inactief)'}`);
  } else if (opdracht === 'deactiveer') {
    const r = await pool.query('UPDATE gebruiker SET actief = false WHERE lower(email) = lower($1) RETURNING id', [optie('email')]);
    if (!r.rowCount) throw new Error('gebruiker niet gevonden');
    await pool.query('DELETE FROM sessie WHERE gebruiker_id = $1', [r.rows[0].id]);
    await pool.query(`INSERT INTO auditregel (actie, tabel, rij_id) VALUES ('deactiveren (opdrachtregel)', 'gebruiker', $1)`, [r.rows[0].id]);
    console.log('gedeactiveerd; sessies beëindigd');
  } else throw new Error('gebruik: maak | lijst | deactiveer');
} catch (e) { console.error(`✗ ${(e as Error).message}`); process.exitCode = 1; } finally { await pool.end(); }
