// Korte, herkenbare bestandsnaam voor op het scherm. De volledige naam blijft bewaard (en staat in
// de tooltip). Technische namen (hashes, uuid's, base64 uit mailbijlagen) worden vervangen door een
// omschrijving; lange gewone namen worden in het midden ingekort, met behoud van de extensie.
export function kortNaam(naam: string, omschrijving = 'Bestand', max = 34): string {
  const schoon = naam.split(/[\\/]/).pop() ?? naam;
  const m = schoon.match(/^(.*?)(\.[A-Za-z0-9]{2,5})?$/);
  const stam = m?.[1] ?? schoon, ext = (m?.[2] ?? '').toLowerCase();
  const woorden = stam.split(/[\s_\-.]+/).filter(Boolean);
  const technisch = /[0-9a-f]{8}-[0-9a-f]{4}-/i.test(stam) || /\b[0-9a-f]{24,}\b/i.test(stam)
    || woorden.some((w) => w.length >= 24 && /\d/.test(w) && /[A-Za-z]/.test(w));
  if (technisch || !stam.trim()) return `${omschrijving}${ext}`;
  if (schoon.length <= max) return schoon;
  const ruimte = max - ext.length - 1;
  return `${stam.slice(0, Math.ceil(ruimte * 0.6)).trimEnd()}…${stam.slice(-Math.floor(ruimte * 0.4)).trimStart()}${ext}`;
}
