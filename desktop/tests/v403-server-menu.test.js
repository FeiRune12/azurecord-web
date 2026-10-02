'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'renderer','styles.css'),'utf8');
const api=fs.readFileSync(path.join(root,'cloud','worker-v0.9.2.js'),'utf8');

test('4.0.3: menu rápido contém todas as ações pedidas',()=>{
  for(const text of [
    'Marcar como lida','Convidar para o servidor','Silenciar servidor','Config. de notificação',
    'Ocultar canais silenciados','Mostrar todos os canais','Config. de privacidade',
    'Editar perfil por servidor','Sair do servidor','Copiar ID do servidor'
  ]) assert.ok(app.includes(text),text);
  assert.match(css,/\.server-quick-menu/);
});

test('4.0.3: sair do servidor persiste no backend e protege o dono',()=>{
  assert.match(app,/\/leave'\,\{method:'DELETE'\}/);
  assert.match(api,/parts\[3\] === "leave"/);
  assert.match(api,/owner_cannot_leave/);
  assert.match(api,/DELETE FROM server_members WHERE server_id = \? AND user_id = \?/);
});

test('4.0.3: perfil por servidor salva apelido do próprio membro',()=>{
  assert.match(app,/members\/@me/);
  assert.match(api,/parts\[4\] === "@me"/);
  assert.match(api,/UPDATE server_members SET nickname = \?/);
});

test('4.0.3: join confirma persistência e canais podem ser silenciados',()=>{
  assert.match(api,/JOIN PERSISTENCE ERROR/);
  assert.match(api,/persistedMembership/);
  assert.match(app,/mutedChannels/);
  assert.match(app,/channel-muted/);
});
