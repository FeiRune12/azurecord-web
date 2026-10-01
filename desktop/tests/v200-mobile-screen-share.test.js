'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('2.0.1: compartilhamento mobile usa captura nativa quando disponível',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'renderer','styles.css'),'utf8');
  assert.match(app,/function isMobileCallDevice/);
  assert.match(app,/function screenCaptureGetter/);
  assert.match(app,/navigator\.mediaDevices\?\.getDisplayMedia/);
  assert.match(app,/navigator\.getDisplayMedia/);
  assert.match(app,/capture\(\{video:true,audio:false\}\)/);
  assert.match(app,/initialScreenCapture=requestAzureDisplayMedia\(\)/);
  assert.match(app,/track\.applyConstraints/);
  assert.match(css,/#screenBtn:not\(\[hidden\]\)/);
  assert.match(css,/#callShareBtn\{display:grid!important\}/);
});

test('2.0.1: câmera e tela usam slots WebRTC separados desde a oferta inicial',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  assert.match(app,/ensureOffererVideoSlots/);
  assert.match(app,/while\(slots\.length<2\)/);
  assert.match(app,/cameraTransceiver/);
  assert.match(app,/screenTransceiver/);
  assert.match(app,/prepareCallVideoSender\(call,track,'screen'\)/);
  assert.match(app,/prepareCallVideoSender\(call,null,'screen'\)/);
  assert.match(app,/prepareCallVideoSender\(call,track,'camera'\)/);
  assert.match(app,/bindAnswererVideoSlots/);
});

test('2.0.1: quem atendeu pode compartilhar sem renegociação obrigatória',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const start=app.slice(app.indexOf('async function toggleCallScreen'),app.indexOf('function endActiveCall',app.indexOf('async function toggleCallScreen')));
  assert.match(start,/prepareCallVideoSender\(call,track,'screen'\)/);
  assert.match(start,/if\(prepared\.needsRenegotiation\)await renegotiateCall/);
  assert.doesNotMatch(start,/await renegotiateCall\(\{reason:'screen-share-start'\}\)/);
});

test('2.0.1: recebimento separa câmera e live para evitar vídeo arbitrário',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  assert.match(app,/remoteCameraStream=new MediaStream/);
  assert.match(app,/remoteScreenStream=new MediaStream/);
  assert.match(app,/slotIndex===1/);
  assert.match(app,/call\.remoteScreenTrack=track/);
  assert.match(app,/displayStream=remoteSharing/);
});

test('2.0.1: aviso remoto continua clicável e abre a live',()=>{
  const html=fs.readFileSync(path.join(root,'renderer','index.html'),'utf8');
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'renderer','styles.css'),'utf8');
  assert.match(html,/<button id="callRemoteShareTag"/);
  assert.match(app,/\$\('callRemoteShareTag'\)\.onclick=openRemoteSharedScreen/);
  assert.match(app,/requestFullscreen/);
  assert.match(css,/\.remote-share-focused \.azure-call-remote/);
});

test('2.0.1: versão segue rollover .9 para próxima geração',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(pkg.version,'2.0.1');
  const parts=String(pkg.version).split('.').map(Number);
  assert.equal(parts[1],0);
  assert.ok(parts[2]>=0&&parts[2]<=9);
});
