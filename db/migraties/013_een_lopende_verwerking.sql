-- Hoogstens één lopende verwerking (wachtrij of bezig) per project, afgedwongen in de database.
-- De API controleerde dit al vooraf; deze index sluit de race tussen twee gelijktijdige verzoeken
-- (controle en insert zijn twee stappen). Kwaliteitscontroles worden direct als 'klaar' vastgelegd
-- en vallen er dus buiten.
CREATE UNIQUE INDEX verwerking_een_lopend ON verwerking (project_id) WHERE status IN ('wachtrij', 'bezig');
