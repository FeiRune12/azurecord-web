const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
const css = fs.readFileSync(path.join(root,'renderer','styles.css'),'utf8');
const worker = fs.readFileSync(path.join(root,'cloud','worker-v0.8.1.js'),'utf8');

test('social features use the Cloud session as source of truth', () => {
  assert.match(app, /function socialReady\(\)\{ return socialCloudReady\(\); \}/);
  assert.match(app, /Entre novamente na sua conta Cloud antes de enviar pedidos/);
  assert.doesNotMatch(app, /function socialReady\(\)\{ return socialCloudReady\(\) \|\|/);
});

test('mobile layout has bottom navigation and drawer', () => {
  assert.match(app, /mobile-bottom-nav/);
  assert.match(app, /data-mobile-servers/);
  assert.match(css, /@media\(max-width:720px\)/);
  assert.match(css, /mobile-drawer-backdrop/);
});

test('worker includes tolerant user search and reliable message inserts', () => {
  assert.match(worker, /friendSearchV2: true/);
  assert.match(worker, /reliableMessaging: true/);
  assert.match(worker, /publicSearchKey/);
  assert.match(worker, /insertCompatible\(env, "messages"/);
  assert.match(worker, /insertCompatible\(env, "channel_messages"/);
});
