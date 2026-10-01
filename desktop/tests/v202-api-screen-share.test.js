'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('2.0.2: screen share usa API para estado e renegociação',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const api=fs.readFileSync(path.join(root,'cloud','worker-v0.8.1.js'),'utf8');
  assert.match(app,/postScreenShareApiSignal/);
  assert.match(app,/syncScreenShareApiState/);
  assert.match(app,/renegotiateScreenShareViaApi/);
  assert.match(app,/screen-share-start/);
  assert.match(app,/screen-share-stop/);
  assert.match(app,/screen-offer/);
  assert.match(app,/screen-answer/);
  assert.match(api,/CREATE TABLE IF NOT EXISTS call_share_state/);
  assert.match(api,/readCallShareState/);
  assert.match(api,/updateCallShareState/);
  assert.match(api,/azureCallShareState: true/);
});

test('2.0.2: aviso de transmissão é clicável',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'renderer','styles.css'),'utf8');
  assert.match(app,/showToast\(text,options=\{\}\)/);
  assert.match(app,/showRemoteShareNotice/);
  assert.match(app,/onClick:\(\)=>openRemoteSharedScreen\(\)/);
  assert.match(css,/\.toast\.clickable/);
});

test('2.0.2: quem não iniciou a chamada também força nova oferta de tela',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const share=app.slice(app.indexOf('async function toggleCallScreen'),app.indexOf('function endActiveCall',app.indexOf('async function toggleCallScreen')));
  assert.match(share,/prepareCallVideoSender\(call,track,'screen'\)/);
  assert.match(share,/renegotiateScreenShareViaApi\(call\)/);
  assert.doesNotMatch(share,/prepared\.needsRenegotiation/);
});

test('2.0.2: versão do cliente está correta',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(pkg.version,'2.0.2');
});
