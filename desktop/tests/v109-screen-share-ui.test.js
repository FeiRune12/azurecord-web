'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('1.0.9: compartilhamento remoto aparece no Web com áudio separado',()=>{
  const html=fs.readFileSync(path.join(root,'renderer','index.html'),'utf8');
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  assert.match(html,/id="remoteCallAudio"/);
  assert.match(html,/id="callRemoteShareTag"/);
  assert.match(html,/id="callRemoteShareName"/);
  assert.match(app,/remote\.muted=true/);
  assert.match(app,/remoteAudio\.srcObject/);
  assert.match(app,/remoteScreenTrack/);
  assert.match(app,/remoteCameraTrack/);
  assert.match(app,/displayStream=remoteSharing/);
});

test('2.0.2: AzureCall mantém DataChannel rápido e API como trilho confiável',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  assert.match(app,/createDataChannel\('azurecall-control'/);
  assert.match(app,/pc\.ondatachannel/);
  assert.match(app,/type:'screen-share'/);
  assert.match(app,/remoteScreenSharing/);
  assert.match(app,/publishLocalScreenState/);
  assert.match(app,/postScreenShareApiSignal/);
  assert.match(app,/syncScreenShareApiState/);
});

test('1.0.9: layout de compartilhamento é maior e mostra o nome',()=>{
  const css=fs.readFileSync(path.join(root,'renderer','styles.css'),'utf8');
  assert.match(css,/\.azure-call-shell\.screen-share-mode/);
  assert.match(css,/1500px/);
  assert.match(css,/\.call-share-tag/);
  assert.match(css,/\.local-screen-share \.azure-call-local\.screen-main/);
});

test('2.0: renderização e seletor desktop/mobile foram otimizados',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const main=fs.readFileSync(path.join(root,'main.js'),'utf8');
  assert.match(app,/requestAnimationFrame/);
  assert.match(app,/const delay=activeCall\?\(cloudRealtimeConnected\(\)\?1200:500\):3000/);
  assert.match(app,/maxBitrate:mobile\?1400000:2200000/);
  assert.match(app,/maxFramerate:mobile\?20:24/);
  assert.match(main,/AZURECORD_DISABLE_GPU/);
  assert.match(main,/width: 224, height: 126/);
  assert.match(main,/sources\.slice\(0, 30\)/);
});
