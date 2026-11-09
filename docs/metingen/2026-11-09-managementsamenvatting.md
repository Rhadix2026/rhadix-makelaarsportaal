# Managementsamenvatting: capaciteitstest Rhadix Makelaarsportaal

**9 november 2026.** Testomgeving op een Hetzner CPX32. Volledige onderbouwing: `2026-11-09-capaciteitsrapport.md`.

## Doel

**Vraag:** kan de huidige server de pilot dragen (één makelaarskantoor, ±20 woningen)? Welke voorwaarden gelden daarbij,
en wanneer moet de server groter?

Gemeten is het zware deel van het werk: **een verkoopbrochure inlezen** (inclusief automatische herkenning van de foto's)
en **een conceptwebsite genereren**. De inhoudelijke kwaliteit van de websites valt buiten deze test.

## Aanpak

- **Nulmeting:** 66 uur rust, zonder woningen.
- **Twee meetrondes** met dezelfde drie, sterk verschillende brochures:

  | Woning | PDF | Foto's |
  |---|---|---|
  | Markt 27 | 5 MB | 37 kleine |
  | Landgoed Rhoderlanden | 8 MB | 41 zeer grote |
  | Beusemkolkweg 16 | 17 MB | 90 |

- In totaal **twaalf verwerkingen** (zes imports, zes concepten), steeds één tegelijk.
- **Gemeten:** elke twee seconden processor, geheugen, swap, opslag en fouten.
- **Tussentijdse wijziging:** de geheugengrens van de verwerking is verhoogd van 4 naar 5 GB.

## Belangrijkste resultaten

| | Licht (Markt 27) | Zwaar beeldmateriaal (Rhoderlanden) | Veel foto's (Beusemkolkweg 16) |
|---|---|---|---|
| Brochure inlezen | ±2 min | ±2,5 min | ±4,6 min |
| Conceptwebsite | ±35 s | ±40 s | ±48 s |
| Opslag per woning (1 concept) | ±66 MB | ±307 MB | ±202 MB |

- **Stabiel:** twaalf verwerkingen zonder fouten, geheugenproblemen of herstarts. Uitkomsten en opslag zijn in beide
  rondes gelijk; het proces is reproduceerbaar.
- **Geheugen:**
  - **onder 4 GB** liep de verwerking bij elke import tegen de grens aan en moest ze uitwijken naar de langzamere swap;
  - **onder 5 GB** gebeurde dat nooit: maximaal 63 % van de grens gebruikt, en op de server steeds ruim 5 GB vrij.
- **Snelheid:**
  - de duur hangt vrijwel alleen af van het **aantal foto's**: ±3 seconden per foto;
  - met 5 GB is het inlezen ±5 % sneller. Dat is waarschijnlijk door het wegvallen van swap, maar niet hard bewezen;
  - een al gevuld geheugen (cache) maakt nauwelijks verschil, en twee gelijke runs verschillen ±2 %.
- **Conceptgeneratie** is licht: minder dan 1 GB werkgeheugen.
- **De interface** bleef tijdens alle verwerkingen gewoon bruikbaar.

## Stabiliteit en schaalbaarheid

**Twintig woningen:**

| | Verwachting |
|---|---|
| Rekentijd | ±75 minuten (licht ±50, zwaar ±110 minuten) |
| Klaar per woning | binnen 3–6 minuten, bij aanlevering van enkele woningen per dag |
| Bij 20 tegelijk aangeleverd | de laatste woning wacht ±1,5 uur in de rij |
| Opslag, met meerdere conceptversies | ±9 GB (±3–14 GB, afhankelijk van de foto's), bij 93 GB vrij |
| Back-ups | groeien veel minder (dubbele foto's tellen één keer) |

**Grenzen van de opzet:**
- **Eén verwerking tegelijk** is op 4 vCPU de juiste keuze: de server is tijdens een verwerking vrijwel volledig benut.
  Twee tegelijk levert hier geen tijdwinst op.
- **Test en productie tegelijk zwaar laten verwerken** past niet ruim. Dat vraagt een afspraak, of later een grotere
  server.

## Advies voor de pilot

**De huidige CPX32 is voldoende voor de pilot met twintig woningen. Een grotere server is nu niet nodig.**

**Voorwaarden:**
1. De geheugengrens van 5 GB blijft, met één verwerking tegelijk.
2. Zodra productie draait: geen zware testverwerkingen tijdens productie-imports.
3. Brochures blijven onder 100 MB (de uploadgrens van Cloudflare).
4. De bestaande monitoring blijft aan; maandelijks worden de grenswaarden gecontroleerd.

## Risico's en vervolgstappen

**Risico's:**
- uitzonderlijk zware brochures (meer dan 100 grote foto's): langere doorlooptijd en meer opslag;
- piekaanlevering: een lange wachtrij;
- test en productie die elkaar beïnvloeden;
- de gedeelde processor van de cloudserver kan op drukke momenten iets trager zijn.

**Wanneer opschalen** (naar een CPX42 met 8 vCPU en 16 GB; eenvoudig te doen):
- productie en test moeten structureel tegelijk zwaar verwerken;
- de wachttijd komt regelmatig boven ±15 minuten;
- de verwerking gaat weer swappen;
- er komen meer kantoren bij (vanaf ±50 actieve woningen per maand).

**Aanbevolen vervolg:**
1. Vóór de livegang een test met productie en test tegelijk, en een reeks van 10–20 woningen achter elkaar.
2. Eén extreme brochure testen.
3. Later een opslagbeleid voor oude conceptversies.
4. Bij een onderhoudsmoment ±45 GB tijdelijke buildbestanden opruimen.
5. Apart vervolgtraject: de inhoudelijke kwaliteit van de gegenereerde websites.
