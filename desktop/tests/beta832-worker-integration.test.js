
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=path.join(__dirname,'..');
const workerSource=fs.readFileSync(path.join(root,'cloud','worker-v0.8.1.js'),'utf8');
const appSource=fs.readFileSync(path.join(root,'renderer','app.js'),'utf8');
class Stmt{constructor(db,sql,args=[]){this.db=db;this.sql=sql;this.args=args;}bind(...args){return new Stmt(this.db,this.sql,args)}async run(){return this.db.prepare(this.sql).run(...this.args)}async first(){return this.db.prepare(this.sql).get(...this.args)||null}async all(){return {results:this.db.prepare(this.sql).all(...this.args)}}}
class DB{constructor(){this.db=new DatabaseSync(':memory:');this.db.exec('PRAGMA foreign_keys=ON;');}prepare(sql){return new Stmt(this.db,sql)}async batch(ss){this.db.exec('BEGIN');try{const o=[];for(const s of ss)o.push(await s.run());this.db.exec('COMMIT');return o}catch(e){this.db.exec('ROLLBACK');throw e}}}
function schema(d){d.db.exec(`
CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL,username_normalized TEXT NOT NULL UNIQUE,email TEXT NOT NULL,email_normalized TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,display_name TEXT,avatar_url TEXT,account_status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,last_used_at TEXT,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE friend_requests(id TEXT PRIMARY KEY,sender_id TEXT NOT NULL,receiver_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE friendships(id TEXT PRIMARY KEY,user_a TEXT NOT NULL,user_b TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(user_a) REFERENCES users(id) ON DELETE CASCADE,FOREIGN KEY(user_b) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE blocks(blocker_id TEXT NOT NULL,blocked_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(blocker_id,blocked_id));
CREATE TABLE dm_conversations(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE dm_members(conversation_id TEXT NOT NULL,user_id TEXT NOT NULL,joined_at TEXT NOT NULL,PRIMARY KEY(conversation_id,user_id),FOREIGN KEY(conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,sender_id TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,edited_at TEXT,deleted_at TEXT,FOREIGN KEY(conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE,FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE servers(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,name TEXT NOT NULL,icon_url TEXT,description TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE server_members(server_id TEXT NOT NULL,user_id TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'member',nickname TEXT,joined_at TEXT NOT NULL,PRIMARY KEY(server_id,user_id),FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE channels(id TEXT PRIMARY KEY,server_id TEXT NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL DEFAULT 'text',position INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE);
CREATE TABLE channel_messages(id TEXT PRIMARY KEY,channel_id TEXT NOT NULL,sender_id TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL,edited_at TEXT,deleted_at TEXT,FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE CASCADE,FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE server_invites(id TEXT PRIMARY KEY,server_id TEXT NOT NULL,created_by TEXT NOT NULL,code TEXT NOT NULL UNIQUE,max_uses INTEGER,uses INTEGER NOT NULL DEFAULT 0,expires_at TEXT,created_at TEXT NOT NULL,FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE,FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE azurepoints_wallets(user_id TEXT PRIMARY KEY,balance INTEGER NOT NULL DEFAULT 0,lifetime_earned INTEGER NOT NULL DEFAULT 0,lifetime_spent INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE azurepoints_transactions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,amount INTEGER NOT NULL,type TEXT NOT NULL,description TEXT,created_at TEXT NOT NULL);
CREATE TABLE azurepoints_redemptions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,points_amount INTEGER NOT NULL,requested_value_cents INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,reviewed_at TEXT);
CREATE TABLE lola_memories(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,memory TEXT NOT NULL,category TEXT,importance INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE lola_conversations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,title TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE lola_messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE beta_feedback(id TEXT PRIMARY KEY,user_id TEXT,category TEXT NOT NULL DEFAULT 'general',message TEXT NOT NULL,app_version TEXT,status TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL);
CREATE TABLE user_settings(user_id TEXT PRIMARY KEY,theme TEXT NOT NULL DEFAULT 'dark',language TEXT NOT NULL DEFAULT 'pt-BR',allow_friend_requests INTEGER NOT NULL DEFAULT 1,allow_dms_from_friends INTEGER NOT NULL DEFAULT 1,lola_enabled INTEGER NOT NULL DEFAULT 1,lola_memory_enabled INTEGER NOT NULL DEFAULT 1,notifications_enabled INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
CREATE TABLE user_presence(user_id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'offline',custom_status TEXT,last_seen_at TEXT,updated_at TEXT NOT NULL);
`)}
async function worker(){const b=Buffer.from(workerSource).toString('base64');return (await import(`data:text/javascript;base64,${b}`)).default}
async function call(w,env,method,p,body,token){const h={};if(body!==undefined)h['Content-Type']='application/json';if(token)h.Authorization=`Bearer ${token}`;const r=await w.fetch(new Request(`https://x.test${p}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),env);let d={};try{d=await r.json()}catch{}return {status:r.status,data:d}}

test('Beta8 renderer usa Social Cloud',()=>{assert.match(appSource,/socialCloudReady/);assert.match(appSource,/hydrateFromCloudSocial/);assert.match(appSource,/\/api\/social\/snapshot/);assert.match(appSource,/socialRequest/);});

test('Worker 0.8.1 anuncia busca e mensagens confiáveis',async()=>{const d=new DB();schema(d);const w=await worker();const r=await call(w,{DB:d},'GET','/health');assert.equal(r.status,200);assert.equal(r.data.version,'0.8.1');assert.equal(r.data.capabilities.socialCloud,true);assert.equal(r.data.capabilities.friendSearchV2,true);assert.equal(r.data.capabilities.reliableMessaging,true);});

test('duas contas viram amigas, trocam DM e compartilham servidor',async()=>{const d=new DB();schema(d);const w=await worker(),env={DB:d};
 const a=await call(w,env,'POST','/auth/register',{username:'Alice',email:'alice@test.dev',password:'SenhaAlice123!'});
 const b=await call(w,env,'POST','/auth/register',{username:'Bob',email:'bob@test.dev',password:'SenhaBob123!'});
 assert.equal(a.status,201);assert.equal(b.status,201);const ta=a.data.session.token,tb=b.data.session.token;
 const search=await call(w,env,'GET','/api/users?search=bob',undefined,ta);assert.equal(search.data.users[0].username,'Bob');
 const req=await call(w,env,'POST','/api/friends/requests',{toUserId:b.data.user.id},ta);assert.equal(req.status,201);
 const incoming=await call(w,env,'GET','/api/friends/requests',undefined,tb);assert.equal(incoming.data.requests.length,1);
 const acc=await call(w,env,'POST',`/api/friends/requests/${req.data.request.id}/accept`,{},tb);assert.equal(acc.status,200);
 const dm=await call(w,env,'POST',`/api/dms/${b.data.user.id}/messages`,{clientId:'m1',text:'oi bob'},ta);assert.equal(dm.status,201);
 const inbox=await call(w,env,'GET',`/api/dms/${a.data.user.id}`,undefined,tb);assert.equal(inbox.data.messages[0].text,'oi bob');
 const srv=await call(w,env,'POST','/api/servers',{name:'Sala Azul'},ta);assert.equal(srv.status,201);assert.ok(srv.data.server.invite);
 const join=await call(w,env,'POST','/api/servers/join',{code:srv.data.server.invite},tb);assert.equal(join.status,201);
 const ch=srv.data.channels.find(x=>x.type==='text');const msg=await call(w,env,'POST',`/api/servers/${srv.data.server.id}/channels/${ch.id}/messages`,{text:'salve geral'},tb);assert.equal(msg.status,201);
 const history=await call(w,env,'GET',`/api/servers/${srv.data.server.id}/channels/${ch.id}/messages?limit=100`,undefined,ta);assert.equal(history.data.messages[0].text,'salve geral');
});



test('busca encontra username mesmo com espaços/pontuação no texto público',async()=>{const d=new DB();schema(d);const w=await worker(),env={DB:d};
 const a=await call(w,env,'POST','/auth/register',{username:'TesterA',email:'testera@test.dev',password:'SenhaTeste123!'});
 const b=await call(w,env,'POST','/auth/register',{username:'hikare.netto',email:'hikare@test.dev',password:'SenhaTeste123!'});
 d.db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run('Hikare Netto',b.data.user.id);
 const search=await call(w,env,'GET','/api/users?search=hikarenetto',undefined,a.data.session.token);
 assert.equal(search.status,200);assert.equal(search.data.users.length,1);assert.equal(search.data.users[0].username,'hikare.netto');
});

test('Lola usa o binding Workers AI com a mesma sessao cloud',async()=>{
 const d=new DB();schema(d);const w=await worker();let called=null;
 const env={DB:d,AI:{run:async(model,payload)=>{called={model,payload};return {response:'Resposta da Lola no Workers AI. 💙',usage:{input_tokens:10,output_tokens:8}};}}};
 const a=await call(w,env,'POST','/auth/register',{username:'LolaTester',email:'lola@test.dev',password:'SenhaLola123!'});
 assert.equal(a.status,201);const token=a.data.session.token;
 const conv=await call(w,env,'GET','/api/ai/conversations',undefined,token);assert.equal(conv.status,200);assert.ok(conv.data.sessionId);
 const sent=await call(w,env,'POST','/api/dms/user-lola/messages',{clientId:'lola-msg-1',sessionId:conv.data.sessionId,text:'Oi Lola, funciona?'},token);
 assert.equal(sent.status,201);assert.equal(sent.data.message.senderId,a.data.user.id);
 const ai=await call(w,env,'POST','/api/ai/chat',{sessionId:conv.data.sessionId,userText:'Oi Lola, funciona?',memory:{}},token);
 assert.equal(ai.status,200);assert.equal(ai.data.provider,'cloudflare-workers-ai');assert.equal(ai.data.reply,'Resposta da Lola no Workers AI. 💙');
 assert.equal(called.model,'@cf/meta/llama-4-scout-17b-16e-instruct');assert.ok(Array.isArray(called.payload.messages));
 const hist=await call(w,env,'GET','/api/dms/user-lola',undefined,token);assert.equal(hist.status,200);assert.equal(hist.data.messages.length,2);assert.equal(hist.data.messages[1].senderId,'user-lola');
});
