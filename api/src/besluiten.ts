// Besluitenlog: elke menselijke beslissing in de beoordeling (wie, wat, wanneer, waarom).
// Alleen aanvullen; de database staat wijzigen of verwijderen niet toe.
import type pg from 'pg';

export async function legVast(c: pg.PoolClient, b: { project: string; door: string; onderwerp: string; handeling: string; waarde?: unknown; motivering?: string | null }) {
  await c.query(`INSERT INTO besluit (project_id, kantoor_id, onderwerp, handeling, waarde, motivering, door)
    SELECT $1, kantoor_id, $2, $3, $4, $5, $6 FROM project WHERE id = $1`,
    [b.project, b.onderwerp, b.handeling, b.waarde === undefined ? null : JSON.stringify(b.waarde), b.motivering?.trim() || null, b.door]);
}

export async function leesBesluiten(c: pg.PoolClient, project: string) {
  return (await c.query(`SELECT b.id, b.onderwerp, b.handeling, b.waarde, b.motivering, b.op, g.naam AS door
    FROM besluit b LEFT JOIN gebruiker g ON g.id = b.door WHERE b.project_id = $1 ORDER BY b.op DESC, b.id DESC`, [project])).rows;
}
