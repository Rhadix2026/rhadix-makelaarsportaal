// Fase-afhankelijke regels, gedeeld door de studio-API en de verwerker (zonder databaseafhankelijkheden).
// Het interne concept is afgeschermd en wordt niet gepubliceerd; wat pas vóór publicatie verplicht is,
// blokkeert het daarom niet, maar blijft als aandachtspunt zichtbaar.

/** Generatormeldingen (controleerAanlevering) die alleen vóór publicatie verplicht zijn. */
export const VOOR_PUBLICATIE = /rechten\.bevestigd ontbreekt/;

// Homepagefoto (openingsbeeld). De generator vraagt voor een brochure minstens één liggende foto van
// 1200 px. Brochurefoto's zijn vaak net kleiner (bv. 1181 px). Voor het interne concept mag daarom ook een
// kleinere liggende foto bewust gekozen worden, met een waarschuwing over de beeldkwaliteit. Onder het
// minimum is een foto op een groot scherm onbruikbaar en blijft hij niet te kiezen.
export const HERO_MINIMUM = 800;   // px breed, liggend (verhouding ≥ 1,2)
export const HERO_NORM_MELDING = /geen liggende foto van minimaal \d+ px breed voor het openingsbeeld/;

/** Mag deze foto als homepagefoto gekozen worden (liggend en ten minste HERO_MINIMUM breed)? */
export const kiesbaarAlsOpeningsbeeld = (b: { breedte: number; hoogte: number }) => b.breedte / b.hoogte >= 1.2 && b.breedte >= HERO_MINIMUM;

/**
 * Blokkeert een generatormelding het interne concept niet? Publicatierechten niet; de beeldnorm van het
 * openingsbeeld niet als er bewust een (kleinere) liggende foto als openingsbeeld is aangewezen.
 */
export const nietBlokkerendVoorIntern = (f: string, heroBewustGekozen: boolean) => VOOR_PUBLICATIE.test(f) || (heroBewustGekozen && HERO_NORM_MELDING.test(f));
