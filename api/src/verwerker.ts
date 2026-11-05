// Verwerker als eigen proces (online: een aparte container met eigen geheugen- en CPU-grenzen).
// Verwerkt de bestaande wachtrij (brochure-import, foto-indeling, kwaliteitscontrole,
// conceptgeneratie) met dezelfde functies als de lokale studio; één verwerking tegelijk.
// De API zet verwerkingen alleen klaar (STUDIO_ROL=api); deze verwerker kijkt elke paar seconden.
import { migreer, pool } from './db.ts';
import { herstelVerwerkingen, wekVerwerker } from './aanlevering.ts';
import { config } from './config.ts';

const INTERVAL_MS = 3000;
let stoppen = false;

if (config.rol !== 'verwerker') throw new Error('start de verwerker met STUDIO_ROL=verwerker');
await migreer();
// Een verwerking die 'bezig' bleef staan (verwerker gestopt) is mislukt; de gebruiker kan opnieuw starten.
await herstelVerwerkingen();
console.log('verwerker gestart');

// Netjes stoppen: geen nieuwe verwerking meer oppakken, de lopende afmaken (stop_grace_period in compose).
for (const s of ['SIGTERM', 'SIGINT'] as const) process.on(s, () => { stoppen = true; console.log(`verwerker: ${s}, stopt na de lopende verwerking`); });

while (!stoppen) {
  try { await wekVerwerker(); } catch (e) { console.error('verwerker:', (e as Error).message); }
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}
await pool.end();
console.log('verwerker gestopt');
