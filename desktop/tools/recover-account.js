#!/usr/bin/env node
'use strict';
// Recuperação LOCAL e conservadora. Nunca redefine senhas, cargos ou pontos.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const readline=require('node:readline/promises');
const {stdin,stdout}=require('node:process');

const args=process.argv.slice(2);
const has=(flag)=>args.includes(flag);
const value=(flag)=>{const i=args.indexOf(flag);return i>=0?args[i+1]||'':'';};
const emailKey=(text)=>String(text||'').trim().toLowerCase();
const appData=process.env.APPDATA || path.join(os.homedir(),'.config');
const folders=['azurecord-desktop','Azurecord','azurecord','Azurecord App','azurecord-app'];
const paths=folders.map(folder=>path.join(appData,folder,'backend','azurecord.json'));
const target=value('--target')?path.resolve(value('--target')):paths[0];
const variants=[p=>p,p=>p+'.bak',p=>p+'.bak.previous'];
const candidates=[...new Set([target,...paths].flatMap(p=>variants.map(fn=>fn(p))))];

function inspect(file){
  if(!fs.existsSync(file))return null;
  try{
    const content=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!content || !Array.isArray(content.users) || !Array.isArray(content.servers))throw Error('Formato de banco desconhecido');
    return {file,db:content};
  }catch(error){return {file,error:error.message};}
}
function containsUser(db,email){return db.users.find(u=>emailKey(u.email)===email);}
function safelyReplaceable(db){
  if(!db)return true;
  if(db.users.some(u=>!u.isDemo&&u.id!=='user-lola'))return false;
  // Só substituir instalações realmente vazias, não contas aparentemente demo
  // que já tenham sessões, memórias, convites ou participação em comunidades.
  const important=['messages','channelMessages','pointsLedger','pointsRedemptions','betaFeedback',
                   'friends','requests','sessions'];
  if(important.some(k=>Array.isArray(db[k])&&db[k].length>0))return false;
  if(db.servers.some(s=>s.id!=='server-azurecord'))return false;
  if((db.channels||[]).some(c=>c.serverId!=='server-azurecord'))return false;
  if((db.memberships||[]).some(m=>m.userId!=='user-lola'))return false;
  if(Object.keys(db.aiMemories||{}).length || Object.keys(db.lolaSessions||{}).length)return false;
  return true;
}
function backupFile(file,destination){
  if(fs.existsSync(file)){
    fs.copyFileSync(file,destination);
    try{fs.chmodSync(destination,0o600);}catch{}
  }
}
function restore(source,targetFile){
  const dir=path.dirname(targetFile);
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const archive=path.join(path.dirname(dir),'recovery-backups',stamp+'-'+process.pid);
  fs.mkdirSync(archive,{recursive:true,mode:0o700});
  for(const [file,label] of [[targetFile,'active.json'],[targetFile+'.bak','active.bak'],[targetFile+'.bak.previous','active.bak.previous'],[source,'source.json']])backupFile(file,path.join(archive,label));
  fs.mkdirSync(dir,{recursive:true});
  const tmp=targetFile+'.recovery-'+process.pid+'.tmp';
  try{
    fs.copyFileSync(source,tmp);
    try{fs.chmodSync(tmp,0o600);}catch{}
    JSON.parse(fs.readFileSync(tmp,'utf8'));
    try{fs.renameSync(tmp,targetFile);}catch(err){if(!['EEXIST','EPERM','EACCES'].includes(err.code))throw err;fs.copyFileSync(tmp,targetFile);fs.unlinkSync(tmp);}
  }catch(error){try{fs.rmSync(tmp,{force:true});}catch{}throw error;}
  return archive;
}
async function main(){
  if(has('--help')){
    console.log('Uso: node tools/recover-account.js [--email EMAIL] [--target ARQUIVO] [--restore]');
    console.log('Sem --restore, apenas inspeciona. Com --restore, pede confirmação. Feche o Azurecord antes de restaurar.');return;
  }
  const rl=readline.createInterface({input:stdin,output:stdout});
  try{
    const email=emailKey(value('--email')||await rl.question('Email da conta para procurar (a senha NÃO é necessária): '));
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Email inválido.');
    const found=candidates.map(inspect).filter(Boolean);
    const matching=found.filter(item=>item.db&&containsUser(item.db,email));
    console.log('\nBanco ativo:',target);
    for(const item of found){
      if(item.error)console.log('AVISO: banco ilegível:',item.file,'('+item.error+')');
      else console.log(containsUser(item.db,email)?'CONTA ENCONTRADA:':'Outro banco:',item.file);
    }
    const active=inspect(target);
    if(active?.db&&containsUser(active.db,email)){
      console.log('\nSua conta JÁ EXISTE no banco ativo. Não sobrescreva os dados.');
      console.log('Abra o Azurecord Beta 4 e entre com o mesmo email e senha. Se a versão antiga apontava para um backend remoto, configure a URL HTTPS original.');
      return;
    }
    if(matching.length===0){
      console.log('\nConta não encontrada nos bancos locais examinados. Isso NÃO significa que ela não exista num backend remoto ou num backup fora dessas pastas.');
      console.log('Verifique o mesmo servidor usado no cadastro ou procure backups antigos de azurecord.json.');
      return;
    }
    // Preferir a origem com mais dados do usuário, nunca um backend vazio mais recente.
    const score=db=>['messages','channelMessages','pointsLedger','pointsRedemptions','servers'].reduce((sum,k)=>sum+(db[k]?.length||0),0);
    matching.sort((a,b)=>score(b.db)-score(a.db));
    const source=matching[0];
    const user=containsUser(source.db,email);
    if(!user.password?.hash||!user.password?.salt){
      console.log('\nRegistro localizado, mas sem hash de autenticação reconhecido. Não é seguro substituir o banco automaticamente.');return;
    }
    console.log('\nBackup candidato:',source.file);
    console.log('ID preservado:',user.id,'| usuários cadastrados:',source.db.users.filter(u=>!u.isDemo).length);
    if(!has('--restore')){console.log('Nenhum arquivo foi alterado. Feche o aplicativo e repita com --restore para revisar a recuperação.');return;}
    if(!safelyReplaceable(active?.db)){
      console.log('RECUPERAÇÃO AUTOMÁTICA BLOQUEADA: o banco ativo já contém dados reais. Mesclar bancos exige revisão manual para evitar perda de DMs, cargos ou AzurePoints.');return;
    }
    if(active?.error){console.log('Banco principal danificado: será preservado num backup antes de substituição.');}
    const confirm=value('--confirm')||await rl.question('Feche o Azurecord. Para restaurar o backup completo, digite RESTAURAR: ');
    if(confirm!=='RESTAURAR'){console.log('Cancelado; banco ativo mantido.');return;}
    const archive=restore(source.file,target);
    const confirmed=inspect(target);
    if(!confirmed?.db||!containsUser(confirmed.db,email))throw Error('Falha na validação após cópia. Veja backup em '+archive);
    console.log('RECUPERAÇÃO CONCLUÍDA. Backup de segurança criado em:',archive);
    console.log('Reabra o Azurecord e faça login com o email e a senha ORIGINAIS. Nenhuma senha foi solicitada ou alterada.');
  }finally{rl.close();}
}
if(require.main===module)main().catch(err=>{console.error('Erro:',err.message);process.exitCode=1;});
module.exports={inspect,containsUser,safelyReplaceable,restore};
