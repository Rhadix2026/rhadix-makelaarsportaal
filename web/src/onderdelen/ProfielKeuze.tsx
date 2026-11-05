// Keuze uit de bestaande presentatieprofielen van de generator, met hun omschrijving.
// Alleen geldige profielen zijn kiesbaar; een opgeslagen waarde die niet (meer) bestaat wordt gemeld.
type Profiel = { naam: string; omschrijving: string };

export function ProfielKeuze({ id, waarde, profielen, onChange, leegLabel, leegUitleg }: {
  id: string; waarde: string; profielen: Profiel[]; onChange: (v: string) => void; leegLabel: string; leegUitleg: string;
}) {
  const onbekend = waarde && profielen.length > 0 && !profielen.some((p) => p.naam === waarde);
  return (
    <div className="profielkeuze" role="radiogroup" aria-labelledby={`${id}-label`}>
      {onbekend && <p className="melding melding-fout">Het opgeslagen profiel '{waarde}' bestaat niet in de generator. Kies een geldig profiel.</p>}
      <label>
        <input type="radio" name={id} checked={!waarde || !!onbekend} onChange={() => onChange('')} />
        <span><span className="profielnaam">{leegLabel}</span><div className="profieluitleg">{leegUitleg}</div></span>
      </label>
      {profielen.map((p) => (
        <label key={p.naam}>
          <input type="radio" name={id} value={p.naam} checked={waarde === p.naam} onChange={() => onChange(p.naam)} />
          <span><span className="profielnaam">{p.naam}</span><div className="profieluitleg">{p.omschrijving}</div></span>
        </label>
      ))}
    </div>
  );
}
