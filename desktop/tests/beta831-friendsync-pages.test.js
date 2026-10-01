const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');

test('Social Cloud usa realtime sem forçar snapshot pesado ao abrir Amigos', () => {
  assert.match(app, /if\(socialCloudReady\(\)\)wakeCloudRealtimeSync\(\{snapshot:false\}\)/);
  assert.match(app, /function cloudRealtimeDelay\(\)/);
  assert.match(app, /cloudRealtimeConnected\(\)\?12000:5000/);
  assert.match(app, /socialSnapshotSignature/);
  assert.match(app, /if\(!socialCloudReady\(\)\)/);
  assert.match(app, /return cloudRequest\(path,options\)/);
});

test('Solicitações somem sem pendências e badge de Amigos permanece oculto', () => {
  assert.match(app, /requestNav\.hidden=pending===0/);
  assert.match(app, /friendBadge\.hidden=true/);
  assert.match(app, /section==='requests'&&!hasRequests/);
});

test('Anexos grandes usam upload multipart sem limite artificial de 1,5 MB', () => {
  assert.doesNotMatch(app, /maxSingle=1500\*1024/);
  assert.match(app, /uploadAttachmentInChunks/);
  assert.match(app, /\/api\/uploads\/part/);
  assert.match(app, /preparePendingAttachmentsForSend/);
});

test('Beta 8.3.1 remove botão inicial da Lola e servidor de demonstração', () => {
  assert.doesNotMatch(html, /Conversar com Lola/);
  assert.doesNotMatch(app, /const DEMO_SERVER/);
  assert.match(app, /s\.id!=='server-azurecord'/);
});

test('Beta 8.3.1 inclui publicação estática para GitHub Pages', () => {
  assert.ok(fs.existsSync(path.join(root, 'docs', 'index.html')));
  assert.ok(fs.existsSync(path.join(root, 'docs', '.nojekyll')));
});


test('Azurecord 1.0 tem convites por link, entrada por link e realtime instantâneo', () => {
  assert.match(app, /serverInviteLink/);
  assert.match(app, /joinServerByInvite/);
  assert.match(app, /serverJoinLink/);
  assert.match(app, /dm\.upsert/);
  assert.match(app, /channel\.upsert/);
  assert.match(app, /server\.commit/);
  assert.match(app, /social\.commit/);
});

test('Azurecord 1.0 remove limite artificial de mídia ao criar e editar servidor', () => {
  assert.match(app, /Sem limite artificial de MB/);
  assert.match(app, /server-icon/);
  assert.match(app, /server-banner/);
  assert.doesNotMatch(app, /serverSettingsIconFile[\s\S]{0,400}maxChars:450000/);
});

test('Abas de amigos exibem contagem no estilo Online — N', () => {
  assert.match(app, /Online — \$\{online\}/);
  assert.match(app, /Todos — \$\{ids\.length\}/);
});
