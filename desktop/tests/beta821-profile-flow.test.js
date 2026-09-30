'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'renderer','styles.css'),'utf8');

test('Lola é perfil de sistema e não dispara amizade/sincronização legada',()=>{
  assert.match(app,/Assistente do sistema/);
  assert.match(app,/Lola é uma assistente do sistema e não usa pedidos de amizade/);
  assert.doesNotMatch(app,/Lola continua adicionada\. A sincronização será repetida quando o backend voltar/);
  assert.match(app,/profile-action-grid-system/);
});

test('perfil mantém preview compacto e modal responsivo',()=>{
  assert.match(app,/Exibir perfil completo/);
  assert.match(app,/openProfilePeek\(el\.dataset\.profileMsg,el\)/);
  assert.match(css,/max-height:min\(84vh,500px\)/);
  assert.match(css,/@media\(max-width:560px\)/);
});

test('AzurePoints não usa mensagem antiga de sincronização no modal',()=>{
  assert.match(app,/carregar sua carteira AzurePoints/);
  assert.match(app,/salvos no D1 Cloud/);
});
