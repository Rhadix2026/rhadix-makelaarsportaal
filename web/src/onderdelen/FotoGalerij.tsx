// Visuele fotokeuze (stap 3A.2): miniaturen van de werkelijk geïmporteerde foto's, met het
// oorspronkelijke paginanummer en het volgnummer op die pagina. Gebruikt de bestaande bestands-ID's en
// de bestaande miniatuurroute (/api/bestanden/:id/miniatuur). Eén keuze tegelijk.
export type GalerijFoto = { id: string; pagina: number | null; nummer: number | null; aantal_op_pagina: number | null; herkomst: string; breedte: number; hoogte: number };

export const fotoLabel = (f: GalerijFoto) =>
  f.pagina == null ? (f.herkomst === 'upload' ? 'Losse foto' : 'Foto')
    : `Pagina ${f.pagina}${f.aantal_op_pagina && f.aantal_op_pagina > 1 ? ` · foto ${f.nummer} van ${f.aantal_op_pagina}` : ''}`;

export function FotoGalerij({ fotos, gekozen, onKies, kiesbaar, waarschuwing, bezig, label, voorstel }: {
  fotos: GalerijFoto[]; gekozen: string | null; onKies: (id: string) => void; bezig?: boolean; label: string;
  /** Mag deze foto gekozen worden? Zo niet: de reden (de foto blijft zichtbaar, maar niet te kiezen). */
  kiesbaar?: (f: GalerijFoto) => string | null; voorstel?: string | null;
  /** Kiesbaar, maar met een kanttekening (bv. lagere resolutie). */
  waarschuwing?: (f: GalerijFoto) => string | null;
}) {
  return (
    <div className="galerij" role="radiogroup" aria-label={label}>
      {fotos.map((f) => {
        const reden = kiesbaar?.(f) ?? null;
        const isGekozen = gekozen === f.id;
        const let_op = reden ? null : waarschuwing?.(f) ?? null;
        return (
          <button key={f.id} type="button" role="radio" aria-checked={isGekozen} disabled={!!reden || bezig}
            className={`galerij-foto${isGekozen ? ' galerij-gekozen' : ''}${reden ? ' galerij-ongeschikt' : ''}`}
            onClick={() => onKies(f.id)} title={reden ?? undefined}>
            <img src={`/api/bestanden/${f.id}/miniatuur`} alt={fotoLabel(f)} loading="lazy" />
            <span className="galerij-label">
              {fotoLabel(f)}
              {isGekozen && <strong className="galerij-vink">✓ Gekozen</strong>}
              {!isGekozen && voorstel === f.id && !reden && <span className="galerij-chip">voorstel</span>}
              {reden && <span className="galerij-reden">{reden}</span>}
              {let_op && <span className="galerij-let-op">{let_op}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
