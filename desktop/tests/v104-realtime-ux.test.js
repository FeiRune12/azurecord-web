'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('1.0.4: typing, presença realtime e drag/drop estão ligados no renderer',()=>{
  const html=fs.readFileSync(path.join(root,'renderer','index.html'),'utf8');
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'renderer','styles.css'),'utf8');
  assert.match(html,/id="typingIndicator"/);
  assert.match(html,/id="chatDropOverlay"/);
  assert.match(app,/handleTypingInput/);
  assert.match(app,/handleChatDrop/);
  assert.match(app,/presence\.changed/);
  assert.match(app,/publishPresence/);
  assert.match(css,/chat-drop-overlay/);
  assert.match(css,/typing-indicator/);
});

test('1.0.4: realtime worker suporta typing e presence',()=>{
  const worker=fs.readFileSync(path.resolve(root,'..','realtime','worker.js'),'utf8');
  assert.match(worker,/message\?\.type === "typing"/);
  assert.match(worker,/message\?\.type === "presence\.commit"/);
  assert.match(worker,/version: "1\.2\.0"/);
});
