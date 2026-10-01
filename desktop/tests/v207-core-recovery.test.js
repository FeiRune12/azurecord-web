'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
const api=fs.readFileSync(path.join(root,'cloud','worker-v0.8.1.js'),'utf8');

test('2.0.7: login e cadastro não dependem do health check',()=>{
  const start=app.indexOf('async function submitAuth()');
  const end=app.indexOf('function authenticateWithCloud',start);
  const block=app.slice(start,end);
  assert.match(block,/endpoint de auth é a fonte de verdade/);
  assert.doesNotMatch(block,/if\(!cloudOnline\)\{showAuthNotice\('O Azurecord Cloud está indisponível/);
  assert.match(block,/\/auth\/register/);
  assert.match(block,/\/auth\/login/);
});

test('2.0.7: sessão Cloud usa bootstrap e Lola recupera conversation_changed',()=>{
  assert.match(app,/async function bootstrapCloudSession/);
  assert.match(app,/\/api\/bootstrap/);
  const askStart=app.indexOf('async function askLolaAi');
  const ask=app.slice(askStart,app.indexOf('function migrateLocalConversationOwner',askStart));
  assert.match(ask,/for\(let attempt=0;attempt<2;attempt\+\+\)/);
  assert.match(ask,/err\.code==='conversation_changed'/);
  assert.match(ask,/err\.data\?\.sessionId/);
});

test('2.0.7: outbox de DM e canal volta a tentar falhas transitórias ao reconectar',()=>{
  const dmStart=app.indexOf('async function flushPendingDms');
  const dm=app.slice(dmStart,app.indexOf('async function sendChannelMessageToBackend',dmStart));
  assert.match(dm,/message\.failed&&message\.retryable===false/);
  assert.match(app,/async function flushPendingChannels/);
  assert.match(app,/async function flushPendingOutbox/);
  assert.match(app,/window\.addEventListener\('online'.*flushPendingOutbox/s);
});

test('2.0.7: Android integra ciclo de chamada nativo',()=>{
  const main=fs.readFileSync(path.resolve(root,'..','android','app','src','main','java','com','azurecord','app','MainActivity.kt'),'utf8');
  const bridge=fs.readFileSync(path.resolve(root,'..','android','app','src','main','java','com','azurecord','app','AzurecordBridge.kt'),'utf8');
  assert.match(app,/setNativeAndroidCallActive\(true\)/);
  assert.match(app,/notifyNativeIncomingCall/);
  assert.match(app,/setNativeAndroidCallActive\(false\)/);
  assert.match(main,/MODE_IN_COMMUNICATION/);
  assert.match(main,/FLAG_KEEP_SCREEN_ON/);
  assert.match(main,/fun notifyIncomingCall/);
  assert.match(bridge,/fun setCallActive/);
  assert.match(bridge,/fun notifyIncomingCall/);
});

test('API 0.8.6: bootstrap, Lola provisionada e sessão recuperável',()=>{
  assert.match(api,/version: "0\.8\.6"/);
  assert.match(api,/bootstrapV1: true/);
  assert.match(api,/lolaAutoProvision: true/);
  assert.match(api,/async function bootstrapSession/);
  assert.match(api,/path === "\/api\/bootstrap"/);
  assert.match(api,/lolaSessionId: lolaConversation\?\.id/);
  assert.match(api,/sessionId: conversation\.id \}, 409/);
  assert.match(api,/String\(env\.LOLA_MODEL \|\| LOLA_MODEL\)/);
});
