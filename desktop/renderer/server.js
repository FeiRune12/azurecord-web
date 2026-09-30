const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 5500);
const ROOT = __dirname;
const clients = new Map();
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon'};

function send(ws, payload) {
  if (!ws || ws.destroyed) return;
  const body = Buffer.from(JSON.stringify(payload));
  let header;
  if (body.length < 126) header = Buffer.from([0x81, body.length]);
  else if (body.length < 65536) { header = Buffer.alloc(4); header[0]=0x81; header[1]=126; header.writeUInt16BE(body.length,2); }
  else { header = Buffer.alloc(10); header[0]=0x81; header[1]=127; header.writeBigUInt64BE(BigInt(body.length),2); }
  try { ws.write(Buffer.concat([header,body])); } catch {}
}
function closeSocket(ws) { try { ws.end(); } catch {} }
function broadcastCallState(userId, payload) { const c=clients.get(String(userId)); if(c) { send(c.socket,payload); return true; } return false; }
function safePath(urlPath) { const clean=decodeURIComponent((urlPath||'/').split('?')[0]); const rel=clean==='/'?'/index.html':clean; const full=path.normalize(path.join(ROOT,rel)); return full.startsWith(ROOT)?full:null; }


let edgeTtsModulePromise = null;
async function getEdgeTts() {
  if (!edgeTtsModulePromise) edgeTtsModulePromise = import('@travisvn/edge-tts');
  return edgeTtsModulePromise;
}

async function handleTTS(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const text = (requestUrl.searchParams.get('text') || '').trim().slice(0, 800);
  if (!text) { res.writeHead(400, {'Content-Type':'text/plain; charset=utf-8'}); return res.end('Texto vazio.'); }
  try {
    const { EdgeTTS } = await getEdgeTts();
    const tts = new EdgeTTS(text, 'pt-BR-ThalitaMultilingualNeural', {
      rate: '+12%',
      pitch: '+10Hz',
      volume: '+0%'
    });
    const result = await tts.synthesize();
    const audioBuffer = Buffer.from(await result.audio.arrayBuffer());
    res.writeHead(200, {
      'Content-Type':'audio/mpeg',
      'Content-Length': String(audioBuffer.length),
      'Cache-Control':'no-store',
      'Access-Control-Allow-Origin':'*'
    });
    res.end(audioBuffer);
  } catch (err) {
    console.error('[TTS]', err);
    res.writeHead(503, {'Content-Type':'text/plain; charset=utf-8'});
    res.end('O serviço de voz não está disponível. Verifique a instalação do @travisvn/edge-tts e a conexão com a internet.');
  }
}

const server = http.createServer((req,res)=>{
  if ((req.url || '').split('?')[0] === '/api/tts') return handleTTS(req, res);
  const filePath=safePath(req.url);
  if(!filePath){res.writeHead(403);return res.end('Forbidden');}
  fs.stat(filePath,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404);return res.end('Not found');}
    res.writeHead(200,{'Content-Type':MIME[path.extname(filePath).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});
    fs.createReadStream(filePath).pipe(res);
  });
});

function parseFrames(ws, chunk) {
  ws._buffer = Buffer.concat([ws._buffer||Buffer.alloc(0), chunk]);
  const out=[];
  while(ws._buffer.length>=2){
    const b1=ws._buffer[0], b2=ws._buffer[1];
    const fin=(b1&0x80)!==0, opcode=b1&0x0f, masked=(b2&0x80)!==0; let len=b2&0x7f, off=2;
    if(len===126){ if(ws._buffer.length<4) break; len=ws._buffer.readUInt16BE(2); off=4; }
    else if(len===127){ if(ws._buffer.length<10) break; const big=ws._buffer.readBigUInt64BE(2); if(big>BigInt(1e7)) throw new Error('frame-too-large'); len=Number(big); off=10; }
    const need=off+(masked?4:0)+len; if(ws._buffer.length<need) break;
    let mask; if(masked){mask=ws._buffer.subarray(off,off+4);off+=4;}
    const payload=Buffer.from(ws._buffer.subarray(off,off+len)); ws._buffer=ws._buffer.subarray(need);
    if(masked) for(let i=0;i<payload.length;i++) payload[i]^=mask[i%4];
    out.push({fin,opcode,payload});
  }
  return out;
}

server.on('upgrade',(req,socket)=>{
  const key=req.headers['sec-websocket-key'];
  if(!key){socket.destroy();return;}
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  socket.setNoDelay(true); socket._buffer=Buffer.alloc(0);
  const session={socket,userId:null,profile:{}};
  socket.on('data',chunk=>{
    let frames; try{frames=parseFrames(socket,chunk);}catch{closeSocket(socket);return;}
    for(const frame of frames){
      if(frame.opcode===0x8){closeSocket(socket);return;}
      if(frame.opcode===0x9){const body=frame.payload; const header=body.length<126?Buffer.from([0x8A,body.length]):Buffer.from([0x8A,126,(body.length>>8)&255,body.length&255]); try{socket.write(Buffer.concat([header,body]));}catch{} continue;}
      if(frame.opcode!==0x1 || !frame.fin) continue;
      let msg; try{msg=JSON.parse(frame.payload.toString('utf8'));}catch{continue;}
      const type=msg?.type;
      if(type==='register'){
        const userId=String(msg.userId||'').trim(); if(!userId){send(socket,{type:'call-error',message:'Conta sem ID de chamada.'});continue;}
        const prev=clients.get(userId); if(prev&&prev.socket!==socket) closeSocket(prev.socket);
        session.userId=userId; session.profile=msg.profile||{}; clients.set(userId,session); send(socket,{type:'registered',userId}); continue;
      }
      if(!session.userId){send(socket,{type:'call-error',message:'Conecte sua conta ao servidor primeiro.'});continue;}
      const deliverable=['call-request','call-answer','ice-candidate','call-reject','hangup'].includes(type);
      if(deliverable){
        const target=clients.get(String(msg.to||''));
        if(!target){ if(type==='call-request'||type==='call-answer'||type==='call-reject') send(socket,{type:'call-error',message:'A outra pessoa não está conectada ao Azurecord agora.'}); continue; }
        send(target.socket,{...msg,from:session.userId,fromName:session.profile?.name||msg.fromName||session.userId});
      }
    }
  });
  socket.on('close',()=>{if(session.userId&&clients.get(session.userId)?.socket===socket)clients.delete(session.userId);});
  socket.on('error',()=>{});
});

server.listen(PORT,'0.0.0.0',()=>console.log(`Azurecord V52 Beta 2 em http://localhost:${PORT}`));
