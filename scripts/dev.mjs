// Start de API (8480) en de webinterface (5480) samen, allebei op 127.0.0.1. Ctrl+C stopt beide.
import { spawn } from 'node:child_process';

const kinderen = [
  spawn('npm', ['run', 'api'], { stdio: 'inherit' }),
  spawn('npm', ['run', 'web'], { stdio: 'inherit' }),
];
const stop = () => { for (const k of kinderen) k.kill('SIGTERM'); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const k of kinderen) k.on('exit', (code) => { if (code) { stop(); process.exitCode = code; } });
