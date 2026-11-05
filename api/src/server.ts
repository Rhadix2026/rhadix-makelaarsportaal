// API van de productiestudio. Luistert alleen op 127.0.0.1.
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, ROOT } from './config.ts';
import { databaseStatus, migreer, pool } from './db.ts';
import { generatorStatus } from './generator.ts';

const STUDIO_VERSIE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string;

export function bouwApp() {
  const app = Fastify({ logger: { level: 'warn' } });

  app.get('/api/status', async () => {
    const [database, generator] = await Promise.all([databaseStatus(), generatorStatus()]);
    return {
      studio: { versie: STUDIO_VERSIE, node: process.versions.node, omgeving: 'lokaal', adres: `${config.host}:${config.apiPoort}` },
      database,
      generator,
      tijd: new Date().toISOString(),
    };
  });

  app.addHook('onClose', async () => { await pool.end(); });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migreer();
  const app = bouwApp();
  await app.listen({ host: config.host, port: config.apiPoort });
  console.log(`studio-API op http://${config.host}:${config.apiPoort}`);
}
