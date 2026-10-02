'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
const android=fs.readFileSync(path.join(root,'..','android','app','src','main','java','com','azurecord','app','AzureCallScreenEngine.kt'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));

test('4.0.3 hotfix mantém a mesma versão',()=>assert.equal(pkg.version,'4.0.3'));
test('call de servidor tem câmera e transmissão',()=>{
 assert.match(app,/serverVoiceCameraBtn/);assert.match(app,/serverVoiceShareBtn/);
 assert.match(app,/toggleServerVoiceCamera/);assert.match(app,/toggleServerVoiceScreen/);
 assert.match(app,/peer\.videoStream=new MediaStream/);
});
test('Android aquece MediaProjection antes da oferta e adapta 30fps',()=>{
 assert.match(android,/adaptOutputFormat\(width, height, 30\)/);
 assert.match(android,/startCapture\(width, height, 30\)/);
 assert.match(android,/320, TimeUnit\.MILLISECONDS/);
});
