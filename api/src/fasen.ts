// Fase-afhankelijke regels, gedeeld door de studio-API en de verwerker (zonder databaseafhankelijkheden).
// Het interne concept is afgeschermd en wordt niet gepubliceerd; wat pas vóór publicatie verplicht is,
// blokkeert het daarom niet, maar blijft als aandachtspunt zichtbaar.

/** Generatormeldingen (controleerAanlevering) die alleen vóór publicatie verplicht zijn. */
export const VOOR_PUBLICATIE = /rechten\.bevestigd ontbreekt/;
