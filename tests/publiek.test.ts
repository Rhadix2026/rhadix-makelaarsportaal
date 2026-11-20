// Stap 3A.4: publieke naam, navigatie voor kopers en de interne plaatshouder voor zon/schaduw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navigatieVoorKopers, publiekeNaam } from '../api/src/publiek.ts';
import { metInternePlaatshouder, PLAATSHOUDER_MARKERING } from '../api/src/zonschaduw.ts';

test('publieke naam: objectadres, nooit de interne projectnaam', () => {
  assert.equal(publiekeNaam({ adres: 'Beusemkolkweg 16', plaats: 'Tilligte' }), 'Beusemkolkweg 16');
  assert.equal(publiekeNaam({ adres: ' ', plaats: 'Tilligte' }), 'Tilligte');
  assert.equal(publiekeNaam({ adres: 'Beusemkolkweg 16', objectnaam: 'Erve Beusemkolk' }), 'Erve Beusemkolk', 'expliciete objectnaam gaat voor');
  assert.equal(publiekeNaam({}), 'Woning');
});

// De koppen van Beusemkolkweg 16 (brochure-import), zonder de brochuretekst.
const BEUSEMKOLKWEG = `# teksten
status: concept
herkomst: brochure

# hero
eyebrow: Tilligte
titel: Beusemkolkweg 16

# hoofdstuk beschrijving
nav: Beschrijving
titel: Beschrijving
Tekst.

# hoofdstuk indeling-begane-grond
nav: Begane grond
titel: Indeling begane grond
- entree

# hoofdstuk indeling-eerste-en-tweede-verdieping
nav: Eerste en tweede
titel: Indeling eerste en tweede verdieping
- slaapkamers

# hoofdstuk indeling-begane-grond-kantoor
nav: Begane grond kantoor
titel: Indeling begane grond kantoor
- entree

# hoofdstuk verdieping
nav: Verdieping
titel: Verdieping
- multifunctionele ruimte

# hoofdstuk bijzonderheden
nav: Bijzonderheden
titel: Bijzonderheden
- royaal

# hoofdstuk wonen-in
nav: Wonen in
titel: Wonen in
Landgoed Singraven.
`;

test('navigatie voor kopers: Beusemkolkweg 16 (benchmark)', () => {
  const { md, wijzigingen } = navigatieVoorKopers(BEUSEMKOLKWEG, 'Tilligte');
  const blok = (id: string) => md.split(`# hoofdstuk ${id}\n`)[1].split('\n# ')[0];
  const nav = (id: string) => blok(id).match(/^nav: (.*)$/m)?.[1] ?? null;
  const titel = (id: string) => blok(id).match(/^titel: (.*)$/m)?.[1];
  assert.equal(nav('beschrijving'), 'Beschrijving');
  assert.equal(nav('indeling-begane-grond'), 'Begane grond');
  assert.equal(nav('indeling-eerste-en-tweede-verdieping'), 'Verdiepingen', 'niet meer afgekapt');
  assert.equal(titel('indeling-eerste-en-tweede-verdieping'), 'Indeling eerste en tweede verdieping', 'kop ongewijzigd');
  assert.equal(nav('indeling-begane-grond-kantoor'), 'Kantoor');
  assert.equal(titel('verdieping'), 'Verdieping kantoor', 'kale verdieping hoort bij het kantoor');
  assert.equal(nav('verdieping'), null, 'geen eigen link');
  assert.equal(titel('wonen-in'), 'Wonen in de omgeving van Tilligte'); assert.equal(nav('wonen-in'), 'Omgeving');
  assert.equal(nav('bijzonderheden'), 'Bijzonderheden');
  assert.match(md, /^# hero\neyebrow: Tilligte\ntitel: Beusemkolkweg 16$/m, 'hero ongewijzigd');
  assert.ok(md.includes('Landgoed Singraven.') && md.includes('- multifunctionele ruimte'), 'teksten ongewijzigd');
  assert.equal(wijzigingen.length, 6, JSON.stringify(wijzigingen));
  // Zonder bijgebouw: een kale 'Verdieping' blijft gewoon staan.
  const los = navigatieVoorKopers('# hoofdstuk a\nnav: Begane grond\ntitel: Indeling begane grond\n\n# hoofdstuk b\nnav: Verdieping\ntitel: Verdieping\n', null);
  assert.deepEqual(los.wijzigingen, []);
  assert.equal(navigatieVoorKopers('# hoofdstuk w\nnav: Wonen in\ntitel: Wonen in\n', null).md.includes('titel: Omgeving'), true, 'zonder plaats');
});

test('zon/schaduw: interne plaatshouder vóór contact, alleen bij een aanvraag, met ontsnapte tekst', () => {
  const html = '<main><section id="wonen-in">x</section><section id="contact" class="closing">c</section></main>';
  assert.equal(metInternePlaatshouder(html, null), html);
  assert.equal(metInternePlaatshouder(html, { gewenst: false, adres: null, foto: null, op: '2026-11-20T12:00:00Z', door: null }), html, 'niet gewenst');
  const uit = metInternePlaatshouder(html, { gewenst: true, adres: 'Beusemkolkweg 16, Tilligte', foto: 'brochure, pagina 1', op: '2026-11-20T12:00:00Z', door: '<b>Jan</b>' });
  assert.ok(uit.indexOf(PLAATSHOUDER_MARKERING) < uit.indexOf('id="contact"'), 'vóór de afsluiting');
  assert.match(uit, /Intern · alleen in de afgeschermde preview/); assert.match(uit, /nog niet berekend/); assert.match(uit, /nooit gepubliceerd/);
  assert.ok(uit.includes('&lt;b&gt;Jan&lt;/b&gt;') && !uit.includes('<b>Jan</b>'), 'ontsnapt');
  assert.equal(metInternePlaatshouder(uit, { gewenst: true, adres: null, foto: null, op: '2026-11-20T12:00:00Z', door: null }), uit, 'niet dubbel');
  assert.doesNotMatch(uit, /zonuren:\s*\d|\d+\s*uur zon/i, 'geen fictieve berekening');
});
