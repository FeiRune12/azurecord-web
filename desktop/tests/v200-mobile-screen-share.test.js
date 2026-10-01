'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('2.0: compartilhamento mobile usa captura nativa quando disponível',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'renderer','styles.css'),'utf8');
  assert.match(app,/function isMobileCallDevice/);
  assert.match(app,/function screenCaptureGetter/);
  assert.match(app,/navigator\.mediaDevices\?\.getDisplayMedia/);
  assert.match(app,/navigator\.getDisplayMedia/);
  assert.match(app,/capture\(\{video:true,audio:false\}\)/);
  assert.match(app,/track\.applyConstraints/);
  assert.match(css,/#screenBtn:not\(\[hidden\]\)/);
});

test('2.0: aviso de compartilhamento remoto é clicável e abre a tela',()=>{
  const html=fs.readFileSync(path.join(root,'renderer','index.html'),'utf8');
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'renderer','styles.css'),'utf8');
  assert.match(html,/<button id="callRemoteShareTag"/);
  assert.match(html,/id="callShareFocusExit"/);
  assert.match(html,/id="callStage"/);
  assert.match(app,/openRemoteSharedScreen/);
  assert.match(app,/requestFullscreen/);
  assert.match(app,/closeRemoteSharedScreen/);
  assert.match(app,/remoteShareFocused/);
  assert.match(css,/\.remote-share-focused \.azure-call-remote/);
  assert.match(css,/\.call-share-focus-exit/);
});

test('2.0: versão segue rollover .9 para próxima geração',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const parts=String(pkg.version).split('.').map(Number);
  assert.equal(parts.length,3);
  assert.equal(parts[1],0,'A linha estável usa major.0.patch');
  assert.ok(parts[2]>=0&&parts[2]<=9,'Após patch .9, incremente o major e volte para .0.0');
  assert.equal(pkg.version,'2.0.0');
});


test('2.0: answerer pode iniciar transmissão e renegocia vídeo para sendrecv',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  assert.match(app,/function getCallVideoTransceiver/);
  assert.match(app,/prepareCallVideoSender/);
  assert.match(app,/transceiver\.direction='sendrecv'/);
  assert.match(app,/transceiver\.currentDirection/);
  assert.match(app,/renegotiateCall\(\{reason:'screen-share-start'\}\)/);
  assert.match(app,/renegotiateCall\(\{reason:'screen-share-stop'\}\)/);
  assert.match(app,/call\.direction==='incoming'/);
  assert.match(app,/setLocalDescription\(\{type:'rollback'\}\)/);
});

test('2.0: renegociação de mídia espera signalingState estável e enfileira colisões',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  assert.match(app,/call\.pc\.signalingState!=='stable'/);
  assert.match(app,/call\.renegotiating/);
  assert.match(app,/call\.renegotiatePending/);
  assert.match(app,/queued-media-change/);
});
