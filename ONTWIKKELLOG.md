# Ontwikkellog

Gemeten uitvoering per stap, als basis voor latere inschattingen (stappenplan §11.6).

- **Doorlooptijd:** de wandkloktijd van het akkoord tot de oplevering, inclusief downloads.
- **Wachttijd** op een beoordeling telt niet mee.

## Stap 1: statuspagina (05-11-2026)

| Meting | Waarde |
|---|---|
| Start (akkoord ontvangen) | 2026-11-05 12:34:57 UTC |
| Oplevering | 2026-11-05 ±12:45 UTC |
| Doorlooptijd | ±10 min |
| Iteraties | 1 herstelronde: op mobiel liep de pagina horizontaal over (een lang pad in de tabel) en op desktop stond de knop onder de titel. Gevonden met een schermafdruk, opgelost in de CSS |
| Tests | 5 nieuw (alle groen); typecheck schoon; build in 0,3 s; 81 generatortests groen in de productie-instantie |
| Externe afhankelijkheden | npm-pakketten (12, exacte versies, minstens 2 weken oud); het `postgres:16-alpine`-image (21-10-2026, vastgezet op digest) |
| Lokaal gekopieerd (geen download) | Chromium (572 MB) en de SigLIP-omgeving (venv 501 MB, model 3,3 GB) als APFS-kloon; Oxanium-fonts (OFL) uit de Rhadix-frontend, alleen gelezen |
