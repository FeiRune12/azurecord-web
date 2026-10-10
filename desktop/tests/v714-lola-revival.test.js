'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const worker = fs.readFileSync(path.join(__dirname, '..', 'cloud', 'worker-v1.0.3.js'), 'utf8');
function extract(name) {
  const marker = (name === 'lolaCallWithDeadline' ? 'async function ' : 'function ') + name + '(';
  const start = worker.indexOf(marker);
  assert.ok(start >= 0, 'Missing '+name);
  const end = worker.indexOf('\n}', start);
  assert.ok(end > start);
  return worker.slice(start,end+2);
}
const names=['lolaChatCommand','lolaWikiTargets','lolaCompactHistory','lolaAnswerText','lolaCallWithDeadline'];
const fns=vm.runInNewContext(names.map(extract).join('\n')+
  '\n({lolaChatCommand,lolaWikiTargets,lolaCompactHistory,lolaAnswerText,lolaCallWithDeadline})',
  {setTimeout,clearTimeout});
test('Lola: new Worker parses as a valid JavaScript module',()=>{
  const file=path.join(__dirname,'..','cloud','worker-v1.0.3.js');
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});

test('Lola: opt-in commands and fandom/Wikipedia routing',()=>{
  assert.equal(fns.lolaChatCommand('Oi'),null);
  assert.equal(fns.lolaChatCommand('/resumir').kind,'summary');
  assert.equal(fns.lolaChatCommand('/ideias app').kind,'ideas');
  assert.equal(fns.lolaChatCommand('/pesquisar Gunvolt').kind,'research');
  assert.equal(fns.lolaWikiTargets('/pesquisar Gunvolt')[0].host,'azurestrikergunvolt.fandom.com');
  assert.equal(fns.lolaWikiTargets('/pesquisar energia solar')[0].host,'pt.wikipedia.org');
  assert.equal(fns.lolaWikiTargets('conversa casual').length,0);
});
test('Lola: trims context without damaging newest user question',()=>{
  const rows=Array.from({length:32},(_,i)=>({role:i%2?'user':'assistant',content:'x'.repeat(8000)}));
  const msg=fns.lolaCompactHistory(rows);
  assert.equal(msg.length,16);
  assert.equal(msg[0].content.length,900);
  assert.equal(msg.at(-1).content.length,6000);
});
test('Lola: parses Workers AI output and never invents text',()=>{
  assert.equal(fns.lolaAnswerText({response:'  Olá  '}),'Olá');
  assert.equal(fns.lolaAnswerText({choices:[{message:{content:'OK'}}]}),'OK');
  assert.equal(fns.lolaAnswerText({result:{response:'Out'}}),'Out');
  assert.equal(fns.lolaAnswerText({response:{error:'no'}}),'');
});
test('Lola: inference resolves or expires with a controlled error',async()=>{
  assert.equal(await fns.lolaCallWithDeadline(async()=>42,100),42);
  await assert.rejects(fns.lolaCallWithDeadline(()=>new Promise(()=>{}),15),{code:'LOLA_AI_TIMEOUT'});
});
test('Lola: retains app routes and authenticates diagnostics',()=>{
  for(const route of ['handleLola','handleKlipy','handleSocial','handleAzurePoints','handleAttachmentUploads','handleLinkPreview'])
    assert.ok(worker.includes(route+'('));
  assert.match(worker,/path === "\/api\/ai\/status"/);
  assert.match(worker,/await requireSocialAuth\(request, env\)/);
  assert.match(worker,/const lolaResponse = await handleLola\(request, env, url, path\)/);
  assert.doesNotMatch(worker,/pass < 2 && !reply/);
});
