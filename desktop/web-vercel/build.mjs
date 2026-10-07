import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const clientVersion = '7.1.2';
const sourceDir = resolve(root, '..', '..', 'docs');
const distDir = resolve(root, 'dist');
const apiBaseUrl = String(
  process.env.AZURECORD_API_URL ||
  'https://azurecord-api.giovannisilvaalves604.workers.dev'
).replace(/\/$/, '');
const realtimeBaseUrl = String(
  process.env.AZURECORD_REALTIME_URL ||
  'https://azurecord-realtime.giovannisilvaalves604.workers.dev'
).replace(/\/$/, '');
const webBaseUrl = String(
  process.env.AZURECORD_WEB_URL ||
  'https://feirune12.github.io/azurecord-web/'
).replace(/\/?$/, '/');

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await cp(sourceDir, distDir, { recursive: true });
await writeFile(
  resolve(distDir, 'config.js'),
  `window.AZURECORD_BUILD = ${JSON.stringify({ version: clientVersion })};\nwindow.AZURECORD_CONFIG = ${JSON.stringify({ apiBaseUrl, realtimeBaseUrl, webBaseUrl }, null, 2)};\n`,
  'utf8'
);
console.log('Azurecord Web Vercel sincronizado diretamente de /docs.');
console.log(`API: ${apiBaseUrl}`);
console.log(`Realtime: ${realtimeBaseUrl}`);
