'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('1.0.7: presença entre dispositivos tem heartbeat Cloud',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const api=fs.readFileSync(path.join(root,'cloud','worker-v0.8.1.js'),'utf8');
  assert.match(app,/syncPresenceHeartbeat/);
  assert.match(app,/startPresenceHeartbeat/);
  assert.match(app,/\/api\/presence\/heartbeat/);
  assert.match(api,/path === "\/api\/presence\/heartbeat"/);
  assert.match(api,/livePresenceFor/);
  assert.match(api,/presencePayloadForPeers/);
});

test('1.0.7: lista de membros vem do servidor e não usa usuários demo',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const api=fs.readFileSync(path.join(root,'cloud','worker-v0.8.1.js'),'utf8');
  const memberFn=app.slice(app.indexOf('function renderMemberPanel()'),app.indexOf('function openProfilePeek',app.indexOf('function renderMemberPanel()')));
  assert.match(memberFn,/server\?\.members/);
  assert.match(app,/refreshServerMembers/);
  assert.doesNotMatch(memberFn,/DEMO_USERS/);
  assert.match(api,/parts\[3\] === "members" && parts\.length === 4 && method === "GET"/);
  assert.match(api,/listServerMembers/);
});

test('1.0.7: entrada no servidor cria mensagem de boas-vindas',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const api=fs.readFileSync(path.join(root,'cloud','worker-v0.8.1.js'),'utf8');
  assert.match(api,/welcomeMessage/);
  assert.match(api,/member_join/);
  assert.match(api,/entrou no servidor\. Boas-vindas!/);
  assert.match(app,/system-welcome-message/);
  assert.match(app,/m\?\.system\?\.type==='member_join'/);
});

test('1.0.7: enquetes são persistidas e votadas no Cloud',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const api=fs.readFileSync(path.join(root,'cloud','worker-v0.8.1.js'),'utf8');
  assert.match(app,/renderPollCard/);
  assert.match(app,/votePoll/);
  assert.match(app,/poll-vote/);
  assert.match(api,/CREATE TABLE IF NOT EXISTS poll_votes/);
  assert.match(api,/poll_json/);
  assert.match(api,/parts\[7\] === "poll-vote"/);
  assert.match(api,/ON CONFLICT\(message_id, user_id\)/);
});

test('1.0.7: realtime aceita protocolo empacotado e peers de servidores',()=>{
  const worker=fs.readFileSync(path.resolve(root,'..','realtime','worker.js'),'utf8');
  assert.match(worker,/WS_PROTOCOL_PREFIX = "azurecord-v1\."/);
  assert.match(worker,/websocketAuth\(request\)/);
  assert.match(worker,/peerIdsFor\(session\)/);
  assert.match(worker,/version: "1\.4\.0"/);
});
