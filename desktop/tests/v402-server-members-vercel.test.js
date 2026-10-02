'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
const vercelBuild=fs.readFileSync(path.join(root,'web-vercel','build.mjs'),'utf8');

test('4.0.3: server.changed força atualização real dos membros',()=>{
  assert.match(app,/refreshServerMembers\(srv\.id,\{quiet:true,force:true\}\)/);
  assert.match(app,/async function refreshServerMembers\(serverId,\{quiet=true,force=false\}=\{\}\)/);
});

test('4.0.3: abrir servidor e voltar para aba força ressincronização',()=>{
  assert.match(app,/refreshServerMembers\(view\.serverId,\{quiet:true,force:true\}\)/);
  assert.match(app,/window\.addEventListener\('focus'/);
  assert.match(app,/visibilitychange/);
  assert.match(app,/10000/);
});

test('4.0.3: Vercel espelha automaticamente o web já comitado',()=>{
  assert.match(vercelBuild,/resolve\(root, '\.\.', '\.\.', 'docs'\)/);
  assert.match(vercelBuild,/realtimeBaseUrl/);
  assert.match(vercelBuild,/await cp\(sourceDir, distDir/);
});
