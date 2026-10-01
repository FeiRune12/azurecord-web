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

test('3.0.8: transmissão não usa toast persistente nem aviso clicável',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'renderer','index.html'),'utf8');
  assert.match(app,/function showRemoteShareNotice\(call\)\{\}/);
  assert.match(app,/function clearRemoteShareNotice\(call\)\{\}/);
  assert.doesNotMatch(app,/onClick:\(\)=>openRemoteSharedScreen\(\)/);
  assert.doesNotMatch(app,/remoteShareToastKey/);
  assert.match(html,/<div id="callRemoteShareTag" class="call-share-tag remote"/);
});

test('2.0.2: quem não iniciou a chamada também força nova oferta de tela',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const share=app.slice(app.indexOf('async function toggleCallScreen'),app.indexOf('function endActiveCall',app.indexOf('async function toggleCallScreen')));
  assert.match(share,/prepareCallVideoSender\(call,track,'screen'\)/);
  assert.match(share,/renegotiateScreenShareViaApi\(call\)/);
  assert.doesNotMatch(share,/prepared\.needsRenegotiation/);
});

test('2.0.2+: versão do cliente permanece sincronizada nos artefatos',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const versionFile=fs.readFileSync(path.join(root,'VERSION.txt'),'utf8');
  const html=fs.readFileSync(path.join(root,'renderer','index.html'),'utf8');
  assert.match(pkg.version,/^\d+\.\d+\.\d+$/);
  assert.ok(versionFile.includes(pkg.version));
  assert.ok(html.includes(`styles.css?v=${pkg.version}`));
});
