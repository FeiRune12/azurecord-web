'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
const html = fs.readFileSync(path.join(root,'renderer','index.html'),'utf8');
const main = fs.readFileSync(path.join(root,'main.js'),'utf8');
const preload = fs.readFileSync(path.join(root,'preload.js'),'utf8');
const worker = fs.readFileSync(path.join(root,'cloud','worker-v0.4.js'),'utf8');

test('login usa um unico campo de senha e confirmacao fica exclusiva do cadastro', () => {
  assert.match(html, /id="passwordInput"/);
  assert.match(html, /id="confirmRow" hidden/);
  assert.match(app, /\$\('confirmInput'\)\.required=signup/);
  assert.match(app, /\$\('confirmInput'\)\.disabled=!signup/);
  assert.match(app, /if\(!signup\)\$\('confirmInput'\)\.value=''/);
});

test('autenticacao aponta para o Azurecord Cloud implantado', () => {
  assert.match(app, /https:\/\/azurecord-api\.giovannisilvaalves604\.workers\.dev/);
  assert.match(app, /cloudRequest\('\/auth\/register'/);
  assert.match(app, /cloudRequest\('\/auth\/login'/);
  assert.match(app, /cloudRequest\('\/auth\/me'/);
});

test('token lembrado usa safeStorage do Electron', () => {
  assert.match(main, /safeStorage/);
  assert.match(main, /desktop:secure-session-set/);
  assert.match(preload, /setSecureSession/);
  assert.doesNotMatch(app, /state\.cloudToken=token/);
});

test('worker 0.4 preserva autenticacao e gestao da conta', () => {
  assert.match(worker, /path === "\/auth\/register"/);
  assert.match(worker, /path === "\/auth\/login"/);
  assert.match(worker, /path === "\/auth\/password"/);
  assert.match(worker, /path === "\/auth\/delete"/);
  assert.match(worker, /version: "0\.4\.0"/);
});
