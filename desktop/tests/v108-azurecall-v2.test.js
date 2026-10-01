'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('1.0.8: AzureCall confirma aceite, acompanha ICE e tenta restart',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  assert.match(app,/kind:'accepted'/);
  assert.match(app,/kind==='accepted'/);
  assert.match(app,/oniceconnectionstatechange/);
  assert.match(app,/restartCallIce/);
  assert.match(app,/createOffer\(\{iceRestart:true\}\)/);
  assert.match(app,/kind==='ice-restart'/);
  assert.match(app,/signalId:uid\('sig'\)/);
  assert.match(app,/seenSignals/);
});

test('1.0.8: Desktop permite escolher tela inteira ou janela',()=>{
  const main=fs.readFileSync(path.join(root,'main.js'),'utf8');
  const preload=fs.readFileSync(path.join(root,'preload.js'),'utf8');
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'renderer','styles.css'),'utf8');
  assert.match(main,/desktopCapturer\.getSources/);
  assert.match(main,/desktop:display-sources/);
  assert.match(main,/desktop:display-source-select/);
  assert.match(preload,/getDisplaySources/);
  assert.match(preload,/selectDisplaySource/);
  assert.match(app,/chooseDesktopDisplaySource/);
  assert.match(app,/Tela inteira/);
  assert.match(app,/Aplicativo/);
  assert.match(css,/screen-source-picker-layer/);
  assert.match(css,/screen-source-card/);
});

test('1.0.8: sinalização aceita accepted, ice-restart e signalId',()=>{
  const api=fs.readFileSync(path.join(root,'cloud','worker-v0.8.1.js'),'utf8');
  const worker=fs.readFileSync(path.resolve(root,'..','realtime','worker.js'),'utf8');
  assert.match(api,/ice-restart","accepted/);
  assert.match(api,/signalId/);
  assert.match(api,/version: "0\.8\.5"/);
  assert.match(worker,/ice-restart","accepted/);
  assert.match(worker,/signalId/);
  assert.match(worker,/version:\s*"\d+\.\d+\.\d+"/);
});
