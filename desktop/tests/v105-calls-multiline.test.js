'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('1.0.5: composer aceita quebra de linha com Shift+Enter',()=>{
  const html=fs.readFileSync(path.join(root,'renderer','index.html'),'utf8');
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'renderer','styles.css'),'utf8');
  assert.match(html,/<textarea id="messageInput"/);
  assert.match(app,/e\.key==='Enter' && !e\.shiftKey/);
  assert.match(app,/autoResizeComposer/);
  assert.match(css,/message-text\{[^}]*white-space:pre-wrap/s);
  assert.match(css,/textarea#messageInput/);
});

test('1.0.5: AzureCall 1:1 usa WebRTC e sinalização realtime',()=>{
  const html=fs.readFileSync(path.join(root,'renderer','index.html'),'utf8');
  const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
  const worker=fs.readFileSync(path.resolve(root,'..','realtime','worker.js'),'utf8');
  assert.match(html,/id="callOverlay"/);
  assert.match(html,/id="remoteCallVideo"/);
  assert.match(app,/new RTCPeerConnection\(AZURECALL_RTC_CONFIG\)/);
  assert.match(app,/navigator\.mediaDevices\.getUserMedia/);
  assert.match(app,/navigator\.mediaDevices\.getDisplayMedia/);
  assert.match(app,/type:'call\.signal'/);
  assert.match(worker,/message\?\.type === "call\.signal"/);
  assert.match(worker,/version: "1\.3\.0"/);
});

test('1.0.5: desktop habilita seletor de compartilhamento de tela',()=>{
  const main=fs.readFileSync(path.join(root,'main.js'),'utf8');
  assert.match(main,/desktopCapturer/);
  assert.match(main,/setDisplayMediaRequestHandler/);
  assert.match(main,/useSystemPicker:\s*true/);
});
