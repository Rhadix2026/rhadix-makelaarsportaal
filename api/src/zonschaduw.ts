// Zon- en schaduwvisualisatie in de conceptwebsite (stap 3A.4).
//
// De interactieve simulatie (datumkeuze en tijdschuif, zie ~/Developer/zonnestudie-poc) is nog niet aan de
// generator gekoppeld. Er wordt daarom niets berekend en niets gesimuleerd. Is de visualisatie aangevraagd, dan
// toont de AFGESCHERMDE preview een duidelijke interne plaatshouder als afzonderlijk onderdeel van de pagina.
//
// Waarom alleen bij het serveren van de preview (/api/voorbeeld) en niet in de generator of de opgeslagen site:
// de gegenereerde site op schijf blijft ongewijzigd, dus de plaatshouder kan nooit met een publicatie mee.
import type pg from 'pg';

export const PLAATSHOUDER_MARKERING = 'data-mp-intern="zon-schaduw"';

export type ZonAanvraag = { gewenst: boolean; adres: string | null; foto: string | null; op: string; door: string | null };

/** De aanvraag zoals die gold toen het concept werd gemaakt (het laatste besluit vóór dat moment). */
export async function aanvraagBijConcept(c: pg.PoolClient | pg.Pool, projectId: string, aangemaaktOp: Date | string): Promise<ZonAanvraag | null> {
  const r = (await c.query(`SELECT b.waarde, b.op, g.naam AS door FROM besluit b LEFT JOIN gebruiker g ON g.id = b.door
    WHERE b.project_id = $1 AND b.onderwerp = 'zonschaduw' AND b.op <= $2 ORDER BY b.op DESC, b.id DESC LIMIT 1`, [projectId, aangemaaktOp])).rows[0];
  if (!r) return null;
  let foto: string | null = null;
  if (r.waarde?.bestand_id) {
    const f = (await c.query('SELECT pagina, herkomst FROM bestand WHERE id = $1', [r.waarde.bestand_id])).rows[0];
    foto = f ? (f.pagina != null ? `brochure, pagina ${f.pagina}` : 'losse foto') : null;
  }
  return { gewenst: !!r.waarde?.gewenst, adres: r.waarde?.adres ?? null, foto, op: new Date(r.op).toISOString(), door: r.door ?? null };
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Interne plaatshouder als eigen sectie, vóór de afsluiting (contact). Zonder aanvraag: html ongewijzigd. */
export function metInternePlaatshouder(html: string, a: ZonAanvraag | null): string {
  if (!a?.gewenst || html.includes(PLAATSHOUDER_MARKERING)) return html;
  const datum = new Date(a.op).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Amsterdam' });
  const sectie = `
<section id="zon-en-schaduw" class="band" ${PLAATSHOUDER_MARKERING} aria-label="Zon en schaduw (interne plaatshouder)">
 <style>
  [data-mp-intern] .mp-intern{border:3px dashed #b45309;background:repeating-linear-gradient(135deg,#fffbeb 0 18px,#fef3c7 18px 36px);color:#451a03;border-radius:10px;padding:clamp(18px,4vw,36px);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5}
  [data-mp-intern] .mp-intern-label{display:inline-block;background:#b45309;color:#fff;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;padding:4px 10px;border-radius:4px;margin-bottom:12px}
  [data-mp-intern] .mp-intern h2{margin:.2em 0 .4em}
  [data-mp-intern] .mp-intern dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:14px 0 0}
  [data-mp-intern] .mp-intern dt{font-weight:600}
  [data-mp-intern] .mp-intern dd{margin:0}
  @media (max-width:520px){[data-mp-intern] .mp-intern dl{grid-template-columns:1fr}}
 </style>
 <div class="wrap">
  <div class="mp-intern" role="note">
   <span class="mp-intern-label">Intern · alleen in de afgeschermde preview</span>
   <h2>Zon en schaduw</h2>
   <p>Hier komt de interactieve zon- en schaduwsimulatie van deze woning, met een datumkeuze en een tijdschuif.
   <strong>Deze is nog niet berekend</strong>: er worden geen zonuren of schaduwen getoond. Rhadix maakt de berekening
   en controleert de locatie en de foto. Dit blok wordt nooit gepubliceerd.</p>
   <dl>
    <dt>Aangevraagd</dt><dd>${esc(datum)}${a.door ? ` door ${esc(a.door)}` : ''}</dd>
    <dt>Locatie</dt><dd>${esc(a.adres ?? 'adres nog niet bekend')} (uit de brochure; nog te controleren)</dd>
    <dt>Gekozen foto</dt><dd>${esc(a.foto ?? 'nog niet gekozen')}</dd>
   </dl>
  </div>
 </div>
</section>
`;
  const plek = html.search(/<section[^>]*\bid="contact"/);
  if (plek >= 0) return html.slice(0, plek) + sectie + html.slice(plek);
  const eind = html.search(/<footer\b|<\/main>|<\/body>/);
  return eind >= 0 ? html.slice(0, eind) + sectie + html.slice(eind) : html + sectie;
}
