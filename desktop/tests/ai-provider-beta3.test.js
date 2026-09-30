'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {generateLolaReply}=require('../backend/ai-provider');

test('IA OpenAI-compatible: quando /responses não existe, usa /chat/completions sem perder o contexto',async t=>{
  const keys=['AZURECORD_AI_PROVIDER','AZURECORD_OPENAI_API_KEY','AZURECORD_AI_BASE_URL','AZURECORD_AI_MODEL','AZURECORD_AI_REASONING'];
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const requests=[];
  const mock=http.createServer(async(req,res)=>{
    let data='';for await(const chunk of req)data+=chunk;
    const body=JSON.parse(data);requests.push({path:req.url,body});
    res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/responses'){res.statusCode=404;res.end(JSON.stringify({error:{message:'Unsupported endpoint'}}));return;}
    res.end(JSON.stringify({id:'mock-chat',choices:[{message:{content:'A capital é Brasília! 💙'}}]}));
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>mock.close(resolve));for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
  Object.assign(process.env,{AZURECORD_AI_PROVIDER:'openai-compatible',AZURECORD_OPENAI_API_KEY:'mock-key',AZURECORD_AI_BASE_URL:`http://127.0.0.1:${mock.address().port}/v1`,AZURECORD_AI_MODEL:'mock-model',AZURECORD_AI_REASONING:'none'});
  const result=await generateLolaReply({systemPrompt:'Você é Lola.',messages:[{role:'user',text:'Oi'},{role:'assistant',text:'Olá!'},{role:'user',text:'Qual é a capital do Brasil?'}]});
  assert.match(result.text,/Brasília/);
  assert.deepEqual(requests.map(r=>r.path),['/v1/responses','/v1/chat/completions']);
  assert.deepEqual(requests[1].body.messages.map(x=>x.role),['system','user','assistant','user']);
  assert.equal(requests[1].body.messages[2].content,'Olá!');
  assert.equal(requests[1].body.messages[3].content,'Qual é a capital do Brasil?');
});
