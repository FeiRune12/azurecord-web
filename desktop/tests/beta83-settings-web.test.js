const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('Beta 8.3 inclui workspaces de configurações do app e servidor', () => {
  const app = read('renderer/app.js');
  const css = read('renderer/styles.css');
  assert.match(app, /APP_SETTINGS_NAV/);
  assert.match(app, /SERVER_SETTINGS_NAV/);
  assert.match(app, /openAppSettings/);
  assert.match(app, /openServerSettings/);
  assert.match(app, /\/api\/settings/);
  assert.match(app, /\/invites/);
  assert.match(css, /\.settings-modal/);
  assert.match(css, /@media\(max-width:620px\)/);
});

test('Worker 0.8 expõe settings cloud e server settings', () => {
  const worker = read('cloud/worker-v0.8.js');
  assert.match(worker, /version:\s*"0\.8\.0"/);
  assert.match(worker, /settingsCloud:\s*true/);
  assert.match(worker, /serverSettingsCloud:\s*true/);
  assert.match(worker, /path === "\/api\/settings"/);
  assert.match(worker, /parts\[3\] === "invites"/);
  assert.match(worker, /request\.method === "GET" && path === "\/auth\/sessions"/);
});

test('Cliente web do Vercel é autocontido e usa config de API', () => {
  const webPackage = JSON.parse(read('web-vercel/package.json'));
  const build = read('web-vercel/build.mjs');
  const shim = read('renderer/web-shim.js');
  const app = read('renderer/app.js');
  assert.equal(webPackage.scripts.build, 'node build.mjs');
  assert.match(build, /AZURECORD_API_URL/);
  assert.match(shim, /azurecord_web_cloud_session_v1/);
  assert.match(app, /window\.AZURECORD_CONFIG\?\.apiBaseUrl/);
});
