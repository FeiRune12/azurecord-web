'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const worker = fs.readFileSync(path.join(__dirname, '..', 'cloud', 'worker-v1.0.3.js'), 'utf8');
const client=fs.readFileSync(path.resolve(__dirname,'..','..','docs','app.js'),'utf8');
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


test('Lola: request retries restore saved responses rather than regenerate them',()=>{
  assert.match(worker,/const responseClientId = String\(body\.clientId \|\| ""\)/);
  assert.match(worker,/AND role = 'assistant' AND client_id = \?/);
  assert.match(worker,/reused: true/);
  assert.match(worker,/responseClientId \|\| null, proactive \? 1 : 0/);
  assert.match(client,/clientId:String\(clientId\)\.slice\(0,120\)/);
  assert.match(client,/askLolaAi\(text,messages,files,false,replyKey\)/);
});

test('Lola: repeating a question is still passed to the model',()=>{
  assert.match(worker,/lastHistoryMessage\.role === "user"/);
  assert.doesNotMatch(worker,/!!lastUser && String\(lastUser\.content/);
});

test('Lola: client does not start inference before DM persistence',()=>{
  assert.match(client,/if\(cloudToken && !message\.serverId\)return;/);
  assert.match(client,/if\(dmId==='user-lola' && persisted\)/);
  assert.doesNotMatch(client,/dmId==='user-lola' && !persisted\)\{simulateLolaReply/);
  assert.match(client,/if\(other==='user-lola' && confirmed && !message\._lolaAnswered\)/);
  assert.match(client,/lolaReplyInflight\.has\(replyKey\)/);
  assert.match(client,/lolaReplyInflight\.delete\(replyKey\)/);
  assert.match(client,/const timeout=setTimeout\(\(\)=>controller\.abort\(\),42000\)/);
});

test('Lola: Cloud merge preserves both user message and assistant response',()=>{
  const begin=client.indexOf('const messageMergeKey=(m)=>{');
  const end=client.indexOf('const merged=new Map',begin);
  assert.ok(begin>0 && end>begin, 'DM merge function must exist');
  const expression=client.slice(begin,end)+'\nmessageMergeKey';
  const mergeKey=vm.runInNewContext(expression);
  const own={id:'local-1',senderId:'user-1',clientId:'local-1'};
  const remoteUser={id:'server-user',senderId:'user-1',clientId:'local-1'};
  const bot={id:'server-lola',senderId:'user-lola',clientId:'local-1'};
  assert.equal(mergeKey(own),mergeKey(remoteUser));
  assert.notEqual(mergeKey(bot),mergeKey(own));
});

test('Lola: restores orphaned replies in own DM even when another tab is active',()=>{
  assert.match(client,/const originalView=\{mode:'dm',serverId:null,channelId:null,dmUserId:'user-lola'\}/);
  assert.match(client,/const messages=\(state\.dmMessages\[dmKey\('user-lola'\)\]\|\|\[\]\)/);
  assert.match(client,/const unanswered=all\[lastUserIndex\]/);
  assert.match(client,/const originalId=unanswered\.clientId\|\|unanswered\.id/);
  assert.match(client,/const answered=all\.some/);
  assert.match(client,/if\(!answered && recent && !unanswered\._lolaAnswered\)/);
});

test('Lola: stale queued messages never escape an archived conversation',()=>{
  assert.match(client,/message\.lolaSessionId!==currentSession\)continue/);
});


// Stable official sources for the Gunvolt canon test:
// https://gunvolt.com/en/GV1/
// https://gunvolt.com/en/GV2/product/
// https://gunvolt.com/en/GV3/product/
// https://inticreates.com/gunvolt-chronicles-luminous-avenger-ix-coming-to-switch-ps4-steam-on-september-26th-2019/
const canonStart=worker.indexOf('const LOLA_GUNVOLT_OFFICIAL =');
const canonEnd=worker.indexOf('function lolaWikiTargets(query)',canonStart);
assert.ok(canonStart>=0 && canonEnd>canonStart);
const canon=vm.runInNewContext(worker.slice(canonStart,canonEnd)+
  '\n({lolaGunvoltVerifiedAnswer,lolaGunvoltSuspect,lolaGunvoltFactualQuestion,lolaGunvoltUnsupportedReply,lolaGunvoltRelevant})');

test('Lola: Gunvolt overview is sourced, with real developer and dates',()=>{
  const answer=canon.lolaGunvoltVerifiedAnswer('O que é Azure Striker Gunvolt?');
  assert.ok(answer);
  assert.match(answer.reply,/INTI CREATES/);
  assert.match(answer.reply,/Sumeragi/);
  assert.match(answer.reply,/2014/);
  assert.match(answer.reply,/2016/);
  assert.match(answer.reply,/2022/);
  assert.match(answer.reply,/Luminous Avenger iX/);
  assert.match(answer.reply,/Kirin/);
  assert.doesNotMatch(answer.reply,/INT_SYS|Natsume|Dr[.] Black|2017\)|2020\)/i);
  assert.ok(answer.sources.every(src=>src.startsWith('https://')));
});

test('Lola: development, years and major characters cite official sources',()=>{
  const studio=canon.lolaGunvoltVerifiedAnswer('Quem desenvolveu Gunvolt?');
  assert.match(studio.reply,/INTI CREATES/);
  const dates=canon.lolaGunvoltVerifiedAnswer('Quando saiu Gunvolt 2 e Gunvolt 3?');
  assert.match(dates.reply,/Gunvolt 2 \(2016\)/);
  assert.match(dates.reply,/Gunvolt 3 \(2022\)/);
  const copen=canon.lolaGunvoltVerifiedAnswer('Quem é Copen?');
  assert.match(copen.reply,/Luminous Avenger iX/);
  const kirin=canon.lolaGunvoltVerifiedAnswer('Quem é Kirin?');
  assert.match(kirin.reply,/Gunvolt 3/);
  assert.equal(canon.lolaGunvoltVerifiedAnswer('Oi, Lola!'),null);
});

test('Lola: catches screenshot hallucinations and fails closed for unknown lore',()=>{
  const impossible='A série foi criada pela INT_SYS, publicada pela Natsume, e o vilão é Dr. Black. Gunvolt 2 (2017), Gunvolt 3 (2020).';
  assert.equal(canon.lolaGunvoltSuspect(impossible),true);
  assert.equal(canon.lolaGunvoltSuspect('Gunvolt 2 (2016), Gunvolt 3 (2022), INTI CREATES'),false);
  assert.equal(canon.lolaGunvoltFactualQuestion('Quem é Zed em Gunvolt 3?'),true);
  assert.equal(canon.lolaGunvoltVerifiedAnswer('Quem é Zed em Gunvolt 3?'),null);
  assert.match(canon.lolaGunvoltUnsupportedReply('Quem é Zed em Gunvolt 3?'),/não consegui verificar/);
  assert.match(worker,/lolaGunvoltFactualQuestion\(userText\) && !wikiSources\.length/);
  assert.match(worker,/lolaGunvoltSuspect\(reply\)/);
  assert.match(worker,/const gunvoltVerified = !proactive \? lolaGunvoltVerifiedAnswer\(userText\) : null/);
});
