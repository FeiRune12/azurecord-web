const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');

test('Beta 8.3.1 força atualização Cloud em amigos e busca remota', () => {
  assert.match(app, /if\(socialCloudReady\(\)\)hydrateFromCloudSocial\(\{quiet:true\}\)/);
  assert.match(app, /if\(!socialCloudReady\(\)\)/);
  assert.match(app, /return cloudRequest\(path,options\)/);
});

test('Beta 8.3.1 remove botão inicial da Lola e servidor de demonstração', () => {
  assert.doesNotMatch(html, /Conversar com Lola/);
  assert.doesNotMatch(app, /const DEMO_SERVER/);
  assert.match(app, /s\.id!=='server-azurecord'/);
});

test('Beta 8.3.1 inclui publicação estática para GitHub Pages', () => {
  assert.ok(fs.existsSync(path.join(root, 'docs', 'index.html')));
  assert.ok(fs.existsSync(path.join(root, 'docs', '.nojekyll')));
});
