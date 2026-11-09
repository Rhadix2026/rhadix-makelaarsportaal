// Rechten van de ingelogde gebruiker per woningproject of kantoor (migratie 010). De interface toont
// alleen de handelingen die passen; de API en de database dwingen dezelfde regels zelf af.
import { useEffect, useState } from 'react';
import { api, type Ik } from '../api.ts';

export type Rechten = { produceren: boolean; kantoorbeheer: boolean };
const GEEN: Rechten = { produceren: false, kantoorbeheer: false };

/** Productiewerk (alle rollen in het eigen kantoor) en kantoorbeheer, voor één woningproject. */
export function useRechten(projectId: string): Rechten {
  const [r, setR] = useState<Rechten>(GEEN);
  useEffect(() => { api<Rechten>(`/api/projecten/${projectId}/rechten`).then(setR, () => setR(GEEN)); }, [projectId]);
  return r;
}

/** Mag deze gebruiker in dit kantoor werken, en is hij er kantoorbeheerder? */
export function kantoorRechten(ik: Ik, kantoorId: string): Rechten {
  if (ik.platformbeheer) return { produceren: true, kantoorbeheer: true };
  const l = ik.kantoren.find((k) => k.id === kantoorId);
  return { produceren: !!l, kantoorbeheer: l?.rol === 'kantoorbeheerder' };
}

/** Mag deze gebruiker ergens woningprojecten aanmaken? */
export const magProjectenAanmaken = (ik: Ik) => ik.platformbeheer || ik.kantoren.length > 0;
