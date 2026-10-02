'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('2.0.3: websocket tem watchdog e reconexao de socket zumbi',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  assert.match(app,/cloudRealtimeWatchdogTimer/);
  assert.match(app,/cloudRealtimeLastPongAt/);
  assert.match(app,/heartbeat timeout/);
  assert.match(app,/65000/);
  assert.match(app,/wakeCloudRealtimeSync\(\{snapshot:true\}\)/);
});

test('2.0.3: conversa aberta faz fallback rapido mesmo com websocket conectado',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  assert.match(app,/activeConversation\?700:2500/);
  assert.match(app,/activeConversation\?500:1500/);
  assert.match(app,/cloudRealtimeConnected\(\)\?12000:5000/);
});

test('2.0.3: versao do cliente esta correta',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(pkg.version,'4.0.3');
});

test('2.0.3: AzureCall busca ICE dinamico e API suporta TURN seguro',()=>{
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const api=fs.readFileSync(path.join(root,'cloud','worker-v0.8.1.js'),'utf8');
  assert.match(app,/ensureAzureCallIceConfig/);
  assert.match(app,/\/api\/realtime\/ice-servers/);
  assert.match(app,/iceCandidatePoolSize:4/);
  assert.match(api,/TURN_KEY_ID/);
  assert.match(api,/TURN_KEY_API_TOKEN/);
  assert.match(api,/generate-ice-servers/);
  assert.match(api,/azureCallTurn:/);
});
