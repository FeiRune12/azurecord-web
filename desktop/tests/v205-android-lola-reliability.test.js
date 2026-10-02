'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');

test('2.0.8: Lola usa sessão autenticada e não capability stale do health',()=>{
  const start=app.indexOf('function lolaCloudReady()');
  const ready=app.slice(start,app.indexOf('function pointsCloudReady',start));
  const askStart=app.indexOf('async function askLolaAi');
  const ask=app.slice(askStart,app.indexOf('function migrateLocalConversationOwner',askStart));
  assert.match(ready,/cloudToken/);
  assert.match(ready,/cloudVerifiedAccountId===state\.currentAccountId/);
  assert.doesNotMatch(ready,/lolaWorkersAI/);
  assert.match(ask,/if\(!lolaCloudReady\(\)\)/);
  assert.doesNotMatch(ask,/capabilities\?\.lolaWorkersAI/);
});

test('2.0.8: Lola recupera sessão real e nunca envia legacy para API',()=>{
  assert.match(app,/async function ensureLolaSession/);
  assert.match(app,/\/api\/ai\/conversations/);
  assert.match(app,/\.\.\.\(sessionId\?\{sessionId\}:\{\}\)/);
  assert.doesNotMatch(app,/sessionId:m\.lolaSessionId\|\|'legacy'/);
});

test('2.0.8: mensagens têm retry transitório idempotente e confirmação do servidor',()=>{
  assert.match(app,/async function cloudPostMessageWithRetry/);
  assert.match(app,/retryableCloudMessageError/);
  assert.match(app,/retries=1/);
  assert.match(app,/clientId:m\.id/);
  assert.match(app,/O servidor não confirmou a mensagem/);
});

test('2.0.8: Android usa adaptive launcher icon e versão alinhada',()=>{
  const manifest=fs.readFileSync(path.resolve(root,'..','android','app','src','main','AndroidManifest.xml'),'utf8');
  const gradle=fs.readFileSync(path.resolve(root,'..','android','app','build.gradle.kts'),'utf8');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.match(manifest,/android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest,/android:roundIcon="@mipmap\/ic_launcher_round"/);
  assert.match(gradle,/versionName = "4\.0\.1"/);
  assert.equal(pkg.version,'4.0.1');
  assert.ok(fs.existsSync(path.resolve(root,'..','android','app','src','main','res','mipmap-anydpi-v26','ic_launcher.xml')));
  assert.ok(fs.existsSync(path.resolve(root,'..','android','app','src','main','res','mipmap-anydpi-v26','ic_launcher_round.xml')));
});
