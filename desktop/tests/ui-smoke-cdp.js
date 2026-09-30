/* Smoke test visual do renderer no Chromium instalado. Execute separadamente:
 * node tests/ui-smoke-cdp.js. Não é requisito para npm test em máquinas sem Chrome. */
'use strict';
const { spawn }=require('node:child_process');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');
const assert=require('node:assert/strict');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function httpGet(url){return fetch(url).then(r=>{if(!r.ok)throw Error(`${r.status} ${url}`);return r.json()});}
async function main(){
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'azurecord-cdp-'));
 const renderer=path.resolve(__dirname,'../renderer');
 // HTTP local em porta aleatória: Chromium bloqueia file:// aberto via CDP.
 const server=http.createServer((req,res)=>{
   let pathname;
   try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
   const file=path.resolve(renderer,'.'+(pathname==='/'?'/index.html':pathname));
   if(!file.startsWith(renderer+path.sep)){res.writeHead(403).end();return;}
   fs.readFile(file,(err,buffer)=>{
     if(err){res.writeHead(404).end();return;}
     const type=({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.ico':'image/x-icon'})[path.extname(file)]||'application/octet-stream';
     res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(buffer);
   });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const entry=`http://127.0.0.1:${server.address().port}/index.html`;
 const chrome=spawn('chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-proxy-server','--remote-allow-origins=*','--remote-debugging-port=0',`--user-data-dir=${work}`,'about:blank'],{stdio:'ignore'});
 try{
  let port=null;
  for(let i=0;i<100;i++){
   if(fs.existsSync(path.join(work,'DevToolsActivePort'))){port=Number(fs.readFileSync(path.join(work,'DevToolsActivePort'),'utf8').split('\n')[0]);break;}
   await sleep(100);
  }
  assert.ok(port,'Chromium não abriu porta de depuração');
  const target=await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(entry)}`,{method:'PUT'}).then(r=>r.json());
  const ws=new WebSocket(target.webSocketDebuggerUrl);const pending=new Map();let nextId=1;const browserErrors=[];
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')browserErrors.push(m.params.exceptionDetails.text);};
  function call(method,params={}){return new Promise((resolve,reject)=>{const id=nextId++;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
  async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
  async function waitUntil(expr,timeout=9000){const start=Date.now();while(Date.now()-start<timeout){const value=await evaluate(expr);if(value)return value;await sleep(100);}throw Error(`Timeout: ${expr}`);}
  await call('Runtime.enable');await call('Page.enable');
  await call('Page.navigate',{url:entry});
  try{await waitUntil('location.protocol === "http:" && document.readyState === "complete"');}catch(err){console.error('LOCATION:',await evaluate('JSON.stringify({href:location.href,ready:document.readyState,body:document.body?.innerText?.slice(0,300)})'),browserErrors);throw err;}
  try{await waitUntil('document.querySelector("#demoBtn")?.onclick != null');}catch(err){console.error('DIAGNÓSTICO:',await evaluate('JSON.stringify({url:location.href,body:document.body?.innerText?.slice(0,500),scripts:[...document.scripts].map(x=>x.src),hasButton:!!document.querySelector("#demoBtn")})'),browserErrors);throw err;}
  await evaluate('document.querySelector("#demoBtn").click()');
  await waitUntil('!document.querySelector("#homePanel").hidden');
  const cta=await evaluate('!!document.querySelector("#lolaOpenBtn") && getComputedStyle(document.querySelector("#lolaOpenBtn")).display !== "none"');
  assert.equal(cta,true,'Botão da Lola deve estar visível');
  await evaluate('document.querySelector("#lolaOpenBtn").click()');
  await waitUntil('!document.querySelector("#chatView").hidden && document.querySelector("#messages .message-row")');
  assert.equal(await evaluate('document.querySelector("#messageInput").disabled'),false,'Chat já abre liberado');
  assert.equal(await evaluate('document.querySelector("#newLolaChatBtn").hidden'),false,'Nova conversa acessível');
  await evaluate('document.querySelector("#messageInput").value="oi";document.querySelector("#composer").requestSubmit()');
  await waitUntil('document.querySelectorAll("#messages .message-row").length >= 3');
  await evaluate('document.querySelector("#newLolaChatBtn").click()');
  await waitUntil('document.querySelectorAll("#messages .message-row").length === 1');
  assert.equal(await evaluate('document.querySelector("#messageInput").disabled'),false);
  await evaluate('document.querySelector("#messageInput").value="quanto é 4 + 7?";document.querySelector("#composer").requestSubmit()');
  await waitUntil('document.querySelector("#messages").textContent.includes("11")');
  await evaluate('document.querySelector("#messageInput").value="quero conversar num novo chat";document.querySelector("#composer").requestSubmit()');
  await waitUntil('document.querySelectorAll("#messages .message-row").length === 1');
  assert.equal(await evaluate('document.querySelector("#messageInput").disabled'),false);
  assert.deepEqual(browserErrors,[],'Nenhuma exceção JavaScript não tratada');
  console.log('UI Chromium PASS: Lola acessível sem código; input liberado; saudação única; mensagem normal; nova conversa via botão e texto; fallback matemático; sem exceções.');
  ws.close();
 }finally{
  chrome.kill('SIGKILL');
  await new Promise(resolve=>server.close(resolve));
  await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),sleep(750)]);
  try {fs.rmSync(work,{recursive:true,force:true,maxRetries:4,retryDelay:150});}
  catch(err){console.warn('Cache temporário do Chromium não removido:',err.message);}
 }
}
main().catch(e=>{console.error('UI Chromium FAIL:',e.stack||e);process.exitCode=1;});
