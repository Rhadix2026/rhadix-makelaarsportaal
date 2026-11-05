-- Basis van de studio-database (stap 1). Alleen een systeemtabel; kantoren, gebruikers en
-- woningprojecten volgen in stap 2 en 3, met kantoorscheiding (RLS) vanaf het begin.
CREATE TABLE systeem (
  sleutel text PRIMARY KEY,
  waarde  text NOT NULL,
  gezet_op timestamptz NOT NULL DEFAULT now()
);

INSERT INTO systeem (sleutel, waarde) VALUES ('opgezet_op', now()::text);
