import { migreer, pool } from './db.ts';

const nieuw = await migreer();
console.log(nieuw.length ? `toegepast: ${nieuw.join(', ')}` : 'database is bij');
await pool.end();
