'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const updater = fs.readFileSync(path.join(root, 'updater.js'), 'utf8');

test('Beta 8.4 empacota Windows como NSIS EXE com ícone próprio', () => {
  assert.equal(pkg.build.appId, 'com.azurecord.app');
  assert.equal(pkg.build.productName, 'Azurecord');
  assert.equal(pkg.build.win.icon, 'azurecord.ico');
  assert.equal(pkg.build.win.target[0].target, 'nsis');
  assert.match(pkg.build.win.artifactName, /Azurecord-Setup/);
  assert.equal(pkg.build.nsis.shortcutName, 'Azurecord');
  assert.ok(fs.statSync(path.join(root, 'azurecord.ico')).size > 1000);
  assert.match(main, /setAppUserModelId\('com\.azurecord\.app'\)/);
});

test('Beta 8.4 verifica e baixa atualizações automaticamente', () => {
  assert.ok(pkg.dependencies['electron-updater']);
  assert.equal(pkg.build.publish[0].provider, 'github');
  assert.equal(pkg.build.publish[0].owner, 'FeiRune12');
  assert.equal(pkg.build.publish[0].repo, 'azurecord-web');
  assert.match(updater, /autoDownload = true/);
  assert.match(updater, /autoInstallOnAppQuit = true/);
  assert.match(updater, /15 \* 60 \* 1000/);
});
