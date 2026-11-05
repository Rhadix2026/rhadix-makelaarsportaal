// Tijdregistratie: machinetijd, actieve gebruikerstijd en kalenderdoorlooptijd, afzonderlijk.
//
// Actieve gebruikerstijd wordt afgeleid uit interactiemomenten: de interacties die de studio
// registreert (tabel activiteit) plus de handelingen die de database al kent (uploads,
// verwerkingsaanvragen, besluiten). Per gebruiker telt de tijd tussen twee opeenvolgende momenten
// alleen mee als die binnen de inactiviteitsgrens valt; een langere pauze, het verlaten van de
// studio of later hervatten telt niet mee. Het resultaat is een ondergrens: lezen vóór de eerste
// interactie van een sessie wordt niet geteld.
import type pg from 'pg';
import { config } from './config.ts';

export const SCHERMEN = ['project', 'aanlevering', 'beoordeling', 'concept'] as const;
const DREMPEL_MS = 20e3; // hoogstens één interactiemoment per gebruiker en project per 20 s

/** Legt een interactiemoment vast (gedempt). */
export async function registreerActiviteit(c: pg.PoolClient, gebruiker: string, projectId: string, scherm: string) {
  if (!(SCHERMEN as readonly string[]).includes(scherm)) return { fout: 'scherm' as const };
  const p = (await c.query('SELECT id FROM project WHERE id = $1', [projectId])).rows[0];
  if (!p) return { fout: 'onbekend' as const };
  const r = await c.query(`INSERT INTO activiteit (project_id, kantoor_id, gebruiker, scherm)
    SELECT $1, kantoor_id, $2, $3 FROM project WHERE id = $1
      AND NOT EXISTS (SELECT 1 FROM activiteit WHERE project_id = $1 AND gebruiker = $2 AND op > now() - make_interval(secs => $4))`,
    [projectId, gebruiker, scherm, DREMPEL_MS / 1000]);
  return { geregistreerd: r.rowCount === 1 };
}

type Moment = { gebruiker: string; op: Date };

/** Som per gebruiker van de tussenpozen die binnen de grens vallen. */
export function actieveTijd(momenten: Moment[], grens = config.inactiviteitMs) {
  const per = new Map<string, number[]>();
  for (const m of momenten) per.set(m.gebruiker, [...(per.get(m.gebruiker) ?? []), new Date(m.op).getTime()]);
  let ms = 0, sessies = 0, pauzes = 0;
  for (const t of per.values()) {
    t.sort((a, b) => a - b);
    sessies++;
    for (let i = 1; i < t.length; i++) {
      const d = t[i] - t[i - 1];
      if (d <= grens) ms += d; else { pauzes++; sessies++; }
    }
  }
  return { ms, sessies, pauzes, gebruikers: per.size };
}

/** Interactiemomenten van een project tot een tijdstip (alle bronnen samen). */
async function momenten(c: pg.PoolClient, projectId: string, tot: Date) {
  const q = async (sql: string) => (await c.query(sql, [projectId, tot])).rows as Moment[];
  const interacties = await q('SELECT gebruiker, op FROM activiteit WHERE project_id = $1 AND op <= $2');
  const handelingen = [
    ...await q('SELECT geupload_door AS gebruiker, geupload_op AS op FROM bestand WHERE project_id = $1 AND geupload_door IS NOT NULL AND geupload_op <= $2'),
    ...await q('SELECT aangevraagd_door AS gebruiker, aangevraagd_op AS op FROM verwerking WHERE project_id = $1 AND aangevraagd_op <= $2'),
    ...await q('SELECT door AS gebruiker, op FROM besluit WHERE project_id = $1 AND door IS NOT NULL AND op <= $2'),
  ];
  return { interacties, handelingen };
}

/**
 * Actieve gebruikerstijd tot een tijdstip, met de betrouwbaarheid. Betrouwbaar alleen als de
 * interacties vanaf de eerste handeling zijn geregistreerd; anders is het een indicatie uit de
 * handelingen alleen (ondergrens), die zo wordt gemarkeerd.
 */
export async function actief(c: pg.PoolClient, projectId: string, tot: Date, vanaf?: Date | null) {
  const { interacties, handelingen } = await momenten(c, projectId, tot);
  const binnen = (m: Moment) => !vanaf || new Date(m.op) >= vanaf;
  const alle = [...interacties, ...handelingen].filter(binnen);
  const eersteHandeling = alle.length ? Math.min(...alle.map((m) => new Date(m.op).getTime())) : null;
  const eersteInteractie = interacties.length ? Math.min(...interacties.map((m) => new Date(m.op).getTime())) : null;
  // Registratie dekt de periode als de eerste geregistreerde interactie niet later valt dan de eerste handeling (± 1 min).
  const betrouwbaar = eersteInteractie != null && eersteHandeling != null && eersteInteractie <= eersteHandeling + 60e3;
  const r = actieveTijd(alle);
  return {
    ms: r.ms, grens_ms: config.inactiviteitMs, sessies: r.sessies, pauzes: r.pauzes, gebruikers: r.gebruikers,
    interacties: interacties.filter(binnen).length, handelingen: handelingen.filter(binnen).length,
    registratie_vanaf: eersteInteractie ? new Date(eersteInteractie).toISOString() : null,
    betrouwbaar,
    toelichting: betrouwbaar
      ? `som van de tussenpozen tussen interacties tot ${Math.round(config.inactiviteitMs / 60e3)} min; langere pauzes tellen niet mee (ondergrens: lezen vóór de eerste interactie telt niet)`
      : interacties.length
        ? `onvolledig: interacties pas geregistreerd vanaf ${new Date(eersteInteractie!).toLocaleString('nl-NL')}; daarvoor alleen uploads, aanvragen en besluiten (ondergrens)`
        : 'niet geregistreerd: alleen afgeleid uit uploads, aanvragen en besluiten (ondergrens; lezen en controleren zonder handeling telt niet)',
  };
}
