'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');

test('Beta7.1: lista vazia remove o HTML da última conta salva', () => {
  assert.match(app, /if\(!accounts\.length\)\{[\s\S]*?el\.replaceChildren\(\);[\s\S]*?el\.onclick=null;[\s\S]*?el\.hidden=true;/);
});

test('Beta7.1: CSS força o menu de contas salvas a sumir quando hidden', () => {
  assert.match(css, /\.saved-session\[hidden\]\{display:none!important\}/);
});

test('Beta7.1: exclusão limpa os campos de login e renderiza imediatamente o menu', () => {
  assert.match(app, /emailInput[\s\S]*?value=''[\s\S]*?passwordInput[\s\S]*?value=''[\s\S]*?saveNow\(\);[\s\S]*?renderSavedAccounts\(\);/);
});

test('Azurecord estável: rótulo visual não anuncia builds beta antigas', () => {
  assert.match(html, /APP • AZURECORD 1\.0/);
  assert.doesNotMatch(html, /APP • V52 BETA/);
});
