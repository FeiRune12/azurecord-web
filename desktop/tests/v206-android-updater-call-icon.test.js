'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');

test('2.0.6: AzureCall dá tempo extra e confirma conexão por mídia no Android nativo',()=>{
  assert.match(app,/function isNativeAndroidCallDevice/);
  assert.match(app,/if\(isNativeAndroidCallDevice\(\)\)return 25000/);
  assert.match(app,/channel\.onopen=\(\)=>\{markCallConnected\(call\)/);
  assert.match(app,/track\.onunmute=\(\)=>\{markCallConnected\(call\)/);
  assert.match(app,/startCallSignalPolling\(\);setTimeout\(\(\)=>void pollCallSignals\(\),180\)/);
});

test('2.0.6: sinalização de chamada tem retry HTTP',()=>{
  const start=app.indexOf('async function postCallSignalHttp');
  const block=app.slice(start,app.indexOf('function remoteShareToastKey',start));
  assert.match(block,/for\(let attempt=0;attempt<2;attempt\+\+\)/);
  assert.match(block,/retryableCloudMessageError/);
});

test('2.0.6: Android só publica release atualizável quando usa chave permanente',()=>{
  const workflow=fs.readFileSync(path.resolve(root,'..','.github','workflows','android-native-build.yml'),'utf8');
  const gradle=fs.readFileSync(path.resolve(root,'..','android','app','build.gradle.kts'),'utf8');
  assert.match(workflow,/ANDROID_KEYSTORE_BASE64/);
  assert.match(workflow,/AZURECORD_SIGNED_BUILD/);
  assert.match(workflow,/assembleRelease/);
  assert.match(workflow,/UNSIGNED-TEST/);
  assert.match(workflow,/env\.AZURECORD_SIGNED_BUILD == 'true'/);
  assert.match(gradle,/signingConfigs/);
  assert.match(gradle,/AZURECORD_SIGNING_STORE_FILE/);
});

test('2.0.6: updater avisa transição de assinatura em vez de falhar silenciosamente',()=>{
  const updater=fs.readFileSync(path.resolve(root,'..','android','app','src','main','java','com','azurecord','app','AzurecordUpdater.kt'),'utf8');
  const worker=fs.readFileSync(path.resolve(root,'..','android','app','src','main','java','com','azurecord','app','AzurecordUpdateWorker.kt'),'utf8');
  assert.match(updater,/markSigningTransitionNeeded/);
  assert.match(updater,/reinstalação única/);
  assert.match(worker,/markSigningTransitionNeeded/);
  assert.doesNotMatch(worker,/assinatura\/versão instalada/);
});

test('2.0.6: launcher usa o símbolo completo do desktop',()=>{
  const icon=fs.readFileSync(path.resolve(root,'..','android','app','src','main','res','drawable','ic_azurecord_foreground.xml'),'utf8');
  assert.match(icon,/#D5D5D5/);
  assert.ok(icon.length>1800);
});
