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
  assert.match(app,/activeConversation\?1800:8000/);
  assert.match(app,/cloudRealtimeConnected\(\)\?12000:5000/);
});

test('2.0.3: versao do cliente esta correta',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(pkg.version,'2.0.3');
});
