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

test('2.0.4: aviso de tela compartilhada permanece enquanto a transmissão está ativa',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  assert.match(app,/persistent:true/);
  assert.match(app,/remoteShareToastKey/);
  assert.match(app,/clearRemoteShareNotice/);
  assert.match(app,/track\.onmute=\(\)=>\{updateCallUi\(\);\}/);
});

test('2.0.4: AzureCall usa perfil de tela de baixa latência',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  assert.match(app,/maintain-framerate/);
  assert.match(app,/1400000:2200000/);
  assert.match(app,/cloudRealtimeConnected\(\)\?1200:500/);
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
