'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {startBackend}=require('../backend/server');
const auth=require('../renderer/auth-recovery');
const recovery=require('../tools/recover-account');

async function api(base, endpoint, method='GET', body=null, token=''){
  const r=await fetch(base+endpoint,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
  return {status:r.status,...await r.json()};
}
const setup=()=>fs.mkdtempSync(path.join(os.tmpdir(),'azurecord-recovery-'));
const shred=p=>fs.rmSync(p,{recursive:true,force:true});

test('Beta4: login da conta original e sessão persistem após reiniciar o mesmo backend',async t=>{
  const dir=setup();
  const db=path.join(dir,'azurecord.json');
  let started=await startBackend({host:'127.0.0.1',port:0,dataFile:db});
  t.after(async()=>{if(started)await started.backend.close();shred(dir);});
  let base=`http://127.0.0.1:${started.address.port}`;
  const signup=await api(base,'/api/auth/signup','POST',{email:'  Azure@Example.Test  ',password:'SenhaForteOriginal23!',username:'Azure'});
  assert.equal(signup.status,201);
  const originalId=signup.user.id;
  assert.equal(signup.user.email,'azure@example.test');
  const dm=await api(base,'/api/dms/user-lola/messages','POST',{text:'Minha conversa antes da atualização'},signup.token);
  assert.equal(dm.status,201);
  const points=await api(base,'/api/points/wallet','GET',null,signup.token);
  assert.equal(points.wallet.available,100);
  const wrong=await api(base,'/api/auth/login','POST',{email:'azure@example.test',password:'SenhaErrada'});
  assert.equal(wrong.status,401);
  await started.backend.close();started=null;
  const initial=JSON.parse(fs.readFileSync(db,'utf8'));
  assert.ok(initial.users.some(u=>u.id===originalId && u.username==='Azure'));
  started=await startBackend({host:'127.0.0.1',port:0,dataFile:db});base=`http://127.0.0.1:${started.address.port}`;
  assert.equal((await api(base,'/api/me','GET',null,signup.token)).user.id,originalId,'token persistido no mesmo banco');
  const login=await api(base,'/api/auth/login','POST',{email:'azure@example.test',password:'SenhaForteOriginal23!'});
  assert.equal(login.user.id,originalId,'sem criar segunda conta nem ID');
  assert.equal((await api(base,'/api/dms/user-lola','GET',null,login.token)).messages.length,1);
  assert.equal((await api(base,'/api/points/wallet','GET',null,login.token)).wallet.available,100);
  assert.equal(started.backend.store.db.users.filter(u=>u.email==='azure@example.test').length,1);
});

test('Beta4: se banco principal for apagado, recupera backup válido preservando conta',async t=>{
  const dir=setup();const db=path.join(dir,'db.json');
  let running=await startBackend({host:'127.0.0.1',port:0,dataFile:db});
  t.after(async()=>{if(running)await running.backend.close();shred(dir);});
  const base=`http://127.0.0.1:${running.address.port}`;
  const signup=await api(base,'/api/auth/signup','POST',{email:'azure@backup.test',password:'Pass123456!',username:'Azure'});
  await running.backend.close();running=null;
  fs.copyFileSync(db,db+'.bak');fs.rmSync(db);
  running=await startBackend({host:'127.0.0.1',port:0,dataFile:db});
  assert.equal((await api(`http://127.0.0.1:${running.address.port}`,'/api/me','GET',null,signup.token)).user.id,signup.user.id);
  assert.ok(fs.existsSync(db));
});

test('Beta4: banco corrompido é arquivado e backup válido é restaurado antes de novas escritas',async t=>{
  const dir=setup();const db=path.join(dir,'db.json');
  let running=await startBackend({host:'127.0.0.1',port:0,dataFile:db});
  t.after(async()=>{if(running)await running.backend.close();shred(dir);});
  const signup=await api(`http://127.0.0.1:${running.address.port}`,'/api/auth/signup','POST',{email:'azure@safe.test',password:'SafePass123!',username:'Azure'});
  await running.backend.close();running=null;
  const clean=fs.readFileSync(db);
  fs.copyFileSync(db,db+'.bak');fs.writeFileSync(db,'{"users": [ TRUNCATED');
  running=await startBackend({host:'127.0.0.1',port:0,dataFile:db});
  assert.equal((await api(`http://127.0.0.1:${running.address.port}`,'/api/me','GET',null,signup.token)).user.id,signup.user.id);
  const quarantines=fs.readdirSync(dir).filter(x=>x.includes('corrupt-'));
  assert.equal(quarantines.length,1);
  assert.equal(fs.readFileSync(path.join(dir,quarantines[0]),'utf8'),'{"users": [ TRUNCATED');
  assert.deepEqual(fs.readFileSync(db+'.bak'),clean,'backup original foi preservado');
});

test('Beta4: com todas as cópias inválidas não sobrescreve a conta por um banco vazio',async t=>{
  const dir=setup();t.after(()=>shred(dir));const db=path.join(dir,'db.json');
  const original='{"users": [ DANIFICADO';fs.writeFileSync(db,original);fs.writeFileSync(db+'.bak','{}');fs.writeFileSync(db+'.bak.previous','not-json');
  await assert.rejects(startBackend({host:'127.0.0.1',port:0,dataFile:db}),/Nenhum banco\/backup válido/);
  assert.equal(fs.readFileSync(db,'utf8'),original);
  assert.equal(fs.readFileSync(db+'.bak','utf8'),'{}');
  assert.equal(fs.readFileSync(db+'.bak.previous','utf8'),'not-json');
});

test('Beta4: recuperação só sobrescreve banco realmente vazio; mantém dados reais',()=>{
  const fixture={users:[{id:'user-lola',isDemo:true}],servers:[{id:'server-azurecord'}],memberships:[],channels:[],messages:[],aiMemories:{}};
  assert.equal(recovery.safelyReplaceable(fixture),true);
  for(const changes of [
    {users:[...fixture.users,{id:'usr_AZURE',isDemo:false}]},
    {messages:[{text:'histórico'}]},
    {pointsLedger:[{delta:100,userId:'usr_AZURE'}]},
    {sessions:[{token:'secret'}]},
    {aiMemories:{'usr_AZURE':{summary:'memória'}}},
    {memberships:[{userId:'usr_AZURE',serverId:'server-azurecord'}]},
    {channels:[{serverId:'srv_pessoal'}]}
  ])assert.equal(recovery.safelyReplaceable({...fixture,...changes}),false);
});

test('Beta4: utilitário de recuperação lê sem modificar e exige confirmação para restaurar',async t=>{
  const dir=setup();t.after(()=>shred(dir));const appdata=path.join(dir,'AppData');
  const db=path.join(appdata,'azurecord-desktop','backend','azurecord.json');fs.mkdirSync(path.dirname(db),{recursive:true});
  let running=await startBackend({host:'127.0.0.1',port:0,dataFile:db});
  const signup=await api(`http://127.0.0.1:${running.address.port}`,'/api/auth/signup','POST',{email:'azure@restore.test',password:'Restore123!',username:'Azure'});
  await running.backend.close();running=null;
  fs.copyFileSync(db,db+'.bak');const original=fs.readFileSync(db);fs.rmSync(db);
  const tool=path.resolve(__dirname,'../tools/recover-account.js');
  const env={...process.env,APPDATA:appdata};
  const dry=execFileSync(process.execPath,[tool,'--email','azure@restore.test'],{env,encoding:'utf8'});
  assert.match(dry,/CONTA ENCONTRADA/);
  assert.equal(fs.existsSync(db),false,'inspeção é somente leitura');
  const cancel=execFileSync(process.execPath,[tool,'--email','azure@restore.test','--restore','--confirm','CANCELAR'],{env,encoding:'utf8'});
  assert.match(cancel,/Cancelado/);assert.equal(fs.existsSync(db),false);
  const restored=execFileSync(process.execPath,[tool,'--email','azure@restore.test','--restore','--confirm','RESTAURAR'],{env,encoding:'utf8'});
  assert.match(restored,/RECUPERAÇÃO CONCLUÍDA/);
  assert.deepEqual(fs.readFileSync(db),original);
  assert.equal(recovery.containsUser(recovery.inspect(db).db,'azure@restore.test').id,signup.user.id);
});

test('Beta4: UI não abre perfil salvo sem sessão validada nesta execução',()=>{
  const state={backendToken:'token-antigo',backendAccountId:'usr_Azure',rememberedAccountId:'usr_Azure',backendOrigin:'local-device',accounts:[{id:'usr_Azure',email:'azure@test.dev',backend:true}]};
  assert.equal(auth.canResume(state,true,'local-device',null),false);
  assert.equal(auth.canResume(state,false,'local-device','usr_Azure'),false);
  assert.equal(auth.canResume(state,true,'https://outro-backend.com','usr_Azure'),false);
  assert.equal(auth.canResume(state,true,'local-device','usr_Azure'),true);
  assert.equal(auth.canResume({...state,backendAccountId:'usr_intruso'},true,'local-device','usr_Azure'),false);
  assert.equal(auth.emailKey(' Azure@Example.Com '),'azure@example.com');
});
