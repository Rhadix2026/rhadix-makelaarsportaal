// Databaseverbinding en een kleine migratierunner: plain-SQL-bestanden in db/migraties, in
// naamvolgorde, elk één keer en in één transactie. Toegepaste migraties staan in schema_migratie.
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { config, ROOT } from './config.ts';

export const pool = new pg.Pool({ connectionString: config.dbUrl, max: 5 });

const MAP = join(ROOT, 'db', 'migraties');

export async function migreer(): Promise<string[]> {
  const c = await pool.connect();
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migratie (
      naam text PRIMARY KEY, sha256 text NOT NULL, toegepast_op timestamptz NOT NULL DEFAULT now())`);
    const gedaan = new Map((await c.query('SELECT naam, sha256 FROM schema_migratie')).rows.map((r) => [r.naam, r.sha256]));
    const nieuw: string[] = [];
    for (const naam of readdirSync(MAP).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = readFileSync(join(MAP, naam), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      if (gedaan.has(naam)) {
        if (gedaan.get(naam) !== hash) throw new Error(`migratie ${naam} is gewijzigd na toepassing; maak een nieuwe migratie`);
        continue;
      }
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO schema_migratie (naam, sha256) VALUES ($1, $2)', [naam, hash]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
      nieuw.push(naam);
    }
    return nieuw;
  } finally { c.release(); }
}

export async function databaseStatus() {
  try {
    const v = await pool.query("SELECT current_setting('server_version') AS versie");
    const m = await pool.query('SELECT naam, toegepast_op FROM schema_migratie ORDER BY naam');
    return { verbonden: true, versie: v.rows[0].versie as string, migraties: m.rows.map((r) => r.naam as string) };
  } catch (e) {
    return { verbonden: false, fout: (e as Error).message, migraties: [] as string[] };
  }
}
