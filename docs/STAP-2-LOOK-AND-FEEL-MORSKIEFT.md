# Stap 2 – Look & feel Morskieft (inlogscherm en dashboard)

**Status (20-11-2026):** de twee schermen staan op test, ter beoordeling. Overige schermen pas na
akkoord. **Niet** in productie.

## Besluiten (opdrachtgever, 20-11-2026)

1. Configureerbaar kantoorthema, voorlopig alleen Morskieft. Inlogscherm met een eigen merkvariant;
   bestaande Rhadix-authenticatie blijft. Andere Rhadix-applicaties en kantoren veranderen niet.
2. Morskieft-kleuren hebben voorrang op de Rhadix-kleuren: `#0B233A`, `#EEEDE3`, `#EEA868`.
3. Typografie: Inter. Sangbleu Sans volgt zodra webfontbestanden en licentie er zijn.
4. Het aangeleverde SVG-logo ongewijzigd (vorm en verhoudingen).

## Wijziging

| Repository | Commit (staging) | Inhoud |
|---|---|---|
| Rhadix-datavalidatie | `f5fe3df` | Merkvariant van het inlogscherm bij `?app=rhadix-makelaarsportaal&merk=morskieft`: logo, kleuren, Inter (lokaal), geen demovak en geen marketingtekst, "Powered by Rhadix". Uitloggen met `&merk=` landt weer daar. Vaste merkenlijst; zonder `merk` alles ongewijzigd. |
| rhadix-makelaarsportaal | `61cd8e9` | Kantoorthema (`api/src/themas.ts`, `web/src/themas/morskieft.css` onder `:root[data-thema="morskieft"]`). De koppeling kantoor → thema staat in `STUDIO_KANTOORTHEMAS` (compose: `MP_KANTOORTHEMAS`), niet in de database. Thema gaat vóór de organisatiekleuren uit Rhadix; platformbeheer houdt de Rhadix-look. Mobiel: logo in de kop, projecten als blokken. |

**Ingang voor de makelaar (test):** https://makelaarsportaal-test.rhadix.nl/?merk=morskieft

## Uitrol test (20-11-2026, ±15:52 lokale tijd)

- Images `61cd8e9` op de server gebouwd. Vlak vóór de uitrol 0 lopende verwerkingen; databasedump
  vooraf (uitrolscript); gezond; database-container niet opnieuw aangemaakt.
- `.env` van makelaarsportaal-test: back-up `.env.voor-stap2-20261120-155212`, toegevoegd
  `MP_KANTOORTHEMAS=rhadix-testmakelaars=morskieft`. Alleen test.
- Vóór de koppeling gecontroleerd: één kantoor `rhadix-testmakelaars` (actief, gekoppeld aan
  Rhadix-organisatie `8f17e82b…`, één kantoorbeheerder).
- Vingerafdruk van `kantoor`, `lidmaatschap`, `gebruiker` (rol, koppeling) en `project` (kantoor,
  status) vóór en na de uitrol: **identiek**. Organisatiegegevens en rechten zijn ongewijzigd.
- Rollback: `deploy/uitrollen.sh portaal@<server> makelaarsportaal-test 2aad652` en `.env` uit de
  back-up terugzetten.

## Controles (publieke testomgeving, desktop 1440 / tablet 820 / mobiel 390)

| Controle | Resultaat |
|---|---|
| Portaalingang `?merk=morskieft` | Morskieft-thema, logo zichtbaar, geen horizontaal scrollen ✓ |
| Klik "Inloggen via Rhadix" | Rhadix-inlog in Morskieft-variant: kop "Inloggen", geen demovak, geen marketingtekst, "Powered by Rhadix" ✓ |
| Inloggen | direct naar Woningprojecten ✓ |
| Dashboard met kantoorthema | Morskieft-kop met logo, neutrale achtergrond, mobiel als blokken, geen horizontaal scrollen ✓ (*) |
| Platformbeheer | blijft Rhadix-look (bewust) ✓ |
| Uitloggen | sessie ingetrokken (portaal 401), terug op de Morskieft-inlog ✓ |
| Algemeen Rhadix-inlogscherm, ingang zonder merk | ongewijzigd ✓ |
| Onbevoegde gebruiker | niet doorgestuurd, portaal 403 ✓ |
| Logo en lettertype | uitgeleverd logo is bit voor bit gelijk aan `headerlogoalter-2.svg`; Inter lokaal (OFL) ✓ |
| Tests | Rhadix-datavalidatie: backend groen, frontend 101 + 28, lint, build, CI groen. Portaal: 116 ✓ |

(*) Het themadashboard is gecontroleerd met een platformbeheer-testsessie waarvan het profiel in de
testbrowser als makelaar van het gekoppelde kantoor is weergegeven. Het echte makelaarsaccount
beoordeelt de opdrachtgever zelf.

Bekend, buiten stap 2: in de Rhadix-look (platformbeheer) is de projectentabel op mobiel nog te
breed. Dat was al zo; in het Morskieft-thema is het opgelost.

## Tijdelijke firewallregel

| | |
|---|---|
| Waar | Hetzner Cloud-firewall van `makelaarsportaal-1` (2.31.128.220), inbound |
| Regel | TCP 22, bron `77.165.193.32/32` |
| Toegevoegd | 20-11-2026 door de opdrachtgever (Hetzner Console), voor de uitrol van stap 2 |
| Verbinding gecontroleerd | 20-11-2026 14:49 UTC |
| Verwijderen | na de beoordeling van stap 2, of uiterlijk bij de afronding ervan: in de Hetzner Console deze ene regel verwijderen; de bestaande regels blijven staan. Daarna is uitrollen naar de portaalserver vanaf dit adres niet meer mogelijk; dat is de bedoeling. |
