# Capaciteitsrapport: Rhadix Makelaarsportaal, testomgeving (Hetzner CPX32)

**Datum:** 9 november 2026. **Omgeving:** `makelaarsportaal-test.rhadix.nl`. Productie draait nog niet.

**Onderliggende stukken**, in `docs/metingen/`:

| Bestand | Inhoud |
|---|---|
| `2026-11-09-nulmeting.md` | nulmeting en ronde 1, uitgebreid (§1–§16) |
| `2026-11-09-meetronde-1-referentie.md` | referentie ronde 1, voorbereiding ronde 2 en de verwijdering |
| `2026-11-09-meetronde-2.md` | ronde 2 (§1–§7) |
| `meetronde-1/` | ruwe gegevens: 5-minutenmeting, fijne meting, verwerkingen, configuratie |
| `2026-11-09-managementsamenvatting.md` | samenvatting voor het management |

**Buiten scope:** de inhoudelijke kwaliteit van de gegenereerde websites.

---

## 1. Doel en meetopzet

**Doel:** vaststellen of één CPX32 de pilot aankan (één makelaarskantoor, ±20 woningen), welke grenzen daarbij
gelden, en wanneer opschalen nodig wordt.

**Opzet:**
- **Nulmeting:** 66 uur rust zonder woningen.
- **Twee meetrondes met dezelfde drie brochures,** die sterk verschillen:

  | Woning | PDF | Beelden | Kenmerk |
  |---|---|---|---|
  | Markt 27 | 5,2 MB, 12 p. | 37 kleine beelden | ±131 kB per beeld |
  | Landgoed Rhoderlanden | 8,3 MB, 50 p. | 41 grote beelden | ±1,4 MB per beeld |
  | Beusemkolkweg 16 | 17,4 MB, 60 p. | 90 beelden | ±170 kB per beeld |

- **Per woning:** brochure-import (met beeldclassificatie), vrijgave, conceptgeneratie. Strikt na elkaar, met één
  verwerking tegelijk (de wachtrij van de applicatie).
- **Monitoring:**
  - een 5-minutenmeting van systeem en containers, de hele periode;
  - een **fijne meting** elke 2 s tijdens verwerkingen, met per container CPU, geheugen, swap, werkgeheugen (`anon`)
    en bestandscache (`file`), rechtstreeks uit de cgroups. Actief vanaf ronde 1, na de eerste import;
  - de cgroup-tellers van de verwerker (`memory.peak`, `memory.swap.peak`, `memory.events`);
  - de verwerkingsregistratie met tijden per stap, en de logs.
- **Ingrepen tijdens de meetperiode:**
  - verwerkergrens van 4 naar 5 GB (9-11 13:33:40 UTC), na de eerste twee woningen van ronde 1. Alleen de verwerker
    is herstart;
  - verwijdering van de drie testprojecten tussen de rondes (met back-up `67535ef2` en een geslaagde hersteltest);
  - ronde 2 volledig onder 5 GB, zonder wijzigingen of herstarts.

## 2. Configuratie

| Onderdeel | Waarde |
|---|---|
| Server | Hetzner Cloud **CPX32**, Falkenstein: 4 vCPU (AMD EPYC-Genoa, gedeeld), 7.745 MiB RAM, 4 GB swap (`swappiness` 10), 160 GB SSD |
| Software | Ubuntu 24.04 (kernel 6.8.0-138), Docker 29.9.3, Compose 5.7.0 |
| Applicatie | studio `1ae95ae` (beide rondes); generator `4eb7f2c`; beeldclassificatie SigLIP (so400m) op de CPU |
| Container db | 768 MiB, 2 CPU |
| Container api | 1 GiB, 2 CPU |
| Container web | 128 MiB, 1 CPU |
| Container verwerker | 4 CPU; geheugen **4 GiB** (geheugen + swap 6 GiB) tot 13:33:40, daarna **5 GiB** (geheugen + swap 6 GiB) |
| Verwerking | één tegelijk (de wachtrij pakt alleen iets op als er niets bezig is) |
| Toegang | via Cloudflare, Rhadix-login (Datavalidatie staging) |
| Back-up | restic naar Hetzner Object Storage: dagelijks 02:30 UTC, wekelijkse hersteltest |

## 3. Nulmeting (referentie)

| Meetwaarde | Gemiddeld | Min | Max |
|---|---|---|---|
| CPU systeem | 0,3 % | 0 | 13 % (33 % tijdens de back-up) |
| RAM in gebruik | 839 MB | 801 | 867 MB |
| RAM beschikbaar | 6.906 MB | 6.877 | 6.943 MB |
| Swap | 0 | 0 | 0 |
| Containers (geheugen, max) | db 38, api 89, verwerker 78, web 6 MB | | |

Periode: 66 uur, 792 metingen, 100 % beschikbaar.

## 4. Resultaten: alle twaalf verwerkingen

### 4.1 Brochure-imports

| Woning, ronde | Grens | Cache bij de start | Totaal | Classificatie | Beelden | **s per beeld** | Verwerker-CPU gem. / max | Verwerker totaal max | Werkgeheugen max | **Swap verwerker** | Server beschikbaar min | Opslag + |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Markt 27, R1 | 4 GB | opgebouwd | 127,9 s | 117,4 s | 37 | 3,17 | ±290 % / — ¹ | 4.096 MB (grens) | onbekend ¹ | **301 MB** | ±2,5 GB ¹ | +14,9 MB |
| Markt 27, R2 | 5 GB | warm | 120,2 s | 111,6 s | 37 | **3,02** | 306 / 342 % | 2.561 MB | 1.281 MB | **0** | 5.451 MB | +15,2 MB |
| Rhoderlanden, R1 | 4 GB | opgebouwd | 156,7 s | 137,5 s | 41 | 3,35 | 283 / 326 % | 4.095 MB (grens, 1.402×) | 1.118 MB ² | **509 MB, ±100 s** | 5.651 MB | +74,5 MB |
| Rhoderlanden, R2 | 5 GB | warm | 148,8 s | 130,6 s | 41 | **3,19** | 294 / 336 % | 2.613 MB | 1.221 MB | **0** | 5.441 MB | +74,5 MB |
| Beusemkolkweg 16, R1 | 5 GB | **koud** (vers) | 273,3 s | 249,5 s | 90 | 2,77 | 299 / 328 % | 2.599 MB | 1.385 MB | **0** | 5.302 MB | +50,8 MB |
| Beusemkolkweg 16, R2 | 5 GB | warm | 276,5 s | 254,3 s | 90 | 2,83 | 300 / 335 % | 3.136 MB | 1.396 MB | **0** | 5.208 MB | +50,8 MB |

¹ Vóór de fijne meting: één 5-minutenmeting en de cgroup-tellers.
² Exclusief ±0,5 GB die op dat moment in swap stond.

### 4.2 Conceptgeneraties

| Woning, ronde | Grens | Totaal | Bouw | Kwaliteitscontrole | Verwerker-CPU gem. / max | Werkgeheugen max | Verwerker totaal max | Swap verwerker | Server beschikbaar min | Conceptmap | Waarschuwingen |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Markt 27, R1 | 4 GB | 36,2 s | 13,2 s | 22,0 s | 125 / 381 % | 755 MB | 1.114 MB | 0 | 6.166 MB | 46,6 MB | 17 |
| Markt 27, R2 | 5 GB | 34,1 s | 11,1 s | 22,3 s | 122 / 369 % | 777 MB | 2.119 MB | 0 | 6.012 MB | 46,6 MB | 17 |
| Rhoderlanden, R1 | 4 GB | 41,5 s | 15,8 s | 24,2 s | 144 / 379 % | 691 MB | 4.073 MB (oude cache) | +5 MB | 6.125 MB | 175,1 MB | 16 |
| Rhoderlanden, R2 | 5 GB | 39,4 s | 14,3 s | 23,9 s | 142 / 383 % | 747 MB | 2.333 MB | 0 | 5.966 MB | 175,1 MB | 16 |
| Beusemkolkweg 16, R1 | 5 GB | 48,7 s | 21,7 s | 25,7 s | 175 / 382 % | 778 MB | 2.296 MB | 0 | 5.906 MB | 136,3 MB | 23 |
| Beusemkolkweg 16, R2 | 5 GB | 47,8 s | 21,0 s | 25,8 s | 176 / 383 % | 798 MB | 2.973 MB | 0 | 5.754 MB | 136,3 MB | 23 |

Alle conceptgeneraties: 0 blokkerende punten.

### 4.3 Overige containers en systeem

- **API:** CPU maximaal 5 %. Het geheugen groeide door het bekijken van previews van 86 naar ±350 MB (grens 1 GB) en
  bleef stabiel.
- **Database:** CPU maximaal 7 % (één checkpoint 25 %), geheugen maximaal 62 MB. **Web:** 4–6 MB.
- **Systeem over alle verwerkingen:** maximaal 2.538 MB in gebruik en minimaal **5.208 MB** beschikbaar (ronde 2). De
  systeem-CPU piekt op 97 % tijdens de bouw van een concept.
- **Interface tijdens verwerkingen:** het platform bleef bereikbaar; de API-CPU bleef < 5 %.

### 4.4 Stabiliteit

- **Twaalf meetverwerkingen, 0 fouten**, 0 OOM, 0 herstarts.
- **Niet meegeteld:** één eerdere conceptpoging (ronde 1, Markt 27) mislukte op een RLS-regel. Die is hersteld
  (migratie 011), en de herhaling slaagde.
- **Verwerker onder 5 GB:** draait sinds 13:33:40 UTC zonder herstart. De grens is 0× geraakt, `memory.swap.peak` is
  0, en de hoogste piek is 3.232 MiB (63 % van de grens).
- **Herhaalbaarheid:**
  - de imports leveren in beide rondes byte-gelijke beelden en dezelfde gegevens;
  - de concepten zijn even groot en hebben evenveel kwaliteitsmeldingen.

### 4.5 Opslag en database

| Woning | Bron en import | Kwaliteitscontrole (per keer) | Conceptversie (per keer) | Totaal: import, 1 controle en 1 concept |
|---|---|---|---|---|
| Markt 27 | 15,2 MB | 4,5 MB | 46,6 MB | 66 MB |
| Rhoderlanden | 74,5 MB | 57,5 MB | 175,1 MB | 307 MB |
| Beusemkolkweg 16 | 50,8 MB | 15,1 MB | 136,3 MB | 202 MB |

**Opslag:**
- elke kwaliteitscontrole en elke conceptversie bewaart een eigen kopie van de foto's; daarom bepaalt de fotomaat de
  omvang;
- miniaturen ontstaan pas bij het bekijken: ±30 kB per beeld.

**Database:** de groei is verwaarloosbaar, +0,05–0,15 MB per woning (9,8 MB voor drie woningen in ronde 2).

**Back-up:** restic ontdubbelt. De laatste back-up bevatte 630 MiB aan bestanden en neemt, met vier snapshots, 204 MiB
in. Dubbele fotokopieën kosten in de back-up dus vrijwel niets.

## 5. Analyse: wat verklaart de verschillen?

| Factor | Bevinding | Zekerheid |
|---|---|---|
| **Geheugengrens 4 naar 5 GB** | Onder 4 GB raakte de verwerker bij elke import de grens en swapte (301 en 509 MB, ±100 s); onder 5 GB nooit (0 MB, grens 0×). | **Aangetoond**, in vier vergelijkbare imports |
| ‣ effect op de tijd | Bij Markt 27 en Rhoderlanden is ronde 2 −5 % per beeld. | **Aannemelijk, niet bewezen**: één meting per situatie, en het verschil ligt niet ver boven de spreiding |
| ‣ effect op conceptgeneratie | Geen. Het werkgeheugen blijft < 0,8 GB, en de grens werd ook onder 4 GB niet benut. | Aangetoond |
| **Cache** (model en bestanden al in het geheugen) | Beusemkolkweg: koud (R1) tegenover warm (R2) gaf geen tijdwinst (+1,9 %). Het inlezen van het model van de SSD kost hooguit enkele seconden. Een warme cache verhoogt wel het totale geheugen van de verwerker (+0,5–1 GB), maar dat is vrij te maken. | Aangetoond (één paar) |
| ‣ effect op de bouwfase van een concept | De bouw was in ronde 2 steeds iets sneller (−16, −10 en −3 %), de kwaliteitscontrole niet (+1, −1 en 0 %). Een warme paginacache voor beelden en generatorbestanden is een mogelijke verklaring. | Mogelijk |
| **Invoer** (aantal en maat van de beelden) | Bepaalt vrijwel de hele importtijd: 2,8–3,4 s per beeld. Grote beelden (Rhoderlanden) kosten ±10 % meer per beeld. De opslag groeit met de fotomaat (×0,8 tot ×6,6 de PDF-omvang). | Aangetoond |
| **Normale variatie** (gedeelde vCPU's) | Twee gelijke runs (Beusemkolkweg, beide 5 GB) verschillen 1–2 %. Verschillen van die orde zijn geen effect. | Indicatief (één paar) |
| **Achtergrondbelasting** | Tijdens geen enkele meetverwerking liepen back-up, apt of builds. Wel één Postgres-checkpoint (2,7 s) en sysstat (< 1 s). | Aangetoond (journal) |

**Correctie op een eerdere tussenconclusie:** na ronde 1 werd de werkset van de classificatie op ±4,4 GB geschat.
Gemeten met een verse verwerker is die **±2,6 GB** (±1,4 GB werkgeheugen en ±1,2 GB modelcache). De swap onder 4 GB
kwam door de combinatie met opgebouwde cache van eerdere verwerkingen.

## 6. Capaciteit voor twintig woningen

### 6.1 Verwerkingstijd (serieel, één verwerking tegelijk)

**Rekenregel uit de metingen**, per woning:
- import: ±3,0 s per beeld (2,8–3,4), plus ±10–25 s voor het lezen van de PDF;
- concept: ±35–50 s;
- elke kwaliteitscontrole: < 2 s.

| Scenario | Beelden per brochure | Machinetijd per woning | 20 woningen, serieel |
|---|---|---|---|
| Licht (zoals Markt 27) | ±40 | ±2,6 min | ±52 min |
| Gemiddeld (gemiddelde van de drie testwoningen) | ±55 | ±3,7 min | **±75 min** |
| Zwaar (zoals Beusemkolkweg 16) | ±90 | ±5,4 min | ±108 min |
| Met 2 extra conceptversies per woning | — | +1,3–1,6 min | +25–32 min |

**Gevolg voor de gebruiker:**
- Een woning staat binnen 3–6 minuten als concept klaar.
- Worden er veel tegelijk aangeleverd, dan wachten de laatste in de rij: bij 20 tegelijk tot ±1,5 uur.
- Bij aanlevering van één of enkele woningen per dag (de verwachte gang van een pilot) is er praktisch geen wachttijd.

### 6.2 Opslag

**Aanname per woning:** 1 import, 2 kwaliteitscontroles en 3 conceptversies.

| Type woning | Per woning | 20 woningen |
|---|---|---|
| Licht (Markt 27) | ±0,16 GB | ±3 GB |
| Gemiddeld | ±0,45 GB | **±9 GB** |
| Zwaar fotomateriaal (Rhoderlanden) | ±0,7 GB | ±14 GB |

**Ruimte en back-up:**
- er is 93 GB vrij (36 % in gebruik), waarvan ±45 GB tijdelijk buildmateriaal dat nog vrijgemaakt kan worden;
- door de ontdubbeling groeit de back-up naar verwachting met ±⅓ van de opslaggroei: ±3–5 GB voor 20 woningen, ruim
  binnen de 1 TB van Object Storage;
- de database blijft < 15 MB.

### 6.3 Geheugen en risico's bij zwaardere brochures

| | Waarde |
|---|---|
| Verwerker, gemeten maximum | 3,2 GB (63 % van 5 GB), waarvan ±1,4 GB werkgeheugen |
| Werkgeheugen bij meer beelden | groeit nauwelijks: 1,28, 1,22 en 1,40 GB bij 37, 41 en 90 beelden; de classificatie werkt per beeld |
| Bestandscache | groeit met eerdere verwerkingen mee, maar is vrij te maken |
| Server tijdens de zwaarste piek | ≥ 5,2 GB beschikbaar |

**Ruimte boven het gemeten maximum:** ±1,9 GB tot de grens van de verwerker, en ±3 GB systeembreed.

**Risico's** (niet gemeten):
- **brochures met veel zeer grote beelden** (meer dan ±100 beelden van > 1 MB): kost meer decodeergeheugen en meer
  tijd, en meer opslag (zoals Rhoderlanden ×6,6 de PDF);
- **PDF's > 100 MB** komen niet door Cloudflare (Free/Pro);
- **swapruimte van de verwerker:** sinds de verhoging naar 5 GB maximaal 1 GB (de swapgrens bleef 6 GB). Dat volstond
  ruim, want er werd nooit geswapt.

### 6.4 Gelijktijdige verwerking

- **Nu:** één verwerking tegelijk per omgeving. Dat is de bewuste opzet: de classificatie gebruikt ±3,1 van de
  4 vCPU, en een concept piekt op alle 4.
- **Twee verwerkingen parallel** zouden op 4 vCPU vrijwel geen doorvoer winnen (de CPU is de beperking) en elkaar
  vertragen. In het geheugen zou het nét passen (2× ±3 GB), maar zonder marge.
- **Test en productie tegelijk:** elk heeft een eigen verwerker met een grens van 5 GB.
  - Twee zware verwerkingen tegelijk kunnen samen meer geheugen vragen dan de 7,7 GB van de server.
  - Ze delen bovendien de 4 vCPU.
  - **Voorwaarde:** zodra productie draait, geen zware imports in test tijdens productie-imports, of de testverwerker
    tijdelijk stoppen of lager begrenzen.
- **Gebruikers:** meerdere gebruikers die tegelijk bladeren of beoordelen is licht (de API blijft < 5 % CPU). Dat is
  niet onder belasting getest.

### 6.5 Monitoring en grenswaarden voor opschalen

Alle signalen zijn al beschikbaar via de bestaande metingen (`systeem.csv`, `containers.csv`, `fijn.csv`, de
cgroup-tellers en `fijnmeting-rapport.py`):

| Signaal | Bron | Grens: actie overwegen |
|---|---|---|
| Swap van de verwerker | `memory.swap.peak` / `fijn.csv` | > 0 bij meer imports achter elkaar |
| Verwerkergrens geraakt | `memory.events max` | > 0 |
| Beschikbaar geheugen systeem tijdens verwerking | `fijn.csv` | < 2 GB |
| Classificatietijd per beeld | verwerking.stappen | structureel > 4 s (CPU-contentie, *steal*) |
| Wachttijd in de rij | verwerkingen (gestart minus aangevraagd) | regelmatig > 15 min |
| Schijf | `systeem.csv` | > 70 % (eerst het buildmateriaal opruimen) |
| Productie en test tegelijk met zware verwerkingen | — | structureel nodig |
| Kantoren of woningen | — | meer dan ±1 kantoor of ±50 actieve woningen per maand |

### 6.6 Is een grotere server nu nodig?

**Nee.** De metingen laten ruimte zien op elk vlak:

| Vlak | Gemeten | Ruimte |
|---|---|---|
| Geheugen | ≥ 5,2 GB vrij | ±3 GB marge boven de piek |
| CPU | goed benut tijdens verwerkingen, in rust vrijwel nul | |
| Opslag | 9–14 GB voor 20 woningen | 93 GB vrij |
| Stabiliteit | 0 fouten | |

**Opschalen binnen de CPX-familie** (CPX42: 8 vCPU, 16 GB) via "Rescale" is mogelijk. Zinvol is dat pas bij één van de
grenzen uit §6.5, in het bijzonder bij productie en test tegelijk, of bij behoefte aan kortere doorlooptijden bij grote
aanleveringen. Op 8 vCPU worden de classificatie en de bouw naar verwachting ±1,5–2× sneller, maar dat is niet gemeten.

## 7. Wat vaststaat en wat nog getest moet worden

**Volgt uit de metingen:**
- de CPX32 verwerkt de drie representatieve brochures stabiel, binnen 2–5 minuten per woning;
- 5 GB is ruim voldoende (piek 3,2 GB, geen swap); 4 GB leidde bij imports tot swap;
- conceptgeneratie is licht in geheugen (< 0,8 GB werkgeheugen);
- de tijd schaalt lineair met het aantal beelden (±3 s per beeld);
- de opslag schaalt met de fotomaat en het aantal versies;
- de cache heeft weinig invloed; de spreiding tussen gelijke runs is ±2 %.

**Nog niet getest (aanbevolen vóór of tijdens de pilot):**
1. productie en test tegelijk met zware verwerkingen;
2. een reeks van ±10–20 woningen achter elkaar, met opgebouwde cache en de doorlooptijd van de wachtrij;
3. een extreme brochure: > 100 beelden, of grote beelden met een PDF tussen 50 en 100 MB;
4. meerdere gelijktijdige gebruikers tijdens een verwerking;
5. de duur van de back-up en het herstel bij ±10 GB opslag;
6. de CPU-*steal* op drukke momenten van de gedeelde host, over langere tijd;
7. uploads via Cloudflare vanaf trage verbindingen.

## 8. Aanbevelingen

1. **CPX32 handhaven voor de pilot**, met de verwerkergrens van 5 GB en één verwerking tegelijk.
2. **Zodra productie draait:** geen zware testverwerkingen tijdens productie-imports. Of de testverwerker stoppen of
   lager begrenzen; productie gaat voor.
3. **Monitoring laten staan:** de fijne meting en de 5-minutenmeting. Maandelijks de grenswaarden uit §6.5 nalopen.
4. **Opslagbeleid voor later** (geen haast): oude conceptversies en kwaliteitscontroles opruimen of archiveren, met
   akkoord, zodra de opslag boven de ±50 GB komt.
5. **Tijdelijk buildmateriaal** (±45 GB) bij een onderhoudsmoment vrijmaken, met akkoord.
6. **Aanvullende tests** uit §7 inplannen, vooral 1 en 2, vóór de livegang van productie.
7. **Optioneel:** de swapgrens van de verwerker naar 7 GB, zodat de oorspronkelijke 2 GB swapruimte terugkomt. Dat is
   niet nodig gebleken.

## 9. Conclusie

**De huidige CPX32 (4 vCPU, 8 GB RAM, processorgrens 5 GB) is voldoende voor de pilot met twintig woningen.**

**Onderbouwing:**
- twaalf verwerkingen zonder één fout of herstart;
- een geheugenpiek van 63 % van de verwerkergrens, met ≥ 5,2 GB systeemgeheugen vrij;
- geen swap;
- ±75 minuten machinetijd voor twintig gemiddelde woningen;
- ±9–14 GB opslag bij 93 GB vrij.

**Voorwaarden:**
- één verwerking tegelijk;
- geen zware testverwerkingen tegelijk met productie-imports;
- brochures binnen de grens van Cloudflare (< 100 MB);
- de monitoring en de grenswaarden uit §6.5 blijven bewaakt.

**Opschaling wordt nodig zodra:**
- productie en test structureel tegelijk zwaar verwerken;
- de wachttijd in de rij regelmatig boven ±15 minuten komt;
- de verwerker onder 5 GB gaat swappen, of de grens raakt;
- het beschikbare geheugen tijdens verwerkingen onder 2 GB zakt;
- het platform groeit voorbij ±1 kantoor of ±50 actieve woningen per maand.

In dat geval is een CPX42 (8 vCPU, 16 GB) de logische eerste stap.
