// Gebruikers en rollen: alleen-lezen overzicht van wie toegang heeft tot het makelaarsportaal.
//
// Gebruikers, rollen, licenties en toegang tot applicaties worden UITSLUITEND centraal beheerd in het
// Rhadix-platform. Het portaal heeft geen eigen gebruikersbeheer en geen dubbele rollenadministratie:
// een gebruiker verschijnt hier na de eerste aanmelding, en rol en kantoor volgen bij elke aanmelding
// uit het centrale token (rhadixsso.ts). Dit overzicht wijzigt niets.
//
//   platformbeheer    alle kantoren, met de gekoppelde Rhadix-organisatie, de platformbeheerders en
//                     een verwijzing naar het centrale beheer
//   kantoorbeheerder  alleen de eigen kantoren (app.leden_van_kantoor, migratie 014); geen verwijzing
//                     naar het centrale beheer en geen mogelijkheid om iets te wijzigen
//   makelaar          geen toegang (403)
import type pg from 'pg';

export type Lid = { gebruiker_id: string; naam: string; email: string; rol: 'kantoorbeheerder' | 'makelaar'; bron: string; actief: boolean; sinds: string };

export async function toegangsoverzicht(c: pg.PoolClient, platformbeheer: boolean) {
  // kantoor_lezen (RLS): platformbeheer ziet alle kantoren, anderen alleen de eigen; daarna alleen
  // die waarvan de aanvrager kantoorbeheerder is.
  const kantoren = (await c.query(`SELECT k.id, k.merknaam, k.slug, k.status, k.rhadix_tenant_id
      FROM kantoor k WHERE app.is_kantoorbeheer(k.id) ORDER BY lower(k.merknaam)`)).rows;
  if (!platformbeheer && !kantoren.length) return null;
  const organisaties = platformbeheer
    ? new Map((await c.query('SELECT tenant_id, naam FROM rhadix_organisatie')).rows.map((r) => [r.tenant_id, r.naam as string])) : new Map();
  const uit = [];
  for (const k of kantoren) {
    const leden = (await c.query('SELECT * FROM app.leden_van_kantoor($1)', [k.id])).rows as Lid[];
    uit.push({
      id: k.id as string, merknaam: k.merknaam as string, slug: k.slug as string, status: k.status as string,
      // Alleen voor platformbeheer: de koppeling met de centrale organisatie.
      ...(platformbeheer ? { rhadix_organisatie: k.rhadix_tenant_id ? { tenant_id: k.rhadix_tenant_id as string, naam: organisaties.get(k.rhadix_tenant_id) ?? null } : null } : {}),
      leden,
    });
  }
  const platformbeheerders = platformbeheer
    ? (await c.query(`SELECT id AS gebruiker_id, naam, email, coalesce(extern_bron, 'lokaal') AS bron, actief, aangemaakt_op AS sinds
        FROM gebruiker WHERE platformrol = 'platformbeheer' ORDER BY lower(naam)`)).rows : undefined;
  return { kantoren: uit, ...(platformbeheerders ? { platformbeheerders } : {}) };
}
