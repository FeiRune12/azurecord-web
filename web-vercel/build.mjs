import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const publicDir = resolve(root, 'public');
const distDir = resolve(root, 'dist');
const apiBaseUrl = String(
  process.env.AZURECORD_API_URL ||
  'https://azurecord-api.giovannisilvaalves604.workers.dev'
).replace(/\/$/, '');

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await cp(publicDir, distDir, { recursive: true });
await writeFile(
  resolve(distDir, 'config.js'),
  `window.AZURECORD_CONFIG = ${JSON.stringify({ apiBaseUrl }, null, 2)};\n`,
  'utf8'
);
console.log(`Azurecord Web pronto em dist/ usando API ${apiBaseUrl}`);
