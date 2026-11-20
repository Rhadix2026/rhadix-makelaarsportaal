-- Toegangsoverzicht (gebruikers en rollen per kantoor), alleen lezen.
--
-- Gebruikers, rollen en toegang worden uitsluitend centraal beheerd in het Rhadix-platform. Het
-- portaal kent alleen de gebruikers die zich hebben aangemeld; rol en lidmaatschap volgen bij elke
-- aanmelding uit het centrale token (api/src/rhadixsso.ts). Deze migratie voegt geen tabel en geen
-- schrijfrecht toe, en wijzigt de bestaande regels op gebruiker en lidmaatschap niet.
--
-- Een kantoorbeheerder mag de leden van het EIGEN kantoor inzien. De rijregels op gebruiker en
-- lidmaatschap tonen een gewone gebruiker alleen zichzelf. In plaats van die regels te verruimen
-- (dan zouden ook andere kolommen zichtbaar worden), geeft één functie precies de velden voor het
-- overzicht, en alleen als de aanvrager kantoorbeheerder van dat kantoor is (of platformbeheer).
-- Voor iedereen anders levert de functie niets op.

CREATE FUNCTION app.leden_van_kantoor(k uuid)
  RETURNS TABLE (gebruiker_id uuid, naam text, email text, rol text, bron text, actief boolean, sinds timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    -- sinds: wanneer de gebruiker in het portaal bekend werd (bij een Rhadix-gebruiker de eerste aanmelding).
    SELECT g.id, g.naam, g.email, l.rol, coalesce(g.extern_bron, 'lokaal'), g.actief, g.aangemaakt_op
    FROM lidmaatschap l JOIN gebruiker g ON g.id = l.gebruiker_id
    WHERE l.kantoor_id = k AND app.is_kantoorbeheer(k)
    ORDER BY lower(g.naam) $$;

REVOKE ALL ON FUNCTION app.leden_van_kantoor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.leden_van_kantoor(uuid) TO studio_app;
