'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=path.join(__dirname,'..');
const workerSource=fs.readFileSync(path.join(root,'cloud','worker-v0.8.js'),'utf8');
class Stmt{constructor(db,sql,args=[]){this.db=db;this.sql=sql;this.args=args;}bind(...args){return new Stmt(this.db,this.sql,args)}async run(){return this.db.prepare(this.sql).run(...this.args)}async first(){return this.db.prepare(this.sql).get(...this.args)||null}async all(){return {results:this.db.prepare(this.sql).all(...this.args)}}}
class DB{constructor(){this.db=new DatabaseSync(':memory:');this.db.exec('PRAGMA foreign_keys=ON;');}prepare(sql){return new Stmt(this.db,sql)}async batch(ss){this.db.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.run());this.db.exec('COMMIT');return out}catch(e){this.db.exec('ROLLBACK');throw e}}}
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
CREATE TABLE azurepoints_transactions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,amount INTEGER NOT NULL,type TEXT NOT NULL,description TEXT,created_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE azurepoints_redemptions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,points_amount INTEGER NOT NULL,requested_value_cents INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,reviewed_at TEXT,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE lola_memories(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,memory TEXT NOT NULL,category TEXT,importance INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE lola_conversations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,title TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE lola_messages(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE beta_feedback(id TEXT PRIMARY KEY,user_id TEXT,category TEXT NOT NULL DEFAULT 'general',message TEXT NOT NULL,app_version TEXT,status TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL);
CREATE TABLE user_settings(user_id TEXT PRIMARY KEY,theme TEXT NOT NULL DEFAULT 'dark',language TEXT NOT NULL DEFAULT 'pt-BR',allow_friend_requests INTEGER NOT NULL DEFAULT 1,allow_dms_from_friends INTEGER NOT NULL DEFAULT 1,lola_enabled INTEGER NOT NULL DEFAULT 1,lola_memory_enabled INTEGER NOT NULL DEFAULT 1,notifications_enabled INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
CREATE TABLE user_presence(user_id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'offline',custom_status TEXT,last_seen_at TEXT,updated_at TEXT NOT NULL);
`)}
async function worker(){return (await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`)).default}
async function call(w,env,method,p,body,token){const h={};if(body!==undefined)h['Content-Type']='application/json';if(token)h.Authorization=`Bearer ${token}`;const r=await w.fetch(new Request(`https://x.test${p}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),env);let d={};try{d=await r.json()}catch{}return {status:r.status,data:d}}

test('Worker 0.8 settings, sessões e perfil de servidor persistem', async()=>{
  const d=new DB();schema(d);const w=await worker();const env={DB:d};
  const health=await call(w,env,'GET','/health');
  assert.equal(health.data.version,'0.8.0');
  assert.equal(health.data.capabilities.settingsCloud,true);
  assert.equal(health.data.capabilities.serverSettingsCloud,true);
  const reg=await call(w,env,'POST','/auth/register',{username:'Owner83',email:'owner83@test.dev',password:'SenhaOwner831!'});
  assert.equal(reg.status,201);const token=reg.data.session.token;
  let settings=await call(w,env,'GET','/api/settings',undefined,token);
  assert.equal(settings.data.settings.compactMode,false);
  settings=await call(w,env,'PATCH','/api/settings',{compactMode:true,reducedMotion:true,allowFriendRequests:false},token);
  assert.equal(settings.data.settings.compactMode,true);assert.equal(settings.data.settings.reducedMotion,true);assert.equal(settings.data.settings.allowFriendRequests,false);
  const server=await call(w,env,'POST','/api/servers',{name:'Servidor 83',icon:'S'},token);
  assert.equal(server.status,201);const sid=server.data.server.id;
  const patched=await call(w,env,'PATCH',`/api/servers/${sid}`,{name:'Servidor Novo',description:'Descrição cloud',accent:'#ff33aa',features:['Design','Jogos']},token);
  assert.equal(patched.status,200);assert.equal(patched.data.server.name,'Servidor Novo');assert.equal(patched.data.server.accent,'#ff33aa');assert.deepEqual(patched.data.server.features,['Design','Jogos']);
  const inv=await call(w,env,'POST',`/api/servers/${sid}/invites`,{},token);assert.equal(inv.status,201);assert.ok(inv.data.invite.code);
  const invs=await call(w,env,'GET',`/api/servers/${sid}/invites`,undefined,token);assert.ok(invs.data.invites.length>=2);
  const secondLogin=await call(w,env,'POST','/auth/login',{login:'owner83@test.dev',password:'SenhaOwner831!'});assert.equal(secondLogin.status,200);
  const sessions=await call(w,env,'GET','/auth/sessions',undefined,token);assert.ok(sessions.data.sessions.length>=2);assert.equal(sessions.data.sessions.filter(x=>x.current).length,1);
  const revoke=await call(w,env,'POST','/auth/sessions/revoke-others',{},token);assert.ok(revoke.data.removed>=1);
});
