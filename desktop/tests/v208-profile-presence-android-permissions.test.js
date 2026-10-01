'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'renderer','styles.css'),'utf8');
const api=fs.readFileSync(path.join(root,'cloud','worker-v0.8.1.js'),'utf8');
const realtime=fs.readFileSync(path.resolve(root,'..','realtime','worker.js'),'utf8');
const main=fs.readFileSync(path.resolve(root,'..','android','app','src','main','java','com','azurecord','app','MainActivity.kt'),'utf8');
const bridge=fs.readFileSync(path.resolve(root,'..','android','app','src','main','java','com','azurecord','app','AzurecordBridge.kt'),'utf8');
const gradle=fs.readFileSync(path.resolve(root,'..','android','app','build.gradle.kts'),'utf8');

test('2.0.8: Android pede permissões nativas antes do getUserMedia',()=>{
  assert.match(app,/async function ensureNativeCallPermissions/);
  assert.match(app,/requestCallPermissions/);
  assert.match(app,/callPermissions\.result/);
  assert.match(app,/await ensureNativeCallPermissions\(wantsCamera\)/);
  assert.match(main,/REQ_CALL_PERMISSIONS = 904/);
  assert.match(main,/fun requestCallPermissions\(includeCamera: Boolean\)/);
  assert.match(main,/callPermissions\.result/);
  assert.match(bridge,/fun requestCallPermissions\(includeCamera: Boolean\)/);
});

test('2.0.8: status customizado e horários são persistidos e propagados',()=>{
  assert.match(app,/function customStatusOf/);
  assert.match(app,/function presenceMeta/);
  assert.match(app,/async function setOwnPresence/);
  assert.match(app,/\/api\/presence/);
  assert.match(app,/customStatus\}\):false/);
  assert.match(api,/version: "0\.8\.7"/);
  assert.match(api,/customStatusV1: true/);
  assert.match(api,/presenceTimestampsV1: true/);
  assert.match(api,/path === "\/api\/presence" && method === "PATCH"/);
  assert.match(api,/customStatus: details\.customStatus/);
  assert.match(api,/lastSeenAt: details\.lastSeenAt/);
  assert.match(realtime,/version: "1\.7\.0"/);
  assert.match(realtime,/customStatus/);
});

test('2.0.8: perfil tem balão de status, cropper e settings travadas como tela',()=>{
  assert.match(app,/profile-status-bubble/);
  assert.match(app,/function openImageCropper/);
  assert.match(app,/Escolher corte do banner/);
  assert.match(app,/dataset\.modalLock='settings'/);
  assert.match(app,/layer\.onclick=\(\)=>\{\}/);
  assert.match(css,/\.profile-status-bubble/);
  assert.match(css,/\.crop-overlay/);
});

test('2.0.8: ícones críticos são SVG e a versão Android está alinhada',()=>{
  assert.match(app,/function uiIcon/);
  assert.match(app,/uiIcon\('home',20\)/);
  assert.match(css,/\.ui-icon/);
  assert.match(gradle,/versionCode = 305/);
  assert.match(gradle,/versionName = "3\.0\.5"/);
});

test('2.0.8: contas salvas podem ser esquecidas sem apagar a conta Cloud',()=>{
  assert.match(app,/data-forget-saved/);
  assert.match(app,/Conta removida deste dispositivo/);
});
