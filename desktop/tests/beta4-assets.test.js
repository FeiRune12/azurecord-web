'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('Beta4: scripts do renderer carregam helper de recuperação antes do aplicativo',()=>{
  const html=fs.readFileSync(path.join(root,'renderer','index.html'),'utf8');
  const required=['authNotice','savedAccounts','emailInput','passwordInput','authSubmit','rememberLogin','loginScreen','appScreen'];
  for(const id of required)assert.ok(html.includes(`id="${id}"`),`ID ausente: ${id}`);
  assert.ok(html.indexOf('<script src="auth-recovery.js"></script>')>0);
  assert.ok(html.indexOf('<script src="app.js"></script>')>html.indexOf('<script src="auth-recovery.js"></script>'));
  for(const file of ['app.js','auth-recovery.js','lola-client.js','styles.css'])assert.ok(fs.existsSync(path.join(root,'renderer',file)));
});

test('Beta4: documento de recuperação e utilitário fazem parte do código-fonte',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.match(pkg.version,/^0\.52\.0-beta\.(?:[5-9][0-9]*)(?:\.\d+){0,2}$/);
  for(const name of ['RECUPERAR-CONTA-AZURE.md','TESTE-BETA4.md','tools/recover-account.js','backend/.env.example']){
    assert.ok(fs.existsSync(path.join(root,name)),`${name} ausente`);
  }
  assert.ok(!fs.existsSync(path.join(root,'backend','.env')),'Nenhuma API key pode ser empacotada.');
  assert.ok(!fs.existsSync(path.join(root,'backend','azurecord.json')),'O banco de usuários nunca deve ser empacotado.');
});
