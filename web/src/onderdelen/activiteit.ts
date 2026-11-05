// Registreert interactiemomenten op een projectscherm, voor de actieve gebruikerstijd. Alleen het
// tijdstip en het scherm, geen inhoud. Hoogstens één melding per 30 s en alleen als het venster
// zichtbaar is: een verborgen tabblad, een pauze of het verlaten van de studio levert niets op.
import { useEffect } from 'react';
import { api } from '../api.ts';

const INTERVAL_MS = 30e3;
const GEBEURTENISSEN = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export function useActiviteit(projectId: string, scherm: 'project' | 'aanlevering' | 'beoordeling' | 'concept') {
  useEffect(() => {
    let laatst = 0;
    const meld = () => {
      if (document.visibilityState !== 'visible') return;
      const nu = Date.now();
      if (nu - laatst < INTERVAL_MS) return;
      laatst = nu;
      api(`/api/projecten/${projectId}/activiteit`, { methode: 'POST', data: { scherm } }).catch(() => { /* meting is niet kritisch */ });
    };
    meld(); // het openen van het scherm telt als interactie
    for (const g of GEBEURTENISSEN) addEventListener(g, meld, { passive: true, capture: true });
    return () => { for (const g of GEBEURTENISSEN) removeEventListener(g, meld, { capture: true }); };
  }, [projectId, scherm]);
}
