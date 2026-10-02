'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('2.0.4: compartilhamento usa websocket e fallback HTTP',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const realtime=fs.readFileSync(path.join(root,'..','realtime','worker.js'),'utf8');
  assert.match(app,/postScreenShareApiSignal/);
  assert.match(app,/sendCloudRealtime\(\{type:'call\.signal'/);
  assert.match(realtime,/screen-offer/);
  assert.match(realtime,/screen-answer/);
});

test('3.0.8: tela compartilhada usa indicador discreto sem toast persistente',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'renderer','styles.css'),'utf8');
  assert.doesNotMatch(app,/remoteShareToastKey/);
  assert.match(app,/function showRemoteShareNotice\(call\)\{\}/);
  assert.match(app,/function clearRemoteShareNotice\(call\)\{\}/);
  assert.match(app,/track\.onmute=\(\)=>\{updateCallUi\(\);\}/);
  assert.match(css,/\/\* Azurecord 3\.0\.8: screen share label only \*\//);
});

test('2.0.4: AzureCall usa perfil de tela de baixa latência',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  assert.match(app,/maintain-framerate/);
  assert.match(app,/1400000:2200000/);
  assert.match(app,/cloudRealtimeConnected\(\)\?350:250/);
});

test('2.0.4: protocolo aceita ponte de tela nativa Android',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const api=fs.readFileSync(path.join(root,'cloud','worker-v0.8.1.js'),'utf8');
  const realtime=fs.readFileSync(path.join(root,'..','realtime','worker.js'),'utf8');
  assert.match(app,/AzurecordNative/);
  assert.match(app,/native-screen-offer/);
  assert.match(app,/native-screen-answer/);
  assert.match(api,/native-screen-ice/);
  assert.match(realtime,/native-screen-stop/);
});


test('3.0.9: desktop pede ressincronização quando a live nativa Android fica sem trilha',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const engine=fs.readFileSync(path.resolve(root,'..','android','app','src','main','java','com','azurecord','app','AzureCallScreenEngine.kt'),'utf8');
  assert.match(app,/native-screen-resync/);
  assert.match(app,/nativeScreenResyncAttempts/);
  assert.match(app,/nativeScreenLastResyncAt/);
  assert.match(engine,/"native-screen-resync"/);
  assert.match(engine,/localIceCandidates/);
  assert.match(engine,/repeat\(2\)/);
});
