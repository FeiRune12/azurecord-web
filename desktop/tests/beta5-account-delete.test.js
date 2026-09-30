'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {startBackend}=require('../backend/server');

async function api(base, endpoint, method='GET', body=null, token=''){
  const r=await fetch(base+endpoint,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
  let data={}; try{data=await r.json();}catch{}
  return {status:r.status,...data};
}
const setup=()=>fs.mkdtempSync(path.join(os.tmpdir(),'azurecord-delete-'));
const shred=p=>fs.rmSync(p,{recursive:true,force:true});

test('Beta5: excluir conta exige senha atual e confirmação explícita',async t=>{
  const dir=setup(),db=path.join(dir,'db.json');
  const running=await startBackend({host:'127.0.0.1',port:0,dataFile:db});
  t.after(async()=>{await running.backend.close();shred(dir);});
  const base=`http://127.0.0.1:${running.address.port}`;
  const signup=await api(base,'/api/auth/signup','POST',{email:'azure@delete.test',password:'SenhaSegura123!',username:'Azure'});
  assert.equal(signup.status,201);
  const wrong=await api(base,'/api/me','DELETE',{currentPassword:'errada',confirmation:'EXCLUIR CONTA'},signup.token);
  assert.equal(wrong.status,401);
  const missing=await api(base,'/api/me','DELETE',{currentPassword:'SenhaSegura123!',confirmation:'sim'},signup.token);
  assert.equal(missing.status,400);
  assert.equal((await api(base,'/api/me','GET',null,signup.token)).status,200,'conta continua intacta após confirmações inválidas');
});

test('Beta5: exclusão apaga conta, sessões, mensagens, AP e servidores pessoais sem afetar outra conta',async t=>{
  const dir=setup(),db=path.join(dir,'db.json');
  const running=await startBackend({host:'127.0.0.1',port:0,dataFile:db});
  t.after(async()=>{await running.backend.close();shred(dir);});
  const base=`http://127.0.0.1:${running.address.port}`;
  const azure=await api(base,'/api/auth/signup','POST',{email:'azure@delete.test',password:'SenhaSegura123!',username:'Azure'});
  const other=await api(base,'/api/auth/signup','POST',{email:'other@delete.test',password:'OutraSenha123!',username:'Other'});
  assert.equal(azure.status,201);assert.equal(other.status,201);

  const dm=await api(base,`/api/dms/${other.user.id}/messages`,'POST',{text:'DM privada para apagar'},azure.token);
  assert.equal(dm.status,201);
  const officialMsg=await api(base,'/api/servers/server-azurecord/channels/general/messages','POST',{text:'Mensagem pública para apagar'},azure.token);
  assert.equal(officialMsg.status,201);
  const created=await api(base,'/api/servers','POST',{name:'Servidor da Azure'},azure.token);
  assert.equal(created.status,201);
  const ownText=created.channels.find(c=>c.type==='text');
  const ownMsg=await api(base,`/api/servers/${created.server.id}/channels/${ownText.id}/messages`,'POST',{text:'Mensagem do servidor pessoal'},azure.token);
  assert.equal(ownMsg.status,201);
  assert.equal((await api(base,'/api/points/wallet','GET',null,azure.token)).wallet.available,100);

  // Simula um resgate já pago, que precisa continuar apenas como registro financeiro anonimizado.
  running.backend.store.db.pointsRedemptions.push({id:'red_paid_test',userId:azure.user.id,clientRequestId:'delete-paid-123',points:100,amountCentavos:100,status:'paid',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),paidAt:new Date().toISOString(),receipt:'RECIBO-TESTE'});
  running.backend.store.saveNow();

  const deleted=await api(base,'/api/me','DELETE',{currentPassword:'SenhaSegura123!',confirmation:'EXCLUIR CONTA'},azure.token);
  assert.equal(deleted.status,200);assert.equal(deleted.deleted,true);assert.equal(deleted.emailReusable,true);
  assert.equal((await api(base,'/api/me','GET',null,azure.token)).status,401,'token antigo foi invalidado');
  assert.equal((await api(base,'/api/auth/login','POST',{email:'azure@delete.test',password:'SenhaSegura123!'})).status,404,'conta removida');
  assert.equal((await api(base,'/api/auth/login','POST',{email:'other@delete.test',password:'OutraSenha123!'})).status,200,'outra conta permanece funcionando');

  const data=running.backend.store.db;
  assert.equal(data.users.some(u=>u.id===azure.user.id),false);
  assert.equal(data.sessions.some(s=>s.userId===azure.user.id),false);
  assert.equal(data.messages.some(m=>m.senderId===azure.user.id||m.recipientId===azure.user.id),false);
  assert.equal(data.channelMessages.some(m=>m.senderId===azure.user.id),false);
  assert.equal(data.servers.some(s=>s.id===created.server.id),false);
  assert.equal(data.channels.some(c=>c.serverId===created.server.id),false);
  assert.equal(data.memberships.some(m=>m.userId===azure.user.id),false);
  assert.equal(data.pointsLedger.some(e=>e.userId===azure.user.id),false);
  assert.equal(data.aiMemories[azure.user.id],undefined);
  assert.equal(data.lolaSessions[azure.user.id],undefined);
  const paid=data.pointsRedemptions.find(r=>r.id==='red_paid_test');
  assert.ok(paid);assert.equal(paid.deletedAccount,true);assert.match(paid.userId,/^deleted_[a-f0-9]{20}$/);assert.equal('clientRequestId' in paid,false);
});

test('Beta5: email pode ser cadastrado novamente depois da exclusão',async t=>{
  const dir=setup(),db=path.join(dir,'db.json');
  const running=await startBackend({host:'127.0.0.1',port:0,dataFile:db});
  t.after(async()=>{await running.backend.close();shred(dir);});
  const base=`http://127.0.0.1:${running.address.port}`;
  const first=await api(base,'/api/auth/signup','POST',{email:'reusar@delete.test',password:'PrimeiraSenha123!',username:'AzureA'});
  await api(base,'/api/me','DELETE',{currentPassword:'PrimeiraSenha123!',confirmation:'EXCLUIR CONTA'},first.token);
  const second=await api(base,'/api/auth/signup','POST',{email:'reusar@delete.test',password:'SegundaSenha123!',username:'AzureB'});
  assert.equal(second.status,201);assert.notEqual(second.user.id,first.user.id);
});

test('Beta5: renderer contém botão e confirmação da exclusão permanente',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../renderer/app.js'),'utf8');
  assert.match(src,/id=\\?"deleteAccountBtn\\?"/);
  assert.match(src,/EXCLUIR CONTA/);
  assert.ok(/backendRequest\('\/api\/me',\{method:'DELETE'/.test(src) || /cloudRequest\('\/auth\/delete',\{method:'POST'/.test(src));
  assert.match(src,/purgeDeletedAccountLocal/);
});
