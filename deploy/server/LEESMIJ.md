# Makelaarsportaal-server: inrichten, uitrollen, back-up en meting

Draaiboek voor de eigen server van Rhadix Makelaarsportaal, Ubuntu 24.04 LTS. In gebruik (6-11-2026):
een Hetzner **CPX32** (x86, 4 vCPU, 8 GB, 160 GB) voor de demo en de pilot (één kantoor, ±20
woningen). De scripts werken ook op arm64 (CAX).

- **Op 8 GB draait één omgeving: test** (`makelaarsportaal-test.rhadix.nl`). De grenzen staan in de
  `.env` (zie `deploy/env.voorbeeld`). Back-up, hersteltest en meting wijzen via de drop-in
  `systemd-alleen-test/omgeving.conf` naar test.
- **Opschalen** binnen de CPX-familie (bijvoorbeeld CPX42: 8 vCPU, 16 GB): in de Hetzner-console
  "Rescale", met de schijf ongewijzigd, zodat terugschalen mogelijk blijft. Daarna de grenzen in de `.env`
  verhogen en `up -d`.

- De server staat los van de Rhadix-server; daar verandert niets aan.
- Geheimen staan nooit in git. Ze worden op de server aangemaakt of daar ingevuld.

## Overzicht

```
Cloudflare (proxy, TLS, Access voor test) ──443──▶ host-nginx (origincertificaat)
   ├─ makelaarsportaal.rhadix.nl       ──▶ 127.0.0.1:8580 ─▶ web ─▶ api ─┐
   └─ makelaarsportaal-test.rhadix.nl  ──▶ 127.0.0.1:8581 ─▶ web ─▶ api ─┤ intern netwerk
                                                       verwerker ◀─ wachtrij ─▶ db (postgres 16)
/srv/makelaarsportaal[-test]/{.env, compose.yml, db/, opslag/, voor-uitrol/}
/srv/makelaarsportaal-modellen/hf        SigLIP-model (alleen-lezen gekoppeld)
/srv/back-up                              werkmap back-up en hersteltest (root)
/var/log/makelaarsportaal                 back-up.log, hersteltest.log, systeem.csv, containers.csv
```

**Containers per omgeving**

| Container | Grens CPX32 (standaard 16 GB) | CPU | Netwerk | Rol |
|---|---|---|---|---|
| `db` | 768 MB (1 GB) | 2 | intern | Postgres 16 |
| `api` | 1 GB (1,5 GB) | 2 | intern + web | Fastify |
| `verwerker` | 4 GB + 2 GB swap (6 GB) | 4 (6) | **alleen intern, geen internet** | import, classificatie, generatie |
| `web` | 128 MB | 1 | web | nginx met de statische interface |

De verwerker doet **één verwerking tegelijk**: de wachtrij pakt alleen iets op als er niets 'bezig'
is. Een brochure-import (met de beeldclassificatie) en een conceptgeneratie lopen dus nooit
gelijktijdig.

## 1. Vooraf (eenmalig; buiten de server)

1. **Hetzner** (na akkoord):
   - CAX31 in Falkenstein (FSN1), Ubuntu 24.04, uw SSH-sleutel, back-ups uit (we gebruiken restic).
   - **Cloud Firewall:** 22 alleen vanaf uw IP; 443 alleen vanaf de Cloudflare-reeksen
     (`https://www.cloudflare.com/ips/`); verder niets.
2. **Cloudflare** (zone `rhadix.nl`, na akkoord):
   - **Origincertificaat:** SSL/TLS, Origin Server, Create Certificate voor
     `makelaarsportaal.rhadix.nl` en `makelaarsportaal-test.rhadix.nl`. Een eigen certificaat
     voor deze server, níet dat van de Rhadix-server hergebruiken.
   - **DNS:** A-record `makelaarsportaal-test` naar het nieuwe IP, via de proxy (oranje wolk).
     `makelaarsportaal` pas bij de livegang.
   - **Zero Trust, Access:** een applicatie voor `makelaarsportaal-test.rhadix.nl` met een
     e-mailallowlist (uw adres). Productie eventueel ook, tijdens de pilot.
   - **WAF:** een rate-limitregel voor `/api/inloggen`.
3. **Back-updoel:** Hetzner Object Storage, een bucket `makelaarsportaal-back-up` (EU-locatie)
   met een eigen S3-sleutelpaar. Of een ander extern S3-doel.

## 2. Server inrichten

```bash
scp -r deploy/server root@<ip>:/root/mp-server
ssh root@<ip> 'bash /root/mp-server/inrichten.sh'
```

Daarna op de server, als root:

1. **Certificaat, Cloudflare-adressen, nginx:** `ssh -t root@<ip> 'bash /root/mp-server/origincertificaat-plaatsen.sh'`.
   De sleutel wordt verborgen geplakt; het script controleert of certificaat en sleutel bij elkaar horen.
4. **`.env` per omgeving:** `/srv/makelaarsportaal/.env` (en `-test`), naar `deploy/env.voorbeeld`.
   - Een eigen databasewachtwoord per omgeving, bijvoorbeeld `openssl rand -base64 32 | tr -d '/+='`.
   - chmod 600, eigenaar `portaal`.
5. **restic:** `ssh -t root@<ip> 'bash /root/mp-server/restic-instellen.sh'`. Het script vraagt de bucketnaam, de
   S3-sleutels en een zelfgekozen restic-wachtwoord, allemaal verborgen. Daarna voert het `restic init` uit. Wat het
   in `/root/.config/makelaarsportaal/` zet (chmod 700):
   - `restic.env` met `RESTIC_REPOSITORY=s3:https://<endpoint>/<bucket>/makelaarsportaal`,
     `RESTIC_PASSWORD_FILE=/root/.config/makelaarsportaal/restic-wachtwoord`, `AWS_ACCESS_KEY_ID`
     en `AWS_SECRET_ACCESS_KEY`;
   - `restic-wachtwoord` aanmaken met `openssl rand -base64 32`. **Bewaar dit ook in uw
     wachtwoordmanager: zonder dit wachtwoord is de back-up niet terug te zetten.**
   - Daarna eenmalig: `set -a; . restic.env; restic init`

## 3. Model en eerste uitrol (vanaf de Mac)

```bash
# SigLIP-model (vaste revisie 9fdffc5, 3,3 GB) één keer naar de server
rsync -a --info=progress2 ~/Developer/makelaarsplatform-productie/.cache/ai/hf/ portaal@<ip>:/srv/makelaarsportaal-modellen/hf/
# images op de server zelf bouwen (eigen architectuur) en uitrollen naar test
BOUW_SERVER=portaal@<ip> deploy/bouw-images.sh
deploy/uitrollen.sh portaal@<ip> makelaarsportaal-test
```

**Eerste beheerder** (eigen e-mailadres; het wachtwoord wordt verborgen gevraagd en nergens getoond):

```bash
ssh -t portaal@<ip> 'cd /srv/makelaarsportaal-test && docker compose -p makelaarsportaal-test --env-file .env -f compose.yml \
  exec api node_modules/.bin/tsx api/src/beheer.ts maak --email <adres> --naam "<naam>" --platformbeheer'
```

## 4. Back-up, hersteltest en meting aanzetten

```bash
systemctl enable --now makelaarsportaal-meting.timer makelaarsportaal-back-up.timer makelaarsportaal-hersteltest.timer
# Meteen één keer handmatig, om te controleren:
/usr/local/sbin/back-up.sh && /usr/local/sbin/hersteltest.sh
```

- **Back-up:** elke nacht om 02:30. Bevat de database (pg_dump), de opslag, de `.env` (versleuteld)
  en tellingen met checksums. Bewaard: 7 dagelijks, 4 wekelijks, 6 maandelijks.
- **Hersteltest:** elke zondag. Zet de laatste back-up terug in een tijdelijke map en een tijdelijke
  database zonder netwerk, en vergelijkt de checksums en de tellingen per tabel. Daarna opgeruimd.
- **Status:** `/var/log/makelaarsportaal/*.laatst-geslaagd` en de logbestanden.
- **Meting:** elke 5 minuten naar `systeem.csv` en `containers.csv`.
  - Tijdens een import fijner meten: `MP_MEETINTERVAL=2 /usr/local/sbin/meting.sh 300`
  - **Nulmeting (fase 4):** 24 uur de timer laten lopen zonder woningen. Daarna `systeem.csv` en
    `containers.csv` bewaren als referentie, met `docker system df -v` en `du -sm /srv/*`.

## 5. Uitrollen van een nieuwe versie

```bash
deploy/bouw-images.sh && deploy/uitrollen.sh portaal@<ip> makelaarsportaal-test
# na controle op test:
deploy/uitrollen.sh portaal@<ip> makelaarsportaal
```

Elke uitrol maakt eerst een databasedump (`/srv/<omgeving>/voor-uitrol/`, de laatste 10). Is de
gezondheidscontrole na 90 s niet groen, dan gaat de vorige tag automatisch terug.

## 6. Bekende grenzen

- Cloudflare (Free en Pro) laat per verzoek maximaal 100 MB door. Een brochure-PDF van meer dan
  100 MB komt er niet doorheen (de app staat 150 MB toe).
- De beeldclassificatie gebruikt de CPU: gemeten in een arm64-container ±3 s per foto bij 6 kernen
  (Markt 27, 34 foto's: 106 s). Op de CPX32 meten in fase 5.
- Op 8 GB is er geen ruimte voor productie en test tegelijk. Productie komt er pas na opschaling,
  of test gaat dan uit.

## 7. Inloggen: centrale Rhadix-login en noodtoegang

- **Gebruikers loggen in via Rhadix** (Datavalidatie). De test vertrouwt **staging**
  (`app-staging.rhadix.nl`, cookie `rhadix_sso_staging`), productie vertrouwt `app.rhadix.nl`
  (`rhadix_sso`). In de `.env` staat alleen de **publieke** sleutel (`MP_SSO_SLEUTEL`), uit
  `<platform>/api/auth/jwks`.
- **Toegang:** de applicatie `rhadix-makelaarsportaal` in Rhadix, toegewezen aan de organisatie en de
  gebruiker. Rollen:

  | Rhadix | Portaal |
  |---|---|
  | `RHADIX_ADMIN` | platformbeheer |
  | `ORG_ADMIN` | kantoorbeheerder |
  | `ORG_USER` | makelaar |

- **Koppeling:** een kantoor hoort bij één Rhadix-organisatie, op organisatie-ID. Platformbeheer
  koppelt die via Kantoren, het kantoor, Rhadix-organisatie.
- **Noodtoegang** (als Rhadix niet bereikbaar is): de eigen wachtwoordlogin werkt alleen via een
  SSH-tunnel, nooit via Cloudflare.
  ```bash
  ssh -L 8581:127.0.0.1:8581 portaal@<ip>     # daarna in de browser: http://127.0.0.1:8581
  ```
  Een noodaccount maken (het wachtwoord wordt verborgen gevraagd):
  `… exec api node_modules/.bin/tsx api/src/beheer.ts maak --email <adres> --naam "<naam>" --platformbeheer`
