'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {startBackend}=require('../backend/server');

function listen(server){return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));}
async function call(base,endpoint,token,method='GET',body){
  const response=await fetch(base+endpoint,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const json=await response.json();return {status:response.status,...json};
}
function openAIText(reply){return {id:'mock-response',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:reply}]}]};}

// Mock HTTP local: valida o formato das chamadas reais sem gastar créditos ou
// fingir que uma conexão com um LLM externo foi testada.
test('Lola: perguntas normais, segunda resposta não repetida, chat novo, DM isolada e persistência',async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'azurecord-lola-'));
  const old={};for(const key of ['AZURECORD_AI_PROVIDER','AZURECORD_OPENAI_API_KEY','AZURECORD_AI_BASE_URL','AZURECORD_AI_MODEL','AZURECORD_AI_REASONING','AZURECORD_AI_MEMORY_REFRESH'])old[key]=process.env[key];
  let backend=null, mock=null;
  t.after(async()=>{
    if(backend)await backend.close();
    if(mock)await new Promise(resolve=>mock.close(resolve));
    for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    fs.rmSync(temp,{recursive:true,force:true});
  });
  const requests=[];
  const responses=[
    'Brasília é a capital do Brasil. A cidade foi inaugurada em 1960.',
    'Brasília é a capital do Brasil. A cidade foi inaugurada em 1960.',
    'Sobre a população, o número varia conforme o ano e a fonte. Qual período você quer?',
    'Estrelas são enormes esferas de plasma que produzem energia por fusão nuclear.'
  ];
  mock=http.createServer(async(req,res)=>{
    let raw='';for await (const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);requests.push(body);
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify(openAIText(responses.shift()||'Resposta alternativa e contextual para teste.')));
  });
  const aiPort=await listen(mock);
  Object.assign(process.env,{AZURECORD_AI_PROVIDER:'openai-compatible',AZURECORD_OPENAI_API_KEY:'mock-key',AZURECORD_AI_BASE_URL:`http://127.0.0.1:${aiPort}/v1`,AZURECORD_AI_MODEL:'mock-lola',AZURECORD_AI_REASONING:'none',AZURECORD_AI_MEMORY_REFRESH:'false'});
  const file=path.join(temp,'db.json');
  let started=await startBackend({host:'127.0.0.1',port:0,dataFile:file});backend=started.backend;
  let base=`http://127.0.0.1:${started.address.port}`;
  const signup=await call(base,'/api/auth/signup',null,'POST',{email:'user@test.local',username:'tester',password:'SuperSecret123'});
  assert.equal(signup.status,201);const token=signup.token;
  const session=await call(base,'/api/ai/conversations',token);
  assert.equal(session.sessionId,'legacy');
  const dm1=await call(base,'/api/dms/user-lola/messages',token,'POST',{text:'Qual é a capital do Brasil?',sessionId:'legacy'});
  assert.equal(dm1.status,201);
  const first=await call(base,'/api/ai/chat',token,'POST',{userText:'Qual é a capital do Brasil?',sessionId:'legacy'});
  assert.equal(first.status,200);assert.match(first.reply,/Brasília/);
  assert.equal(requests[0].model,'mock-lola');
  const userTurns=requests[0].input.filter(m=>m.role==='user'&&m.content.some(c=>c.text==='Qual é a capital do Brasil?'));
  assert.equal(userTurns.length,1,'o mesmo turno da DM não pode ser inserido duas vezes no contexto');
  const second=await call(base,'/api/ai/chat',token,'POST',{userText:'E a população?',sessionId:'legacy'});
  assert.equal(second.status,200);
  assert.match(second.reply,/população/);
  assert.equal(requests.length,3,'resposta repetida aciona UMA tentativa de reescrita');
  assert.match(requests[2].instructions,/Reescreva DO ZERO/);
  const newChat=await call(base,'/api/ai/chat',token,'POST',{userText:'quero conversar num novo chat',sessionId:'legacy'});
  assert.equal(newChat.newChat,true);assert.notEqual(newChat.sessionId,'legacy');
  assert.equal(requests.length,3,'novo chat é comando de produto, não gera chamada extra ao LLM');
  assert.equal((await call(base,'/api/dms/user-lola',token)).messages.length,0);
  assert.equal((await call(base,'/api/ai/chat',token,'POST',{userText:'antigo',sessionId:'legacy'})).status,409);
  assert.equal((await call(base,'/api/ai/chat',token,'POST',{userText:'quero conversar num novo chat',sessionId:'legacy'})).status,409,'comando atrasado não reinicia conversa recente');
  assert.equal((await call(base,'/api/ai/conversations',token)).sessionId,newChat.sessionId);
  const dm2=await call(base,'/api/dms/user-lola/messages',token,'POST',{text:'O que são estrelas?',sessionId:newChat.sessionId});
  assert.equal(dm2.status,201);
  const third=await call(base,'/api/ai/chat',token,'POST',{userText:'O que são estrelas?',sessionId:newChat.sessionId});
  assert.equal(third.status,200);assert.match(third.reply,/plasma/);
  assert.equal(requests.length,4);
  const newContext=JSON.stringify(requests[3].input);
  assert.ok(!newContext.includes('capital do Brasil') && !newContext.includes('população'), 'chat novo NÃO recebe turnos antigos');
  assert.equal((await call(base,'/api/dms/user-lola',token)).messages.length,2);
  await backend.close();backend=null;
  started=await startBackend({host:'127.0.0.1',port:0,dataFile:file});backend=started.backend;
  base=`http://127.0.0.1:${started.address.port}`;
  assert.equal((await call(base,'/api/ai/conversations',token)).sessionId,newChat.sessionId);
  assert.equal((await call(base,'/api/dms/user-lola',token)).messages.length,2);
  assert.ok(backend.store.db.messages.length>=4,'histórico anterior é arquivado, não descartado');
});

test('Resposta atrasada da IA não reaparece depois que uma nova conversa é criada',async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'azurecord-lola-race-'));
  let backend=null,mock=null,releaseRequest,seenRequest;
  const requestReceived=new Promise(resolve=>{seenRequest=resolve;});
  const gate=new Promise(resolve=>{releaseRequest=resolve;});
  const old={};for(const key of ['AZURECORD_AI_PROVIDER','AZURECORD_OPENAI_API_KEY','AZURECORD_AI_BASE_URL','AZURECORD_AI_MODEL','AZURECORD_AI_REASONING','AZURECORD_AI_MEMORY_REFRESH'])old[key]=process.env[key];
  t.after(async()=>{releaseRequest();if(backend)await backend.close();if(mock)await new Promise(resolve=>mock.close(resolve));for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}fs.rmSync(temp,{recursive:true,force:true});});
  mock=http.createServer(async(req,res)=>{for await (const ignored of req){}seenRequest();await gate;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(openAIText('Resposta da conversa antiga.')));});
  const aiPort=await listen(mock);
  Object.assign(process.env,{AZURECORD_AI_PROVIDER:'openai-compatible',AZURECORD_OPENAI_API_KEY:'mock-key',AZURECORD_AI_BASE_URL:`http://127.0.0.1:${aiPort}/v1`,AZURECORD_AI_MODEL:'mock-lola',AZURECORD_AI_REASONING:'none',AZURECORD_AI_MEMORY_REFRESH:'false'});
  const started=await startBackend({host:'127.0.0.1',port:0,dataFile:path.join(temp,'db.json')});backend=started.backend;
  const base=`http://127.0.0.1:${started.address.port}`;
  const signed=await call(base,'/api/auth/signup',null,'POST',{email:'race@test.local',username:'race',password:'SuperSecret123'});const token=signed.token;
  const inflight=call(base,'/api/ai/chat',token,'POST',{userText:'Explica um assunto',sessionId:'legacy'});
  await requestReceived;
  const fresh=await call(base,'/api/ai/conversations/new',token,'POST',{});
  assert.equal(fresh.status,201);
  releaseRequest();
  const result=await inflight;
  assert.equal(result.status,409);
  assert.equal((await call(base,'/api/dms/user-lola',token)).messages.length,0);
});
