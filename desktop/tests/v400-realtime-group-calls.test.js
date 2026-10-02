'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'renderer','styles.css'),'utf8');
const api=fs.readFileSync(path.join(root,'cloud','worker-v0.8.9.js'),'utf8');
const realtime=fs.readFileSync(path.resolve(root,'..','realtime','worker.js'),'utf8');

test('4.0.0: chamada privada envia ring antes de abrir mídia e negociar ICE',()=>{
  const start=app.indexOf("async function startDmCall");
  const end=app.indexOf("async function acceptIncomingCall",start);
  const block=app.slice(start,end);
  const ring=block.indexOf("directCallSignal(call.peerId,{kind:'ring'");
  const media=block.indexOf("await acquireCallMedia");
  assert.ok(ring>=0&&media>=0&&ring<media);
  assert.match(block,/startCallSignalPolling\(\)/);
});

test('4.0.0: áudio pede cancelamento de eco e supressão de ruído',()=>{
  assert.match(app,/echoCancellation:\{ideal:true\}/);
  assert.match(app,/noiseSuppression:\{ideal:true\}/);
  assert.match(app,/autoGainControl:\{ideal:true\}/);
  assert.match(app,/channelCount:\{ideal:1\}/);
});

test('4.0.0: live remota no mobile pode focar em tela cheia',()=>{
  assert.match(app,/remoteCallVideo'\)\.onclick/);
  assert.match(app,/openRemoteSharedScreen/);
  assert.match(css,/remote-screen-share \.azure-call-remote/);
  assert.match(css,/object-fit:cover!important/);
  assert.match(css,/remote-share-focused \.azure-call-remote/);
});

test('4.0.0: sinalização aceita resync de tela Android',()=>{
  assert.match(app,/native-screen-resync/);
  assert.match(api,/native-screen-resync/);
  assert.match(realtime,/native-screen-resync/);
});

test('4.0.0: canais de voz de servidor usam malha WebRTC para vários membros',()=>{
  assert.match(app,/let serverVoiceSession = null/);
  assert.match(app,/async function joinServerVoiceChannel/);
  assert.match(app,/async function ensureServerVoicePeer/);
  assert.match(app,/server-voice-join/);
  assert.match(app,/server-voice-offer/);
  assert.match(app,/server-voice-answer/);
  assert.match(app,/server-voice-ice/);
  assert.match(api,/server-voice-join/);
  assert.match(realtime,/server-voice-join/);
});
