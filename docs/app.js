(() => {
  'use strict';

  const KEY = 'azurecord_app_v82_state';
  const THEME_KEY = 'azurecord_app_v8_theme';
  const SERVER_KEY = 'azurecord_app_servers_v1';
  const CLOUD_API_URL = String(window.AZURECORD_CONFIG?.apiBaseUrl || 'https://azurecord-api.giovannisilvaalves604.workers.dev').replace(/\/$/, '');
  const CLOUD_REALTIME_URL = String(window.AZURECORD_CONFIG?.realtimeBaseUrl || 'https://azurecord-realtime.giovannisilvaalves604.workers.dev').replace(/\/$/, '');
  const WEB_BASE_URL = String(window.AZURECORD_CONFIG?.webBaseUrl || 'https://feirune12.github.io/azurecord-web/').replace(/\/?$/, '/');

  const $ = (ref) => {
    if (typeof ref !== 'string') return null;
    const byId = document.getElementById(ref);
    if (byId) return byId;
    try { return document.querySelector(ref); } catch { return null; }
  };
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const now = () => Date.now();
  const uid = (prefix='id') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const safeUrl = (url) => {
    const value = String(url || '').trim();
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value) || /^blob:/i.test(value)) return value;
    try {
      const parsed = new URL(value, window.location.href);
      const cloudHost = new URL(CLOUD_API_URL).hostname;
      if (parsed.protocol === 'https:' && (
        parsed.hostname === 'gunvolt.com' ||
        parsed.hostname.endsWith('.gunvolt.com') ||
        parsed.hostname === cloudHost ||
        parsed.origin === window.location.origin
      )) return parsed.href;
    } catch {}
    return '';
  };

  function normalizeServerInvite(value){
    const raw=String(value||'').trim();
    if(!raw)return '';
    try{
      const url=new URL(raw,WEB_BASE_URL);
      const query=url.searchParams.get('invite')||url.searchParams.get('code');
      const pathMatch=url.pathname.match(/\/invite\/([^/?#]+)/i);
      const candidate=query||pathMatch?.[1];
      if(candidate)return String(candidate).trim().replace(/[^a-z0-9_-]/gi,'').toUpperCase();
    }catch{}
    return raw.replace(/^.*(?:invite=|code=)/i,'').replace(/[^a-z0-9_-]/gi,'').toUpperCase().slice(0,64);
  }
  function serverInviteLink(code){
    const clean=normalizeServerInvite(code);
    const url=new URL(WEB_BASE_URL,window.location.href);
    url.search='';url.hash='';
    url.searchParams.set('invite',clean);
    return url.toString();
  }
  let pendingInviteCode=normalizeServerInvite(new URL(window.location.href).searchParams.get('invite')||'');
  let inviteAutoJoinBusy=false;

  const LOLA_AVATAR_URL = 'https://gunvolt.com/en/X/system/img/system02_03Pic02.jpg';
  const LOLA_BANNER_URL = 'https://gunvolt.com/GRC/en/special/img/grc_wallpaper_00_1920x1080en.jpg';

  const DEMO_LOLA = {
    id:'user-lola', username:'Lola', email:'lola@azurecord.local', handle:'@lola',
    bio:'Designer, criativa e sempre pronta para conversar sobre arte, ideias e projetos.',
    accent:'#35b6ff', status:'online', avatar:LOLA_AVATAR_URL, banner:LOLA_BANNER_URL,
    personality:'Criativa, calorosa, curiosa e detalhista. Adora design, jogos e transformar ideias em coisas visuais.',
    memberSince:'27 de set. de 2026', role:'Membro', badge:'✦'
  };

  const DEMO_USERS = [DEMO_LOLA];

  const defaultState = {
    accounts: [], currentAccountId:null, rememberedAccountId:null,
    theme:'dark', accent:'#0066ff', notificationsEnabled:true, nativeNotifications:true,
    friends:[], requests:[], blockedUsers:[], ignoredUsers:[], servers:[],
    cloudSettings:{allowFriendRequests:true,allowDmsFromFriends:true,lolaEnabled:true,lolaMemoryEnabled:true,notificationsEnabled:true,nativeNotifications:true,compactMode:false,reducedMotion:false,mediaAutoplay:true,language:'pt-BR'},
    dmMessages:{}, channelMessages:{}, pinned:{}, deleted:{}, drafts:{}, attachments:[], closedDms:{},
    unread:{}, profiles:{}, roles:{}, lolaMemory:{}, lolaSecrets:{}, lolaInitiated:{}, lolaSessionInfo:{}, lolaGreetingHistory:{}, lastNotifications:[
      {id:uid('notif'),type:'system',title:'Bem-vindo ao Azurecord',body:'A V52 Beta 8.4 corrige solicitações de amizade, remove o servidor de testes e prepara o Web para GitHub Pages.',time:now(),unread:true}
    ]
  };

  let state = loadState();
  if(!state.closedDms||typeof state.closedDms!=='object')state.closedDms={};
  if(!Array.isArray(state.blockedUsers))state.blockedUsers=[];
  if(!Array.isArray(state.ignoredUsers))state.ignoredUsers=[];
  if(!state.cloudSettings||typeof state.cloudSettings!=='object')state.cloudSettings=structuredClone(defaultState.cloudSettings);
  else state.cloudSettings={...defaultState.cloudSettings,...state.cloudSettings};
  if(!state.lolaSecrets||typeof state.lolaSecrets!=='object')state.lolaSecrets={};
  if(!state.lolaInitiated||typeof state.lolaInitiated!=='object')state.lolaInitiated={};
  if(!state.lolaSessionInfo||typeof state.lolaSessionInfo!=='object')state.lolaSessionInfo={};
  if(!state.lolaGreetingHistory||typeof state.lolaGreetingHistory!=='object')state.lolaGreetingHistory={};
  let lolaChatEpoch=0;
  let lolaResetPromise=null;
  let authMode = 'login';
  let view = {mode:'home', home:'friends', homeTab:'all', serverId:null, channelId:null, dmUserId:null, showMembers:true, showProfile:false, contextMessageId:null, contextChannelId:null};
  let replyTo = null;
  let selectedProfile = null;
  let currentSearch = '';
  let ttsAvailable = false;
  let backendBaseUrl = null;
  let backendOrigin = null;
  let priorBackendOrigin = state.backendOrigin || null;
  let backendToken = state.backendToken || null;
  let verifiedBackendAccountId = null; // Somente em memória nesta execução, após /api/me ou login.
  let backendOnline = false;
  let cloudToken = null;
  let cloudVerifiedAccountId = null;
  let cloudOnline = false;
  let cloudInfo = {version:null, capabilities:{}};
  let cloudProfileSyncTimer = null;
  let cloudSocialPollTimer = null;
  let cloudRealtimeSyncBusy = false;
  let cloudSocialSnapshotAt = 0;
  let cloudSocialSnapshotSignature = '';
  let cloudRealtimeFailures = 0;
  let cloudRealtimeWakeRequested = false;
  let cloudRealtimeSocket = null;
  let cloudRealtimeSocketReady = false;
  let cloudRealtimeReconnectTimer = null;
  let cloudRealtimeHeartbeatTimer = null;
  let cloudRealtimeReconnectAttempt = 0;
  const cloudRealtimeSeenEvents = new Set();
  let cloudSearchEpoch = 0;
  let backendReadyPromise = Promise.resolve();
  let backendEventSource = null;
  let pendingAttachments = [];
  let pendingAttachmentReads = 0;
  const realtimePresence = new Map();
  const realtimeTyping = new Map();
  let typingLastSentAt = 0;
  let typingStopTimer = null;
  let dragDepth = 0;
  let activeCall = null;
  const AZURECALL_RTC_CONFIG = {iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]};

  async function cloudRequest(path, options = {}){
    const {auth=true, ...fetchOptions} = options;
    const headers = {'Content-Type':'application/json', ...(fetchOptions.headers||{})};
    if(auth && cloudToken) headers.Authorization = `Bearer ${cloudToken}`;
    const response = await fetch(`${CLOUD_API_URL}${path}`, {...fetchOptions, headers});
    let data = {};
    try { data = await response.json(); } catch {}
    if(!response.ok){
      const error = new Error(data.message || data.error || `HTTP ${response.status}`);
      error.status=response.status; error.code=data.error || 'http_error'; error.debug=data.debug || null;
      throw error;
    }
    return data;
  }

  async function cloudBinaryRequest(path,{method='PUT',body=null,headers={},auth=true,signal}={}){
    const finalHeaders={...headers};
    if(auth&&cloudToken)finalHeaders.Authorization=`Bearer ${cloudToken}`;
    const response=await fetch(`${CLOUD_API_URL}${path}`,{method,body,headers:finalHeaders,signal});
    let data={};
    try{data=await response.json();}catch{}
    if(!response.ok){
      const error=new Error(data.message||data.error||`HTTP ${response.status}`);
      error.status=response.status;error.code=data.error||'http_error';
      throw error;
    }
    return data;
  }

  function socialCloudReady(){
    // Social Cloud usa a sessão validada como fonte de verdade.
    // Assim a busca/pedidos não caem no backend local só porque /health ainda está carregando.
    return !!(cloudToken && cloudVerifiedAccountId && cloudVerifiedAccountId===state.currentAccountId);
  }
  function lolaCloudReady(){
    return !!(cloudOnline && cloudToken && cloudInfo?.capabilities?.lolaWorkersAI && cloudVerifiedAccountId && cloudVerifiedAccountId===state.currentAccountId);
  }
  function pointsCloudReady(){
    return !!(cloudOnline && cloudToken && cloudInfo?.capabilities?.azurePointsCloud && cloudVerifiedAccountId && cloudVerifiedAccountId===state.currentAccountId);
  }
  function userControlsCloudReady(){
    return !!(cloudOnline && cloudToken && cloudInfo?.capabilities?.userControls && cloudVerifiedAccountId && cloudVerifiedAccountId===state.currentAccountId);
  }
  function socialReady(){ return socialCloudReady(); }
  async function socialRequest(path, options={}){
    if(!socialCloudReady()){
      throw Object.assign(
        new Error('Entre na sua conta Cloud do Azurecord para usar recursos sociais.'),
        {status:401,code:'cloud_login_required'}
      );
    }
    return cloudRequest(path,options);
  }

  function cloudUserToProfile(u){
    if(!u?.id)return null;
    const username=String(u.username||u.displayName||'Usuário').trim()||'Usuário';
    const profileComplete=u.profileComplete===true ? true : (u.profileComplete===false ? false : null);
    return {
      id:u.id,
      email:String(u.email||'').trim().toLowerCase(),
      username,
      handle:`@${username.toLowerCase()}`,
      bio:String(u.bio??'Novo por aqui.'),
      accent:String(u.accent||'#0066ff'),
      status:String(u.status||'online'),
      avatar:String(u.avatar||u.avatarUrl||''),
      banner:String(u.banner||u.bannerUrl||''),
      personality:String(u.personality||'Usuário do Azurecord.'),
      memberSince:String(u.memberSince||new Date(u.createdAt||Date.now()).toLocaleDateString('pt-BR')),
      role:String(u.role||'Membro'),
      badge:String(u.badge||''),
      profileComplete,
      cloud:true,
      backend:false,
      accountType:'cloud',
      lastLogin:now()
    };
  }

  function localProfileLooksCustomized(profile,email=''){
    if(!profile)return false;
    if(profile.profileComplete===true)return true;
    const base=String(email||profile.email||'').split('@')[0].replace(/[^a-z0-9_.-]/gi,'').slice(0,24)||'usuario';
    return Boolean(
      (profile.username && usernameKey(profile.username)!==usernameKey(base)) ||
      (profile.bio && profile.bio!=='Novo por aqui.') ||
      (profile.accent && profile.accent!=='#0066ff') ||
      (profile.status && profile.status!=='online') ||
      profile.avatar || profile.banner ||
      (profile.personality && profile.personality!=='Usuário do Azurecord.')
    );
  }

  function cloudProfilePayload(profile, extra={}){
    const p=profile||{};
    return {
      username:String(p.username||'').trim().replace(/\s+/g,''),
      bio:String(p.bio||'').trim(),
      accent:String(p.accent||'#0066ff'),
      status:String(p.status||'online'),
      avatar:String(p.avatar||''),
      banner:String(p.banner||''),
      personality:String(p.personality||'Usuário do Azurecord.'),
      profileComplete: extra.profileComplete ?? p.profileComplete === true
    };
  }

  async function syncCloudProfile(profile,{quiet=false,profileComplete}={}){
    if(!profile?.cloud || !cloudOnline || !cloudToken || cloudVerifiedAccountId!==profile.id)return false;
    try{
      const data=await cloudRequest('/auth/profile',{
        method:'PATCH',
        body:JSON.stringify(cloudProfilePayload(profile,{profileComplete}))
      });
      if(data?.user){
        const merged=applyCloudUser(data.user);
        if(merged)merged._needsCloudProfileSync=false;
      }
      return true;
    }catch(err){
      if(!quiet){
        if(err.status===404)showToast('Seu Azurecord Cloud está desatualizado. Implante cloud/worker-v0.4.js.');
        else showToast(err.message||'Perfil salvo neste PC, mas a nuvem não respondeu.');
      }
      console.warn('[Azurecord] Falha ao sincronizar perfil cloud:',err?.message||err);
      return false;
    }
  }

  function scheduleCloudProfileSync(profile=currentUser(),delay=500){
    if(!profile?.cloud)return;
    clearTimeout(cloudProfileSyncTimer);
    cloudProfileSyncTimer=setTimeout(()=>syncCloudProfile(profile,{quiet:true}),delay);
  }

  function applyCloudUser(u){
    const profile=cloudUserToProfile(u); if(!profile)return null;
    let local=state.accounts.find(a=>a.id===profile.id) || state.accounts.find(a=>window.AzurecordAuthRecovery.emailKey(a.email)===window.AzurecordAuthRecovery.emailKey(profile.email));
    const hadLocal=!!local;
    if(!local){local={id:profile.id,email:profile.email};state.accounts.push(local);}
    const oldId=local.id;
    if(oldId&&oldId!==profile.id)migrateLocalConversationOwner(oldId,profile.id);

    const localSnapshot={
      username:local.username,handle:local.handle,bio:local.bio,accent:local.accent,status:local.status,
      avatar:local.avatar,banner:local.banner,personality:local.personality,profileComplete:local.profileComplete
    };
    const localWasCustomized=hadLocal&&localProfileLooksCustomized(localSnapshot,profile.email);

    Object.assign(local,profile);

    // Um Worker antigo ou um perfil cloud ainda não finalizado nunca deve apagar
    // um perfil já personalizado neste computador.
    if(profile.profileComplete!==true && localWasCustomized){
      for(const [key,value] of Object.entries(localSnapshot)){
        if(value!==undefined && value!==null && value!=='')local[key]=value;
      }
      local.profileComplete=true;
      local._needsCloudProfileSync=true;
    }else{
      local._needsCloudProfileSync=false;
    }

    delete local.passwordHash;
    state.profiles[profile.id]={...local};
    state.accounts=state.accounts.filter((a,i,arr)=>arr.findIndex(x=>x.id===a.id)===i);
    return local;
  }

  async function initCloudAuth(){
    try{
      const health=await cloudRequest('/health',{auth:false});
      cloudInfo={
        version:health?.version||null,
        capabilities:health?.capabilities&&typeof health.capabilities==='object'?health.capabilities:{}
      };
      cloudOnline=true;
      if(!cloudToken){
        try{cloudToken=await window.azurecordDesktop?.getSecureSession?.()||null;}catch{cloudToken=null;}
      }
      if(!cloudToken)return true;
      try{
        const me=await cloudRequest('/auth/me');
        const account=applyCloudUser(me.user);
        if(!account?.id)throw Object.assign(new Error('Sessão cloud inválida.'),{status:401});
        if(state.cloudAccountId && state.cloudAccountId!==account.id)throw Object.assign(new Error('Sessão pertence a outra conta.'),{status:401});
        cloudVerifiedAccountId=account.id;
        state.cloudAccountId=account.id;
        state.currentAccountId=account.id;
        save();
        if(account._needsCloudProfileSync)syncCloudProfile(account,{quiet:true,profileComplete:true}).catch(()=>{});
        if(cloudInfo?.capabilities?.socialCloud){hydrateFromCloudSocial({quiet:true}).then(()=>startCloudSocialPolling()).catch(()=>{});}
        if(cloudInfo?.capabilities?.settingsCloud){fetchCloudSettings({rerender:false}).catch(()=>{});}
      }catch(err){
        if(err.status===401){
          cloudToken=null;cloudVerifiedAccountId=null;state.cloudAccountId=null;
          try{await window.azurecordDesktop?.deleteSecureSession?.();}catch{}
          save();
        }else throw err;
      }
      return true;
    }catch(err){
      cloudOnline=false;
      cloudInfo={version:null,capabilities:{}};
      console.warn('[Azurecord] Cloud auth offline:',err?.message||err);
      return false;
    }
  }

  async function initBackend(){
    const getInfo = () => window.azurecordDesktop?.getBackendInfo?.();
    try {
      // The Electron window is intentionally opened before the local backend.
      // Poll briefly so a fast renderer load does not miss the backend startup.
      let info = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        info = await getInfo?.();
        backendBaseUrl = info?.baseUrl || null;
        backendOrigin = window.AzurecordAuthRecovery.originKey(info);
        if (backendBaseUrl) break;
        await new Promise(r => setTimeout(r, 250));
      }
      if (!backendBaseUrl) return false;
      await backendRequest('/api/health', {auth:false});
      backendOnline = true;
      // A porta do backend local muda a cada execução; um servidor remoto NÃO.
      // Uma mudança de origem nunca pode reutilizar o token de outro servidor.
      if (backendToken && state.backendOrigin && state.backendOrigin !== backendOrigin) {
        verifiedBackendAccountId=null;backendToken=null;state.backendToken=null;state.backendAccountId=null;save();
      }
      if (backendToken) {
        try {
          // Um token salvo só é confiável depois de /api/me validá-lo.
          if(socialCloudReady())await hydrateFromCloudSocial({quiet:true});else await hydrateFromBackend();
          state.backendOrigin=backendOrigin;
          save();
        }
        catch (err) { if(err.status===401){verifiedBackendAccountId=null;backendToken=null; state.backendToken=null; state.backendAccountId=null; save();} console.warn('[Azurecord] Falha na sincronização inicial:',err); }
      }
      return true;
    } catch (err) {
      backendOnline = false;
      console.warn('[Azurecord] Backend offline:', err);
      return false;
    }
  }

  async function backendRequest(path, options = {}){
    if (!backendBaseUrl) throw Object.assign(new Error('Backend indisponível.'), {code:'backend_offline'});
    const {auth=true, ...fetchOptions} = options;
    const headers = {'Content-Type':'application/json', ...(fetchOptions.headers||{})};
    if (auth && backendToken) headers.Authorization = `Bearer ${backendToken}`;
    const response = await fetch(`${backendBaseUrl}${path}`, {...fetchOptions, headers});
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(data.message || data.error || `HTTP ${response.status}`);
      error.status = response.status; error.code = data.error || 'http_error';
      throw error;
    }
    return data;
  }


  async function askLolaAi(userText, recentMessages, attachments=[], proactive=false){
    if(!cloudOnline || !cloudToken || cloudVerifiedAccountId!==state.currentAccountId){
      return {failed:true,code:'login_required'};
    }
    if(!cloudInfo?.capabilities?.lolaWorkersAI){
      return {failed:true,code:'AI_NOT_CONFIGURED'};
    }
    const controller = new AbortController();
    const timeout=setTimeout(()=>controller.abort(),90000);
    try{
      const recent=Array.isArray(recentMessages)?recentMessages.slice(-48).map(m=>({
        role:m?.author==='user-lola'?'assistant':'user',
        text:String(m?.text||'').slice(0,5000),
        images:(Array.isArray(m?.files)?m.files:[]).filter(f=>String(f?.type||'').startsWith('image/')&&(f?.dataUrl||f?.url)).slice(0,2).map(f=>({dataUrl:f.dataUrl||'',url:f.url||'',name:f.name,type:f.type}))
      })).filter(m=>m.text||m.images.length):[];
      const sessionId=state.lolaSessionInfo?.[state.currentAccountId]?.id||'legacy';
      const data=await cloudRequest('/api/ai/chat',{method:'POST',signal:controller.signal,body:JSON.stringify({
        proactive,sessionId,
        userText:String(userText||'').slice(0,7000),
        recent,
        attachments:(attachments||[]).slice(0,3).map(f=>({
          dataUrl:f?.dataUrl||'',url:f?.url||'',name:f?.name||'',type:f?.type||'',visual:f?.visual||null
        })),
        memory:memoryContext(getLolaMemory())
      })});
      return data?.reply?{text:String(data.reply).trim(),message:data.message||null,
        model:data.model||null,provider:data.provider||'cloudflare-workers-ai',sessionId:data.sessionId||sessionId,newChat:!!data.newChat}:null;
    }catch(err){
      if(err.code==='conversation_changed')return {discarded:true};
      console.warn('[Azurecord] Workers AI indisponível; modo local transparente:',err?.message||err);
      return {failed:true, code:err.code||'ai_error', reason:err.message||''};
    }finally{clearTimeout(timeout);}
  }

  function migrateLocalConversationOwner(oldId,newId){
    if(!oldId||!newId||oldId===newId)return;
    for(const [key,list] of Object.entries(state.dmMessages||{})){
      const users=key.split('|');if(!users.includes(oldId))continue;
      const remoteKey=users.map(id=>id===oldId?newId:id).sort().join('|');
      const updated=list.map(m=>({...m,author:m.author===oldId?newId:m.author,senderId:m.senderId===oldId?newId:m.senderId,
        recipientId:m.recipientId===oldId?newId:m.recipientId}));
      state.dmMessages[remoteKey]=[...(state.dmMessages[remoteKey]||[]),...updated]
        .filter((m,i,arr)=>arr.findIndex(x=>x.id===m.id)===i).sort((a,b)=>(a.time||0)-(b.time||0));
      delete state.dmMessages[key];
      if(state.closedDms?.[key]){state.closedDms[remoteKey]=true;delete state.closedDms[key];}
      if(state.unread?.[key]){state.unread[remoteKey]=state.unread[key];delete state.unread[key];}
    }
    for(const list of Object.values(state.channelMessages||{}))if(Array.isArray(list))for(const m of list)if(m.author===oldId)m.author=newId;
    // Preserva preferências e históricos pessoais na troca legítima de ID.
    for(const bucket of ['lolaMemory','lolaSecrets','lolaSessionInfo','lolaGreetingHistory','profiles']){
      if(state[bucket]?.[oldId]!==undefined && state[bucket]?.[newId]===undefined)state[bucket][newId]=state[bucket][oldId];
      if(state[bucket])delete state[bucket][oldId];
    }
    for(const srv of state.servers||[])if(srv.owner===oldId)srv.owner=newId;
    for(const request of state.requests||[]){if(request.from===oldId)request.from=newId;if(request.to===oldId)request.to=newId;}
    for(const friend of state.friends||[]){if(friend.a===oldId)friend.a=newId;if(friend.b===oldId)friend.b=newId;}
    if(state.currentAccountId===oldId)state.currentAccountId=newId;
    if(state.rememberedAccountId===oldId)state.rememberedAccountId=newId;
  }
  function applyBackendUser(u){
    if(!u) return null;
    // O mesmo email em dois servidores NÃO prova que as contas possuem o mesmo histórico.
    const sameOrigin=!priorBackendOrigin || priorBackendOrigin===backendOrigin;
    let local = state.accounts.find(a=>a.id===u.id) || (sameOrigin ? state.accounts.find(a=>window.AzurecordAuthRecovery.emailKey(a.email)===window.AzurecordAuthRecovery.emailKey(u.email)) : null);
    if(!local){ local={id:u.id,email:u.email}; state.accounts.push(local); }
    if(local.id&&local.id!==u.id)migrateLocalConversationOwner(local.id,u.id);
    Object.assign(local, {id:u.id,email:u.email,username:u.username,handle:u.handle,bio:u.bio,accent:u.accent,status:u.status,avatar:u.avatar,banner:u.banner,personality:u.personality,memberSince:u.memberSince,role:u.role,badge:u.badge,backend:true,backendOrigin,lastLogin:now()});
    // Backups antigos guardavam um hash FNV de senha no armazenamento da interface.
    // Agora credenciais são verificadas apenas pelo scrypt do backend.
    delete local.passwordHash;
    state.accounts=state.accounts.filter(a=>a===local || (a.id!==u.id && (!sameOrigin || window.AzurecordAuthRecovery.emailKey(a.email)!==window.AzurecordAuthRecovery.emailKey(u.email))));
    priorBackendOrigin=backendOrigin;
    state.profiles[u.id] = {...u};
    return local;
  }
  function hydrateRemoteUser(u){
    if(!u?.id) return;
    const normalized=(u.accountType==='cloud'||u.avatarUrl!==undefined||u.bannerUrl!==undefined)?cloudUserToProfile(u):u;
    const demo = DEMO_USERS.find(p => p.id === u.id);
    state.profiles[u.id] = demo ? {...demo, ...normalized, avatar: normalized.avatar || demo.avatar, banner: normalized.banner || demo.banner} : {...normalized};
  }
  function socialSnapshotSignature(data={}){
    const compact={
      friends:(data.friends||[]).map(x=>[x.id,x.status,x.updatedAt||'']),
      requests:(data.requests||[]).map(x=>[x.id,x.from,x.to,x.status,x.updatedAt||x.createdAt||'']),
      dms:(data.dms||[]).map(x=>[x.user?.id,x.lastMessage?.id,x.lastMessage?.createdAt||x.lastMessage?.time||'']),
      servers:(data.servers||[]).map(s=>[s.id,s.name,s.updatedAt||'',(s.channels||[]).map(c=>[c.id,c.name,c.type,c.updatedAt||''])]),
      blocked:(data.blockedUsers||[]).map(x=>x.id),
      ignored:(data.ignoredUsers||[]).map(x=>x.id)
    };
    return JSON.stringify(compact);
  }

  async function hydrateFromCloudSocial({quiet=false}={}){
    if(!socialCloudReady())return false;
    try{
      const data=await cloudRequest('/api/social/snapshot');
      const local=currentUser(); if(!local)return false;
      const signature=socialSnapshotSignature(data);
      if(quiet&&signature===cloudSocialSnapshotSignature){
        cloudSocialSnapshotAt=Date.now();
        return true;
      }
      cloudSocialSnapshotSignature=signature;
      const previousIncoming=new Set((state.requests||[]).filter(r=>r.to===local.id&&r.status==='pending').map(r=>r.id));
      state.friends=(data.friends||[]).map(p=>{hydrateRemoteUser(p);return {a:local.id,b:p.id,created:now()};});
      state.requests=(data.requests||[]).map(r=>{if(r.user)hydrateRemoteUser(r.user);return {id:r.id,from:r.from,to:r.to,status:r.status,time:new Date(r.createdAt||Date.now()).getTime()};});
      const freshIncoming=state.requests.filter(r=>r.to===local.id&&r.status==='pending'&&!previousIncoming.has(r.id));
      for(const req of freshIncoming){
        const p=getProfile(req.from);
        addNotification('Nova solicitação de amizade',`${p?.username||'Alguém'} quer adicionar você.`,'friend');
      }
      state.blockedUsers=(data.blockedUsers||[]).map(p=>{hydrateRemoteUser(p);return p.id;}).filter(Boolean);
      state.ignoredUsers=(data.ignoredUsers||[]).map(p=>{hydrateRemoteUser(p);return p.id;}).filter(Boolean);
      for(const item of (data.dms||[])){
        if(item.user)hydrateRemoteUser(item.user);
        const other=item.user?.id;if(other&&other!==local.id){
          const key=dmKey(other);state.dmMessages[key]=state.dmMessages[key]||[];
          const m=item.lastMessage;
          if(m&&!state.dmMessages[key].some(x=>(x.serverId||x.id)===(m.id||m.serverId))){
            state.dmMessages[key].push({...m,author:m.senderId,serverId:m.id,pending:false,failed:false});
            state.dmMessages[key].sort((a,b)=>(a.time||0)-(b.time||0));
            if(m.senderId===other && !isMessageSourceHidden(other) && !(view.mode==='dm'&&view.dmUserId===other))state.unread[key]=1;
          }
        }
      }
      if(Array.isArray(data.servers)){
        const remote=[];
        for(const srv of data.servers){
          const channels=(srv.channels||[]).map(c=>({id:c.id,backendId:c.id,serverId:srv.id,name:c.name,type:c.type,topic:c.topic||''}));
          remote.push({...srv,backendId:srv.id,channels});
        }
        state.servers=mergeServers([],remote).filter(s=>s?.id!=='server-azurecord');
      }
      save();renderDms();renderBadges();renderServerRail();if(view.mode==='home')renderHome();
      if(isMobileLayout()&&!$('mobileDmPanel')?.hidden)renderMobileDms();
      return true;
    }catch(err){if(!quiet)showToast(err.message||'Não foi possível atualizar os dados do Azurecord Cloud.');console.warn('[Azurecord] Social Cloud:',err);return false;}
  }
  function cloudRealtimeConnected(){
    return !!(cloudRealtimeSocket && cloudRealtimeSocket.readyState===WebSocket.OPEN && cloudRealtimeSocketReady);
  }

  function rememberRealtimeEvent(id){
    const key=String(id||'');
    if(!key)return false;
    if(cloudRealtimeSeenEvents.has(key))return true;
    cloudRealtimeSeenEvents.add(key);
    if(cloudRealtimeSeenEvents.size>120){
      const first=cloudRealtimeSeenEvents.values().next().value;
      cloudRealtimeSeenEvents.delete(first);
    }
    return false;
  }

  function stopCloudRealtimeSocket(){
    clearTimeout(cloudRealtimeReconnectTimer);cloudRealtimeReconnectTimer=null;
    clearInterval(cloudRealtimeHeartbeatTimer);cloudRealtimeHeartbeatTimer=null;
    cloudRealtimeSocketReady=false;
    const ws=cloudRealtimeSocket;cloudRealtimeSocket=null;
    if(ws){
      try{ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null;ws.close(1000,'Azurecord logout');}catch{}
    }
  }

  function scheduleCloudRealtimeReconnect(){
    clearTimeout(cloudRealtimeReconnectTimer);cloudRealtimeReconnectTimer=null;
    if(!socialCloudReady() || (typeof navigator!=='undefined'&&navigator.onLine===false))return;
    const attempt=Math.min(cloudRealtimeReconnectAttempt++,6);
    const wait=Math.min(30000,1000*Math.pow(1.8,attempt));
    cloudRealtimeReconnectTimer=setTimeout(()=>startCloudRealtimeSocket(true),wait);
  }

  function applyRealtimeDmMessage(peerId,remote){
    if(!peerId||!remote?.id)return;
    const key=dmKey(peerId),arr=state.dmMessages[key]||[];
    const idx=arr.findIndex(x=>x.serverId===remote.id||x.id===remote.id||(remote.clientId&&(x.id===remote.clientId||x.clientId===remote.clientId)));
    const normalized={...remote,author:remote.senderId,serverId:remote.id,pending:false,failed:false};
    if(idx>=0){const localId=arr[idx].id;arr[idx]={...arr[idx],...normalized,id:localId};}else arr.push(normalized);
    arr.sort((a,b)=>(a.time||0)-(b.time||0));state.dmMessages[key]=arr;
    state.unread[key]=(view.mode==='dm'&&view.dmUserId===peerId)?0:1;save();renderDms();
    if(view.mode==='dm'&&view.dmUserId===peerId)renderMessages();
  }
  function applyRealtimeChannelMessage(remoteServerId,remoteChannelId,remote){
    if(!remote?.id)return false;
    const srv=state.servers.find(s=>(s.backendId||s.id)===remoteServerId);
    const ch=srv?.channels?.find(c=>(c.backendId||c.id)===remoteChannelId);
    if(!srv||!ch)return false;
    if(remote.author)hydrateRemoteUser(remote.author);
    const key=`${srv.id}|${ch.id}`,arr=state.channelMessages[key]||[];
    const idx=arr.findIndex(x=>x.serverId===remote.id||x.id===remote.id||(remote.clientId&&(x.id===remote.clientId||x.clientId===remote.clientId)));
    const normalized={...remote,author:remote.senderId,serverId:remote.id,pending:false,failed:false};
    if(idx>=0){const localId=arr[idx].id;arr[idx]={...arr[idx],...normalized,id:localId};}else arr.push(normalized);
    arr.sort((a,b)=>(a.time||0)-(b.time||0));state.channelMessages[key]=arr;
    state.unread[key]=(view.mode==='server'&&view.serverId===srv.id&&view.channelId===ch.id)?0:1;save();
    if(view.mode==='server'&&view.serverId===srv.id&&view.channelId===ch.id)renderMessages();else renderServerRail();
    return true;
  }
  function effectiveOwnPresence(){
    const own=currentUser();
    const manual=String(own?.status||'online');
    if(manual==='offline'||manual==='dnd'||manual==='idle')return manual;
    return document.hidden?'idle':'online';
  }
  function resolvedPresence(userId){
    if(!userId)return 'offline';
    if(userId==='user-lola')return 'online';
    if(userId===state.currentAccountId)return effectiveOwnPresence();
    const item=realtimePresence.get(String(userId));
    if(item&&Date.now()-item.at<70000)return item.status;
    if(item)realtimePresence.delete(String(userId));
    return 'offline';
  }
  function publishPresence(){
    if(!cloudRealtimeConnected()||!state.currentAccountId)return false;
    return sendCloudRealtime({type:'presence.commit',status:effectiveOwnPresence()});
  }
  function typingConversationKey(scope,userId,serverId='',channelId=''){
    return scope==='dm' ? `dm|${String(userId||'')}` : `channel|${String(serverId||'')}|${String(channelId||'')}|${String(userId||'')}`;
  }
  function renderTypingIndicator(){
    const el=$('typingIndicator');if(!el)return;
    const stamp=Date.now();const names=[];
    for(const [key,item] of realtimeTyping){
      if(stamp-item.at>5000){realtimeTyping.delete(key);continue;}
      const inView=item.scope==='dm'
        ? view.mode==='dm'&&String(view.dmUserId)===String(item.userId)
        : view.mode==='server'&&String(view.serverId)===String(item.localServerId||item.serverId)&&String(view.channelId)===String(item.localChannelId||item.channelId);
      if(!inView)continue;
      names.push(getProfile(item.userId)?.username||'Alguém');
    }
    if(!names.length){el.hidden=true;el.textContent='';return;}
    el.hidden=false;
    el.textContent=names.length===1?`${names[0]} está digitando…`:`${names.slice(0,2).join(' e ')} estão digitando…`;
  }
  function publishTyping(active){
    if(!cloudRealtimeConnected()||!state.currentAccountId)return false;
    if(view.mode==='dm'&&view.dmUserId&&view.dmUserId!=='user-lola')return sendCloudRealtime({type:'typing',scope:'dm',targetUserId:view.dmUserId,active:!!active});
    if(view.mode==='server'&&view.serverId&&view.channelId){
      const srv=getServer(view.serverId),ch=getChannel(view.serverId,view.channelId);
      if(!srv||!ch)return false;
      return sendCloudRealtime({type:'typing',scope:'channel',serverId:srv.backendId||srv.id,channelId:ch.backendId||ch.id,active:!!active});
    }
    return false;
  }
  function handleTypingInput(){
    const input=$('messageInput');if(!input)return;
    autoResizeComposer();
    const active=!!input.value.trim(),stamp=Date.now();
    if(active&&stamp-typingLastSentAt>1200){publishTyping(true);typingLastSentAt=stamp;}
    clearTimeout(typingStopTimer);typingStopTimer=setTimeout(()=>publishTyping(false),2200);
    if(!active)publishTyping(false);
  }
  function stopTypingNow(){clearTimeout(typingStopTimer);typingStopTimer=null;typingLastSentAt=0;publishTyping(false);}
  function applyPresenceEvent(event){
    const userId=String(event.userId||'');if(!userId||userId===state.currentAccountId)return;
    const status=['online','idle','dnd','offline'].includes(event.status)?event.status:'offline';
    realtimePresence.set(userId,{status,at:Date.now()});
    if(view.mode==='home')renderHome();
    if(view.mode==='dm'&&view.dmUserId===userId)renderChat();
    if(view.mode==='server')renderMemberPanel();
  }
  function applyTypingEvent(event){
    const userId=String(event.userId||'');if(!userId||userId===state.currentAccountId)return;
    let localServerId='',localChannelId='';
    if(event.scope==='channel'){
      const srv=state.servers.find(x=>String(x.backendId||x.id)===String(event.serverId||''));
      const ch=srv?.channels?.find(x=>String(x.backendId||x.id)===String(event.channelId||''));
      localServerId=srv?.id||'';localChannelId=ch?.id||'';
    }
    const key=typingConversationKey(String(event.scope||''),userId,event.serverId,event.channelId);
    if(event.active===false)realtimeTyping.delete(key);
    else realtimeTyping.set(key,{scope:event.scope,userId,serverId:event.serverId||'',channelId:event.channelId||'',localServerId,localChannelId,at:Date.now()});
    renderTypingIndicator();
    if(event.active!==false)setTimeout(renderTypingIndicator,5200);
  }

  async function handleCloudRealtimeEvent(event){
    if(!event||rememberRealtimeEvent(event.eventId))return;
    if(event.type==='ready'){cloudRealtimeSocketReady=true;cloudRealtimeReconnectAttempt=0;cloudRealtimeFailures=0;publishPresence();wakeCloudRealtimeSync({snapshot:true});return;}
    if(event.type==='pong')return;
    if(event.type==='presence.changed'){applyPresenceEvent(event);return;}
    if(event.type==='typing'){applyTypingEvent(event);return;}
    if(event.type==='call.signal'){await handleCallSignalEvent(event);return;}
    if(event.type==='dm.upsert'){const peerId=String(event.peerId||'');if(peerId&&event.message){applyRealtimeDmMessage(peerId,event.message);return;}}
    if(event.type==='dm.changed'){const peerId=String(event.peerId||'');if(!peerId||peerId==='user-lola')return;await syncDmFromBackend(peerId);return;}
    if(event.type==='channel.upsert'){const ok=applyRealtimeChannelMessage(String(event.serverId||''),String(event.channelId||''),event.message);if(!ok)await hydrateFromCloudSocial({quiet:true});return;}
    if(event.type==='channel.changed'){
      const remoteServerId=String(event.serverId||''),remoteChannelId=String(event.channelId||'');
      const srv=state.servers.find(s=>(s.backendId||s.id)===remoteServerId),ch=srv?.channels?.find(x=>(x.backendId||x.id)===remoteChannelId);
      if(!srv||!ch){await hydrateFromCloudSocial({quiet:true});return;}
      if(view.mode==='server'&&view.serverId===srv.id&&view.channelId===ch.id)await syncChannelMessages(srv.id,ch.id);
      else{state.unread[`${srv.id}|${ch.id}`]=1;save();renderServerRail();}
      return;
    }
    if(event.type==='account.changed'||event.type==='social.changed'){await hydrateFromCloudSocial({quiet:true});if(view.mode==='server')renderShell();return;}
    if(event.type==='server.changed'){
      const remoteServerId=String(event.serverId||'');await hydrateFromCloudSocial({quiet:true});
      const srv=state.servers.find(s=>(s.backendId||s.id)===remoteServerId);
      if(srv&&view.mode==='server'&&view.serverId===srv.id)renderShell();
    }
  }

  function startCloudRealtimeSocket(force=false){
    if(!socialCloudReady()||!cloudToken)return;
    if(typeof WebSocket==='undefined')return;
    if(typeof navigator!=='undefined'&&navigator.onLine===false)return;
    if(!force && cloudRealtimeSocket && (cloudRealtimeSocket.readyState===WebSocket.OPEN||cloudRealtimeSocket.readyState===WebSocket.CONNECTING))return;

    clearTimeout(cloudRealtimeReconnectTimer);cloudRealtimeReconnectTimer=null;
    clearInterval(cloudRealtimeHeartbeatTimer);cloudRealtimeHeartbeatTimer=null;
    if(cloudRealtimeSocket){
      try{cloudRealtimeSocket.onopen=cloudRealtimeSocket.onmessage=cloudRealtimeSocket.onerror=cloudRealtimeSocket.onclose=null;cloudRealtimeSocket.close();}catch{}
    }

    const wsUrl=CLOUD_REALTIME_URL.replace(/^http:/i,'ws:').replace(/^https:/i,'wss:')+'/ws';
    let ws;
    try{
      ws=new WebSocket(wsUrl,['azurecord-v1',cloudToken]);
    }catch(err){
      console.warn('[Azurecord] WebSocket não pôde iniciar:',err?.message||err);
      scheduleCloudRealtimeReconnect();
      return;
    }

    cloudRealtimeSocket=ws;
    cloudRealtimeSocketReady=false;

    ws.onopen=()=>{
      cloudRealtimeReconnectAttempt=0;
      clearInterval(cloudRealtimeHeartbeatTimer);
      cloudRealtimeHeartbeatTimer=setInterval(()=>{
        if(ws.readyState===WebSocket.OPEN){
          try{ws.send(JSON.stringify({type:'ping',at:Date.now()}));publishPresence();}catch{}
        }
      },25000);
    };

    ws.onmessage=(ev)=>{
      let event=null;
      try{event=JSON.parse(String(ev.data||''));}catch{return;}
      handleCloudRealtimeEvent(event).catch(err=>console.warn('[Azurecord] Realtime event:',err?.message||err));
    };

    ws.onerror=()=>{cloudRealtimeSocketReady=false;};

    ws.onclose=()=>{
      if(cloudRealtimeSocket===ws)cloudRealtimeSocket=null;
      cloudRealtimeSocketReady=false;
      clearInterval(cloudRealtimeHeartbeatTimer);cloudRealtimeHeartbeatTimer=null;
      scheduleCloudRealtimeReconnect();
      wakeCloudRealtimeSync();
    };
  }

  function sendCloudRealtime(event){
    if(!cloudRealtimeConnected())return false;
    try{
      cloudRealtimeSocket.send(JSON.stringify(event));
      return true;
    }catch{
      return false;
    }
  }

  function cloudRealtimeDelay(){
    if(typeof navigator!=='undefined' && navigator.onLine===false)return 8000;
    const connected=cloudRealtimeConnected();
    if(document.hidden)return connected?90000:12000;
    const activeConversation=(view.mode==='dm'&&view.dmUserId&&view.dmUserId!=='user-lola')||
      (view.mode==='server'&&view.serverId&&view.channelId);
    const base=connected
      ? (activeConversation?30000:60000)
      : (activeConversation?900:2500);
    if(!cloudRealtimeFailures)return base;
    return Math.min(15000,base*Math.pow(1.7,Math.min(cloudRealtimeFailures,5)));
  }

  function scheduleCloudRealtimeSync(delay=null){
    clearTimeout(cloudSocialPollTimer);cloudSocialPollTimer=null;
    if(!socialCloudReady())return;
    const wait=delay==null?cloudRealtimeDelay():Math.max(0,Number(delay)||0);
    cloudSocialPollTimer=setTimeout(()=>runCloudRealtimeSync().catch(()=>{}),wait);
  }

  function wakeCloudRealtimeSync({snapshot=false}={}){
    if(snapshot)cloudSocialSnapshotAt=0;
    cloudRealtimeWakeRequested=true;
    if(!cloudRealtimeSyncBusy)scheduleCloudRealtimeSync(0);
  }

  async function runCloudRealtimeSync(){
    if(!socialCloudReady())return;
    if(typeof navigator!=='undefined' && navigator.onLine===false){
      cloudRealtimeFailures=Math.max(1,cloudRealtimeFailures);
      scheduleCloudRealtimeSync();
      return;
    }
    if(cloudRealtimeSyncBusy){
      cloudRealtimeWakeRequested=true;
      return;
    }
    cloudRealtimeSyncBusy=true;
    cloudRealtimeWakeRequested=false;
    let ok=true;
    try{
      const stamp=Date.now();
      // O snapshot social mantém amigos, DMs recentes, servidores e badges em sincronia,
      // mas não precisa rodar na mesma velocidade da conversa aberta.
      if(stamp-cloudSocialSnapshotAt>=(cloudRealtimeConnected()?60000:5000)){
        const snapshotOk=await hydrateFromCloudSocial({quiet:true});
        if(snapshotOk)cloudSocialSnapshotAt=Date.now();
        else ok=false;
      }

      if(view.mode==='dm'&&view.dmUserId&&view.dmUserId!=='user-lola'){
        const dmOk=await syncDmFromBackend(view.dmUserId);
        if(dmOk===false)ok=false;
      }else if(view.mode==='server'&&view.serverId&&view.channelId){
        const channelOk=await syncChannelMessages(view.serverId,view.channelId);
        if(channelOk===false)ok=false;
      }

      if(ok){
        cloudRealtimeFailures=0;
        cloudOnline=true;
      }else{
        cloudRealtimeFailures=Math.min(cloudRealtimeFailures+1,6);
      }
    }catch(err){
      cloudRealtimeFailures=Math.min(cloudRealtimeFailures+1,6);
      console.warn('[Azurecord] Realtime Sync:',err?.message||err);
    }finally{
      cloudRealtimeSyncBusy=false;
      if(cloudRealtimeWakeRequested)scheduleCloudRealtimeSync(0);
      else scheduleCloudRealtimeSync();
    }
  }

  function startCloudSocialPolling(){
    clearTimeout(cloudSocialPollTimer);cloudSocialPollTimer=null;
    if(!socialCloudReady())return;
    cloudRealtimeFailures=0;
    cloudSocialSnapshotAt=0;
    startCloudRealtimeSocket();
    wakeCloudRealtimeSync({snapshot:true});
  }

  async function hydrateFromBackend(){
    if(!backendToken) return;
    const me = await backendRequest('/api/me');
    if (!me?.user?.id || (state.backendAccountId && me.user.id !== state.backendAccountId)) {
      throw Object.assign(new Error('A sessão pertence a outra conta. Entre novamente.'),{status:401,code:'session_mismatch'});
    }
    verifiedBackendAccountId=me.user.id;
    state.backendOrigin=backendOrigin;
    const local=applyBackendUser(me.user);
    state.currentAccountId=local.id;
    const friends=await socialRequest('/api/friends');
    state.friends=(friends.friends||[]).map(p=>{hydrateRemoteUser(p);return {a:local.id,b:p.id,created:now()};});
    const requests=await socialRequest('/api/friends/requests');
    state.requests=(requests.requests||[]).map(r=>{hydrateRemoteUser(r.user);return {id:r.id,from:r.from,to:r.to,status:r.status,time:new Date(r.createdAt||Date.now()).getTime()};});
    if(isLolaSecretUnlocked())ensureLolaSecretRequest();
    const dms=await socialRequest('/api/dms');
    for(const item of (dms.dms||[])){
      hydrateRemoteUser(item.user);
      const other=item.user?.id; if(other && other!==local.id){const key=[local.id,other].sort().join('|');if(!state.dmMessages[key])state.dmMessages[key]=[];}
    }

    // O backend agora entrega os canais junto com cada servidor. Assim a rail e
    // o painel de canais usam a mesma fonte de verdade e não dependem de várias
    // requisições encadeadas que podem deixar a UI momentaneamente vazia.
    const servers=await socialRequest('/api/servers');
    if(Array.isArray(servers.servers)){
      for(const srv of servers.servers){
        const normalizedChannels=Array.isArray(srv.channels)?srv.channels.map(c=>({
          id:c.id, backendId:c.id, serverId:srv.id, name:c.name, type:c.type, topic:c.topic||''
        })):[];
        // Servidores criados nesta instalação mantêm o ID local para que a UI
        // nunca perca a seleção enquanto o backend sincroniza.
        const existing=state.servers.find(x=>x.id===srv.id || x.backendId===srv.id);
        if(existing){
          existing.backendId=srv.id;
          existing.name=srv.name||existing.name;
          existing.description=srv.description||existing.description||'Comunidade do Azurecord.';
          existing.owner=srv.owner||existing.owner||state.currentAccountId;
          existing.myRole=srv.myRole||existing.myRole||((srv.owner||existing.owner)===state.currentAccountId?'Admin':'Membro');
          existing.invite=srv.invite||existing.invite;
          existing.icon=srv.icon||existing.icon||existing.name?.[0]||'S';
          existing.iconUrl=srv.iconUrl||existing.iconUrl||'';
          existing.channels=normalizedChannels.length ? normalizedChannels.map(c=>({...c,serverId:existing.id})) : (existing.channels||[]);
        }else{
          state.servers.push({...srv,backendId:srv.id,channels:normalizedChannels.map(c=>({...c,serverId:srv.id}))});
        }
      }
      state.servers.forEach(ensureServerChannels);
    }
    state.servers.forEach(ensureServerChannels);
    save();
    renderShell();
    renderDms();
    flushPendingDms().catch(err=>console.warn('[Azurecord] Reenvio de DMs:',err));
    requestAnimationFrame(()=>renderServerRail());
  }
  function startBackendEvents(){
    if(!backendBaseUrl||!backendToken||backendEventSource)return;
    try{
      backendEventSource=new EventSource(`${backendBaseUrl}/api/stream?token=${encodeURIComponent(backendToken)}`);
      backendEventSource.addEventListener('friend.request',ev=>{try{const p=JSON.parse(ev.data),r=p.request;if(!r)return;hydrateRemoteUser(r.user);if(!state.requests.some(x=>x.id===r.id))state.requests.push({id:r.id,from:r.from,to:r.to,status:'pending',time:Date.now()});save();renderBadges();if(view.mode==='home')renderHome();addNotification('Nova solicitação',`${r.user?.username||'Alguém'} quer ser seu amigo.`);}catch{}});
      backendEventSource.addEventListener('friend.accepted',ev=>{try{const p=JSON.parse(ev.data);if(p.user){hydrateRemoteUser(p.user);if(!isFriend(p.user.id))state.friends.push({a:state.currentAccountId,b:p.user.id,created:now()});save();renderHome();}}catch{}});
      backendEventSource.addEventListener('server.created',ev=>{try{const p=JSON.parse(ev.data);if(!p.server)return;const srv={...p.server,channels:(p.channels||[]).map(c=>({...c,serverId:p.server.id}))};ensureServerChannels(srv);const i=state.servers.findIndex(x=>x.id===srv.id||x.backendId===srv.id||(srv.clientId&&x.id===srv.clientId));if(i>=0){const local=state.servers[i];state.servers[i]=Object.assign(local,srv,{id:local.id,backendId:srv.id,myRole:srv.myRole||local.myRole});}else state.servers.push(srv);save();persistServersNow();renderServerRail();renderServerChannels();}catch{}});
      backendEventSource.addEventListener('channel.message',ev=>{try{const m=JSON.parse(ev.data)?.message;if(!m)return;const server=state.servers.find(s=>(s.backendId||s.id)===m.serverId);if(!server)return;const ch=server.channels.find(c=>(c.backendId||c.id)===m.channelId);if(!ch)return;const key=`${server.id}|${ch.id}`;const arr=state.channelMessages[key]||[];if(!arr.some(x=>x.serverId===m.id||x.id===m.id)){if(m.author)hydrateRemoteUser(m.author);arr.push({...m,author:m.senderId,serverId:m.id});state.channelMessages[key]=arr;save();if(view.mode==='server'&&view.serverId===server.id&&view.channelId===ch.id)renderMessages();else{state.unread[key]=1;renderServerRail();}}}catch(err){console.warn(err);}});
      backendEventSource.addEventListener('server.member_joined',()=>{if(view.mode==='server')renderMemberPanel();});
      backendEventSource.addEventListener('ai.conversation_reset',ev=>{try{
        const data=JSON.parse(ev.data);if(!data.sessionId||!state.currentAccountId)return;
        const old=state.lolaSessionInfo?.[state.currentAccountId];
        if(old?.id===data.sessionId)return;
        if(old?.pendingReset){state.lolaSessionInfo[state.currentAccountId]={id:data.sessionId,pendingReset:false};save();return;}
        lolaChatEpoch++;
        state.lolaSessionInfo[state.currentAccountId]={id:data.sessionId,pendingReset:false};
        const key=dmKey('user-lola');state.dmMessages[key]=[];
        resetLolaRecentContext();save();renderDms();
        if(view.mode==='dm'&&view.dmUserId==='user-lola')queueLolaInitiation(false);
      }catch(err){console.warn('[Azurecord] SSE reset:',err);}});
      backendEventSource.addEventListener('points.updated',()=>{if(!$('modalLayer')?.hidden && $('pointsWalletBalance'))openAzurePoints();});
      backendEventSource.addEventListener('dm.message',ev=>{try{const p=JSON.parse(ev.data),m=p.message;if(!m)return;const other=m.senderId===state.currentAccountId?m.recipientId:m.senderId;if(other==='user-lola' && (m.lolaSessionId||'legacy')!==(state.lolaSessionInfo?.[state.currentAccountId]?.id||'legacy'))return;const key=dmKey(other);const arr=state.dmMessages[key]||[];if(p.user)hydrateRemoteUser(p.user);if(!arr.some(x=>x.serverId===m.id||x.id===m.id||m.clientId&&x.id===m.clientId)){arr.push({...m,author:m.senderId,serverId:m.id});arr.sort((a,b)=>(a.time||0)-(b.time||0));state.dmMessages[key]=arr;state.unread[key]=(view.mode==='dm'&&view.dmUserId===other)?0:1;save();renderDms();if(view.mode==='dm'&&view.dmUserId===other)renderMessages();addNotification('Nova mensagem',`${getProfile(other)?.username||'Alguém'} enviou uma mensagem.`);}}catch{}});
    }catch{}
  }

  function loadPersistentServers(){
    try{
      const raw=localStorage.getItem(SERVER_KEY);
      const parsed=raw?JSON.parse(raw):[];
      return Array.isArray(parsed)?parsed.filter(s=>s&&s.id).map(ensureServerChannels):[];
    }catch(e){ console.warn('[Azurecord] Falha ao ler servidores persistentes:',e); return []; }
  }
  function persistServersNow(){
    try{
      const snapshot=(Array.isArray(state.servers)?state.servers:[]).filter(s=>s&&s.id).map(s=>ensureServerChannels(s));
      localStorage.setItem(SERVER_KEY,JSON.stringify(snapshot));
    }catch(e){ console.warn('[Azurecord] Falha ao salvar servidores persistentes:',e); }
  }
  function mergeServers(base, incoming){
    const out=Array.isArray(base)?base.slice():[];
    for(const raw of (Array.isArray(incoming)?incoming:[])){
      if(!raw?.id) continue;
      const existing=out.find(s=>s.id===raw.id || (raw.backendId && s.backendId===raw.backendId));
      if(existing){
        const oldChannels=Array.isArray(existing.channels)?existing.channels:[];
        const newChannels=Array.isArray(raw.channels)?raw.channels:[];
        Object.assign(existing,raw);
        existing.channels=newChannels.length?newChannels:oldChannels;
        ensureServerChannels(existing);
      }else{
        const cloned=ensureServerChannels(structuredClone(raw)); if(cloned.owner===state.currentAccountId)cloned.myRole='Admin'; out.push(cloned);
      }
    }
    return out;
  }

  function loadState(){
    let merged=structuredClone(defaultState);
    try {
      const raw=localStorage.getItem(KEY);
      if(raw){
        const saved=JSON.parse(raw);
        merged=Object.assign(merged, saved);
      }
    } catch(e) { console.warn('[Azurecord] Estado local inválido, usando base segura.', e); }
    const persistentServers=loadPersistentServers();
    merged.servers=mergeServers(Array.isArray(merged.servers)?merged.servers:[], persistentServers);
    // Beta 8.4: remove o antigo servidor de demonstração de instalações anteriores.
    merged.servers=merged.servers.filter(s=>s && s.id && s.id!=='server-azurecord').map(s=>ensureServerChannels(s));
    return merged;
  }
  let saveTimer = null;
  let savePending = false;
  function saveNow(){
    if(saveTimer){ clearTimeout(saveTimer); saveTimer=null; }
    try{ localStorage.setItem(KEY, JSON.stringify(state)); persistServersNow(); savePending=false; }
    catch(err){ console.warn('[Azurecord] Falha ao salvar estado local:',err); }
  }
  function save(){
    savePending=true;
    if(saveTimer) return;
    saveTimer=setTimeout(()=>saveNow(),120);
  }
  window.addEventListener('beforeunload',saveNow,{capture:true});
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden' && savePending) saveNow(); });
  function currentUser(){ return state.accounts.find(a => a.id===state.currentAccountId) || null; }
  function getProfile(id){
    const demo = DEMO_USERS.find(a=>a.id===id);
    const stored = state.profiles[id] || state.accounts.find(a=>a.id===id) || null;
    if (demo && stored) return {...demo, ...stored, avatar: stored.avatar || demo.avatar, banner: stored.banner || demo.banner};
    return stored || demo || null;
  }
  function allPeople(){ const people=[...DEMO_USERS,...state.accounts.filter(a=>!DEMO_USERS.some(d=>d.id===a.id)),...Object.values(state.profiles||{})]; return people.filter((p,i,self)=>p&&self.findIndex(x=>x?.id===p.id)===i); }
  function usernameKey(name){ return String(name||'').trim().toLowerCase().replace(/^@/,''); }
  function friendIds(){ return state.friends.filter(f=>f.a===state.currentAccountId || f.b===state.currentAccountId).map(f=>f.a===state.currentAccountId?f.b:f.a); }
  function findFriend(id){ return state.friends.find(f=>(f.a===state.currentAccountId&&f.b===id)||(f.a===id&&f.b===state.currentAccountId)); }
  function isFriend(id){ return !!findFriend(id); }
  function isBlocked(id){ return Array.isArray(state.blockedUsers) && state.blockedUsers.includes(id); }
  function isIgnored(id){ return Array.isArray(state.ignoredUsers) && state.ignoredUsers.includes(id); }
  function isMessageSourceHidden(id){ return !!id && id!==state.currentAccountId && (isBlocked(id)||isIgnored(id)); }
  function visibleMessagesForCurrentView(){
    const all=getMessages();
    return all.filter(m=>!isMessageSourceHidden(m.author||m.senderId));
  }
  function addNotification(title,body,type='general'){ state.lastNotifications.unshift({id:uid('notif'),title,body,type,time:now(),unread:true}); state.lastNotifications=state.lastNotifications.slice(0,40); save(); renderBadges(); if(state.notificationsEnabled && state.nativeNotifications && window.azurecordDesktop?.notify) window.azurecordDesktop.notify(title,body); }
  function showToast(text){ const t=$('toast'); t.textContent=text; t.classList.add('show'); clearTimeout(t._tm); t._tm=setTimeout(()=>t.classList.remove('show'),2500); }
  function logout(){
    try{ if(backendEventSource){backendEventSource.close(); backendEventSource=null;} }catch{}
    if(activeCall)endActiveCall({notify:true});
    if(cloudRealtimeConnected())sendCloudRealtime({type:'presence.commit',status:'offline'});
    stopCloudRealtimeSocket();
    realtimePresence.clear();realtimeTyping.clear();renderTypingIndicator();
    clearTimeout(cloudSocialPollTimer);cloudSocialPollTimer=null;
    if(cloudToken)cloudRequest('/auth/logout',{method:'POST'}).catch(()=>{});
    state.accounts=state.accounts.map(a=>a.id===state.currentAccountId?{...a,status:'offline',lastLogin:a.lastLogin||now()}:a);
    state.currentAccountId=null;
    state.backendToken=null; state.backendAccountId=null;
    backendToken=null;verifiedBackendAccountId=null;
    cloudToken=null;cloudVerifiedAccountId=null;state.cloudAccountId=null;try{window.azurecordDesktop?.deleteSecureSession?.();}catch{}
    state.rememberedAccountId=null;
    save();
    closeModal();
    setScreen('loginScreen');
    renderSavedAccounts();
    showToast('Você saiu do Azurecord.');
  }

  function purgeDeletedAccountLocal(userId){
    if(!userId)return;
    const ownedServers=new Set((state.servers||[]).filter(s=>s.owner===userId).map(s=>s.id));
    state.accounts=(state.accounts||[]).filter(a=>a.id!==userId);
    if(state.profiles)delete state.profiles[userId];
    for(const bucket of ['lolaMemory','lolaSecrets','lolaInitiated','lolaSessionInfo','lolaGreetingHistory'])if(state[bucket])delete state[bucket][userId];
    state.friends=(state.friends||[]).filter(f=>f.a!==userId&&f.b!==userId);
    state.requests=(state.requests||[]).filter(r=>r.from!==userId&&r.to!==userId);
    for(const key of Object.keys(state.dmMessages||{}))if(key.split('|').includes(userId))delete state.dmMessages[key];
    for(const [key,list] of Object.entries(state.channelMessages||{})){
      if(!Array.isArray(list))continue;
      const serverId=key.split('|')[0];
      if(ownedServers.has(serverId))delete state.channelMessages[key];
      else state.channelMessages[key]=list.filter(m=>m.author!==userId&&m.senderId!==userId);
    }
    for(const bucket of ['unread','closedDms','drafts','pinned','deleted']){
      if(!state[bucket]||typeof state[bucket]!=='object')continue;
      for(const key of Object.keys(state[bucket]))if(key.split('|').includes(userId))delete state[bucket][key];
    }
    state.servers=(state.servers||[]).filter(s=>!ownedServers.has(s.id));
    state.currentAccountId=null;state.rememberedAccountId=null;state.backendToken=null;state.backendAccountId=null;state.cloudAccountId=null;
    backendToken=null;verifiedBackendAccountId=null;cloudToken=null;cloudVerifiedAccountId=null;
    cloudInfo={version:null,capabilities:{}};
    stopCloudRealtimeSocket();
    try{if(backendEventSource){backendEventSource.close();backendEventSource=null;}}catch{}
    try{window.azurecordDesktop?.deleteSecureSession?.();}catch{}
    // A conta excluída não pode continuar pré-preenchida nem renderizada no login.
    try{if($('emailInput'))$('emailInput').value='';if($('passwordInput'))$('passwordInput').value='';if($('confirmInput'))$('confirmInput').value='';}catch{}
    saveNow();
    renderSavedAccounts();
  }

  function deleteAccount(){
    const user=currentUser();
    if(!user||!user.cloud){showToast('Entre em uma conta cloud para excluí-la.');return;}
    if(!cloudOnline||!cloudToken||cloudVerifiedAccountId!==user.id){showToast('Reconecte sua conta cloud antes de excluí-la.');return;}
    showModal('Excluir conta',`<div class="setting-list"><div class="setting-row"><div><strong class="danger-text">Exclusão permanente</strong><span>Apaga sua conta, DMs, mensagens, amizades, memória da Lola e servidores pessoais. Esta ação não pode ser desfeita.</span></div></div><div class="modal-grid"><label>Senha atual<input id="deleteAccountPassword" type="password" autocomplete="current-password" placeholder="Sua senha"></label><label>Confirmação<input id="deleteAccountPhrase" autocomplete="off" placeholder="EXCLUIR CONTA"></label></div><p class="tiny-note">Digite <strong>EXCLUIR CONTA</strong> exatamente. Resgates AzurePoints já pagos podem manter um registro financeiro anonimizado.</p><div class="onboarding-actions"><button type="button" class="btn btn-ghost" id="deleteAccountCancel">Cancelar</button><button type="button" class="btn btn-danger" id="deleteAccountConfirm">Excluir minha conta</button></div></div>`);
    $('deleteAccountCancel').onclick=openSettings;
    $('deleteAccountConfirm').onclick=async()=>{
      const currentPassword=$('deleteAccountPassword').value;
      const confirmation=$('deleteAccountPhrase').value.trim();
      if(!currentPassword){showToast('Digite sua senha atual.');return;}
      if(confirmation.toUpperCase()!=='EXCLUIR CONTA'){showToast('Digite EXCLUIR CONTA para confirmar.');return;}
      const button=$('deleteAccountConfirm');button.disabled=true;button.textContent='Excluindo...';
      try{
        try{
          await cloudRequest('/auth/delete',{method:'POST',body:JSON.stringify({currentPassword,confirmation})});
        }catch(err){
          if(err.status!==404)throw err;
          // Compatibilidade com o Worker 0.4, que também aceita DELETE /auth/me.
          await cloudRequest('/auth/me',{method:'DELETE',body:JSON.stringify({currentPassword,confirmation})});
        }
        const id=user.id;
        purgeDeletedAccountLocal(id);
        try{await window.azurecordDesktop?.deleteSecureSession?.();}catch{}
        closeModal();setScreen('loginScreen');renderSavedAccounts();showToast('Conta excluída permanentemente.');
      }catch(err){
        button.disabled=false;button.textContent='Excluir minha conta';
        if(err.status===404)showToast('Seu Worker Cloud está desatualizado. Implante cloud/worker-v0.4.js para excluir contas.');
        else showToast(err.message||'Não foi possível excluir a conta.');
      }
    };
    setTimeout(()=>$('deleteAccountPassword')?.focus(),0);
  }

  function setScreen(screen){ $$('.screen').forEach(s=>s.classList.remove('active')); $(screen).classList.add('active'); }

  function setAuthMode(mode){
    authMode=mode;
    const signup=mode==='signup';
    $('loginTab').classList.toggle('active',!signup); $('signupTab').classList.toggle('active',signup);
    $('confirmRow').hidden=!signup;
    $('confirmInput').required=signup;
    $('confirmInput').disabled=!signup;
    if(!signup)$('confirmInput').value='';
    $('passwordInput').autocomplete=signup?'new-password':'current-password';
    $('passwordInput').minLength=8;$('confirmInput').minLength=8;
    $('passwordInput').placeholder=signup?'Crie uma senha (mín. 8 caracteres)':'Digite sua senha';
    $('authSubmit').textContent=signup?'Criar conta e continuar':'Entrar no Azurecord';
  }
  function showAuthNotice(message='',error=false){
    const el=$('authNotice');if(!el)return;
    el.textContent=message;el.hidden=!message;el.classList.toggle('error',!!error);
  }
  function selectSavedAccount(account){
    // Um perfil em localStorage é só um atalho para o email, não uma prova de login.
    // Nunca deve entrar no aplicativo com token ausente ou de outra conta.
    if(!account)return;
    if(state.backendAccountId && state.backendAccountId!==account.id){
      try{backendEventSource?.close();}catch{} backendEventSource=null;
      backendToken=null;verifiedBackendAccountId=null;state.backendToken=null;state.backendAccountId=null;save();
    }
    if(state.cloudAccountId && state.cloudAccountId!==account.id){
      cloudToken=null;cloudVerifiedAccountId=null;state.cloudAccountId=null;
      try{window.azurecordDesktop?.deleteSecureSession?.();}catch{}
      save();
    }
    setAuthMode('login');setScreen('loginScreen');
    $('emailInput').value=account.email||'';$('passwordInput').value='';
    showAuthNotice(account.cloud
      ?'Conta cloud encontrada. Digite sua senha para entrar. O login usa somente um campo de senha.'
      :'Perfil antigo neste computador. Você pode criar ou entrar numa conta cloud com o mesmo email.');
    $('passwordInput').focus();
  }
  function hashPassword(p){ let h=2166136261; for(let i=0;i<p.length;i++){ h^=p.charCodeAt(i); h=Math.imul(h,16777619);} return (h>>>0).toString(16); }

  function renderSavedAccounts(){
    const el=$('savedAccounts');
    if(!el)return;
    const accounts=(state.accounts||[]).filter(Boolean).slice().sort((a,b)=>(b.lastLogin||0)-(a.lastLogin||0));
    if(!accounts.length){
      // Não deixe o último card salvo virar uma "conta fantasma" depois da exclusão.
      el.replaceChildren();
      el.onclick=null;
      el.hidden=true;
      el.setAttribute('aria-hidden','true');
      return;
    }
    el.hidden=false;
    el.removeAttribute('aria-hidden');
    el.innerHTML=`<div class="section-title">CONTAS SALVAS NESTE COMPUTADOR</div>${accounts.slice(0,5).map(a=>`<div class="result-item" data-saved="${esc(a.id)}"><div class="home-avatar avatar-img" style="background-image:url('${safeUrl(a.avatar)}')">${a.avatar?'':esc(a.username?.[0]||'F')}</div><div><strong>${esc(a.username)}</strong><p>${esc(a.email)}</p></div><div class="spacer"></div><button class="home-mini-btn">Usar conta</button></div>`).join('')}`;
    el.onclick=(e)=>{const row=e.target.closest('[data-saved]');if(row)selectSavedAccount(state.accounts.find(x=>x.id===row.dataset.saved));};
  }

  function isMobileLayout(){ return window.matchMedia('(max-width:720px)').matches; }
  function setMobileDrawer(open){
    document.documentElement.dataset.mobileDrawer=open?'1':'0';
    const overlay=$('mobileDrawerBackdrop');if(overlay)overlay.hidden=!open;
  }
  function setupMobileUi(){
    if(!$('mobileNav')){
      const nav=document.createElement('nav');
      nav.id='mobileNav';nav.className='mobile-bottom-nav';
      nav.innerHTML=`<button data-mobile-home class="active"><span>⌂</span><b>Início</b></button><button data-mobile-servers><span>◫</span><b>Servidores</b></button><button data-mobile-dms><span>✉</span><b>Mensagens</b></button><button data-mobile-you><span>●</span><b>Você</b></button>`;
      $('appScreen')?.appendChild(nav);
      const backdrop=document.createElement('button');
      backdrop.id='mobileDrawerBackdrop';backdrop.className='mobile-drawer-backdrop';backdrop.hidden=true;backdrop.setAttribute('aria-label','Fechar navegação');
      $('appScreen')?.appendChild(backdrop);
      backdrop.onclick=()=>setMobileDrawer(false);
      nav.querySelector('[data-mobile-home]').onclick=()=>{closeMobileDms();setMobileDrawer(false);setMobileNavActive('home');openHome('friends');};
      nav.querySelector('[data-mobile-servers]').onclick=()=>{closeMobileDms();setMobileNavActive('servers');setMobileDrawer(true);};
      nav.querySelector('[data-mobile-dms]').onclick=()=>openMobileDms();
      nav.querySelector('[data-mobile-you]').onclick=()=>{closeMobileDms();setMobileDrawer(false);setMobileNavActive('you');openAppSettings('account');};
    }
    if(!$('mobileMenuBtn')){
      const btn=document.createElement('button');btn.id='mobileMenuBtn';btn.className='mobile-menu-btn';btn.type='button';btn.textContent='☰';btn.setAttribute('aria-label','Abrir navegação');
      $('chatHeader')?.prepend(btn);btn.onclick=()=>setMobileDrawer(true);
    }
    document.addEventListener('click',e=>{
      if(!isMobileLayout())return;
      if(e.target.closest('.server,.channel-item,.dm-item,.home-side-item'))setTimeout(()=>setMobileDrawer(false),0);
    });
    window.addEventListener('resize',()=>{if(!isMobileLayout())setMobileDrawer(false);});
  }

  function setMobileNavActive(section){
    const nav=$('mobileNav');if(!nav)return;
    nav.querySelectorAll('button').forEach(btn=>btn.classList.remove('active'));
    const map={home:'[data-mobile-home]',servers:'[data-mobile-servers]',dms:'[data-mobile-dms]',you:'[data-mobile-you]'};
    const target=nav.querySelector(map[section]||'');if(target)target.classList.add('active');
  }

  function closeMobileDms(){
    const panel=$('mobileDmPanel');if(panel)panel.hidden=true;
    document.documentElement.removeAttribute('data-mobile-page');
  }

  function ensureMobileDmPanel(){
    let panel=$('mobileDmPanel');
    if(panel)return panel;
    panel=document.createElement('section');
    panel.id='mobileDmPanel';
    panel.className='mobile-dm-panel';
    panel.hidden=true;
    panel.innerHTML=`<header class="mobile-dm-header"><div><span class="eyebrow">AZURECORD</span><h2>Mensagens</h2></div><button type="button" class="mobile-dm-refresh" data-mobile-dm-refresh aria-label="Atualizar mensagens">↻</button></header><div class="mobile-dm-subtitle">Mensagens diretas</div><div id="mobileDmList" class="mobile-dm-list"></div>`;
    $('appScreen')?.appendChild(panel);
    panel.querySelector('[data-mobile-dm-refresh]').onclick=async()=>{
      const btn=panel.querySelector('[data-mobile-dm-refresh]');btn.disabled=true;
      try{if(socialCloudReady())await hydrateFromCloudSocial({quiet:true});renderMobileDms();}
      finally{btn.disabled=false;}
    };
    return panel;
  }

  function renderMobileDms(){
    const panel=ensureMobileDmPanel();
    const list=$('mobileDmList');if(!list)return;
    renderDms();
    const source=$('dmList');
    list.innerHTML=source?.innerHTML||'<div class="mobile-dm-empty">Nenhuma mensagem direta aberta.</div>';
    if(!list.children.length)list.innerHTML='<div class="mobile-dm-empty">Nenhuma mensagem direta aberta.</div>';
    list.querySelectorAll('[data-dm-open]').forEach(b=>b.onclick=()=>{
      const id=b.dataset.dmOpen;closeMobileDms();setMobileDrawer(false);setMobileNavActive('dms');openDm(id);
    });
    list.querySelectorAll('[data-dm-close]').forEach(b=>b.onclick=e=>{
      e.stopPropagation();closeDmTab(b.dataset.dmClose);renderMobileDms();
    });
  }

  async function openMobileDms(){
    if(!isMobileLayout()){
      setMobileDrawer(true);
      openHome('friends');
      const t=$('dmToggle');if(t&&t.getAttribute('aria-expanded')!=='true')t.click();
      return;
    }
    setMobileDrawer(false);
    const panel=ensureMobileDmPanel();
    panel.hidden=false;
    document.documentElement.dataset.mobilePage='dms';
    setMobileNavActive('dms');
    renderMobileDms();
    if(socialCloudReady()){
      try{await hydrateFromCloudSocial({quiet:true});}
      catch{}
      if(!panel.hidden)renderMobileDms();
    }
  }

  function boot(){
    window.__azurecordBootStarted=performance.now();
    setScreen('loadingScreen');
    setupMobileUi();
    $('loginTab').onclick=()=>setAuthMode('login'); $('signupTab').onclick=()=>setAuthMode('signup');
    $('passwordToggle').onclick=()=>{ const p=$('passwordInput'); p.type=p.type==='password'?'text':'password'; };
    $('authForm').onsubmit=(e)=>{ e.preventDefault(); submitAuth(); };
    $('demoBtn').onclick=()=>demoLogin(); $('backLogin').onclick=()=>setScreen('loginScreen'); $('finishOnboarding').onclick=finishProfile;
    ['usernameInput','bioInput','accentInput','statusInput'].forEach(id=>$(id).addEventListener('input',updatePreview));
    $('bannerInput').addEventListener('change',e=>readImage(e.target.files?.[0],u=>{ state._onboardBanner=u; updatePreview(); },{maxWidth:1600,maxHeight:600,maxChars:700000}));
    $('avatarInput').addEventListener('change',e=>readImage(e.target.files?.[0],u=>{ state._onboardAvatar=u; updatePreview(); },{maxWidth:512,maxHeight:512,maxChars:420000}));
    $('homeBtn').onclick=()=>openHome('friends'); $('addServer').onclick=openCreateServer;
    $$('[data-home]').forEach(b=>{
      if(b.dataset.home==='apps') b.onclick=()=>openApps();
      else b.onclick=()=>openHome(b.dataset.home);
    });
    $$('[data-home-tab]').forEach(b=>b.onclick=()=>{view.homeTab=b.dataset.homeTab; renderHome();});
    $('homeAddBtn').onclick=()=>openHome('add'); $('dmToggle').onclick=toggleDms;
    $('pointsBtn').onclick=openAzurePoints; $('railPointsBtn').onclick=openAzurePoints; $('lolaStatusBtn').onclick=openLolaAiSetup;
    $('globalSearchBtn').onclick=openGlobalSearch; $('notifyBtn').onclick=openNotifications; $('themeBtn').onclick=toggleTheme; $('openSettings').onclick=openSettings;
    $('logoutBtn').onclick=logout; $('userBar').onclick=(e)=>{if(e.target.closest('button'))return;e.stopPropagation();openProfilePeek(currentUser()?.id,e.currentTarget);};
    $('composer').onsubmit=sendMessage; $('messageInput').addEventListener('keydown',handleComposerKey); $('messageInput').addEventListener('input',handleTypingInput); $('attachBtn').onclick=()=>$('fileInput').click(); $('fileInput').onchange=handleFiles; $('chatView')?.addEventListener('dragenter',handleChatDragEnter); $('chatView')?.addEventListener('dragover',handleChatDragOver); $('chatView')?.addEventListener('dragleave',handleChatDragLeave); $('chatView')?.addEventListener('drop',handleChatDrop); $('attachmentPreview')?.addEventListener('click',e=>{const b=e.target.closest('[data-remove-attachment]');if(!b||b.disabled)return;const [removed]=pendingAttachments.splice(Number(b.dataset.removeAttachment),1);releasePendingAttachment(removed);renderAttachmentPreview();});
    $('gifBtn').dataset.composerType='gif'; $('stickerBtn').dataset.composerType='sticker'; $('emojiBtn').dataset.composerType='emoji'; $('appsBtn').dataset.composerType='apps';
    $('gifBtn').onclick=()=>openComposerPopover('gif'); $('stickerBtn').onclick=()=>openComposerPopover('sticker'); $('emojiBtn').onclick=()=>openComposerPopover('emoji'); $('appsBtn').onclick=()=>openComposerPopover('apps');
    $('composer').addEventListener('click',e=>e.stopPropagation()); $('composerPopover')?.addEventListener('click',e=>e.stopPropagation());
    $('memberToggle').onclick=()=>{view.showMembers=!view.showMembers; renderMemberPanel();}; $('memberClose').onclick=()=>{$('memberPanel').hidden=true;}; $('peopleBtn').onclick=()=>{$('memberPanel').hidden=false;renderMemberPanel();}; $('chatTitleTrigger').onclick=(e)=>{ e.stopPropagation(); if(view.mode==='dm'&&view.dmUserId) openProfilePeek(view.dmUserId,e.currentTarget); };
    $('profilePeekClose').onclick=()=>{selectedProfile=null;view.showProfile=false;$('profilePeek').hidden=true;$('profilePeek').style.left='';$('profilePeek').style.top='';}; $('clearDmBtn').onclick=clearDm; $('newLolaChatBtn').onclick=()=>startNewLolaChat();
    $('voiceBtn').onclick=()=>startDmCall('voice'); $('videoBtn').onclick=()=>startDmCall('video'); $('screenBtn').onclick=()=>activeCall?toggleCallScreen():startDmCall('screen'); $('searchBtn').onclick=openChannelSearch;
    $('callAcceptBtn').onclick=acceptIncomingCall; $('callDeclineBtn').onclick=declineIncomingCall; $('callMicBtn').onclick=toggleCallMic; $('callCameraBtn').onclick=toggleCallCamera; $('callShareBtn').onclick=toggleCallScreen; $('callHangupBtn').onclick=()=>endActiveCall({notify:true}); $('serverMenu').onclick=openServerMenu; $('serverInviteBtn').onclick=openInvite; $('roleManageBtn').onclick=openRoleManager; $('addTextChannel').onclick=()=>openCreateChannel('text'); $('addVoiceChannel').onclick=()=>openCreateChannel('voice');
    document.addEventListener('click',closeContextOnOutside); document.addEventListener('click',closeProfilePeekOnOutside); window.addEventListener('resize',hideContext); window.addEventListener('keydown',globalKeys); window.addEventListener('beforeunload',()=>{if(activeCall)endActiveCall({notify:true});}); window.addEventListener('focus',()=>{if(socialCloudReady()){startCloudRealtimeSocket();publishPresence();wakeCloudRealtimeSync({snapshot:!cloudRealtimeConnected()});}}); document.addEventListener('visibilitychange',()=>{if(socialCloudReady()){if(document.visibilityState==='visible')startCloudRealtimeSocket();publishPresence();if(document.visibilityState==='visible')wakeCloudRealtimeSync({snapshot:!cloudRealtimeConnected()});}}); window.addEventListener('online',()=>{cloudOnline=true;cloudRealtimeFailures=0;if(socialCloudReady()){startCloudRealtimeSocket(true);wakeCloudRealtimeSync({snapshot:true});}showToast('Conexão restaurada. Sincronizando mensagens...');}); window.addEventListener('offline',()=>{cloudRealtimeFailures=Math.max(1,cloudRealtimeFailures);cloudRealtimeSocketReady=false;showToast('Sem internet. Mensagens novas podem falhar até a conexão voltar.');});
    if(localStorage.getItem(THEME_KEY)) state.theme=localStorage.getItem(THEME_KEY); applyTheme(); renderSavedAccounts();
    backendReadyPromise=initBackend().then(()=>{if(backendToken)startBackendEvents();});
    const cloudReadyPromise=initCloudAuth();
    const finishTarget=async()=>{
      await Promise.allSettled([waitForBackend(3500),cloudReadyPromise]);
      if(cloudToken&&cloudVerifiedAccountId&&state.rememberedAccountId===cloudVerifiedAccountId){
        state.currentAccountId=cloudVerifiedAccountId;save();
        const resumed=currentUser();
        if(resumed?.profileComplete===false)beginOnboarding(resumed);else enterApp();
        return;
      }
      const remembered=state.accounts.find(a=>a.id===state.rememberedAccountId);
      state.currentAccountId=null;save();setScreen('loginScreen');
      if(remembered)selectSavedAccount(remembered);
      if(!cloudOnline)showAuthNotice('O Azurecord Cloud não respondeu. Seus perfis locais foram preservados; tente entrar novamente quando a conexão voltar.',true);
      else if(remembered?.cloud)showAuthNotice('Conta cloud encontrada. Digite sua senha uma única vez para entrar; confirmação só é usada ao criar conta.');
    };
    const loadingElapsed=performance.now()-(window.__azurecordBootStarted||performance.now());
    setTimeout(finishTarget,Math.max(0,700-loadingElapsed));
  }

  async function waitForBackend(maxMs=2500){
    if(!backendReadyPromise) return false;
    try{
      return await Promise.race([backendReadyPromise, new Promise(resolve=>setTimeout(()=>resolve(false),maxMs))]);
    }catch{return false;}
  }

  async function submitAuth(){
    const email=window.AzurecordAuthRecovery.emailKey($('emailInput').value);
    const pass=$('passwordInput').value;
    if(!/^\S+@\S+\.\S+$/.test(email)||pass.length<8){
      showAuthNotice('Informe um email válido e uma senha com pelo menos 8 caracteres.',true);return;
    }
    if(authMode==='signup' && pass!==$('confirmInput').value){showAuthNotice('As senhas não conferem.',true);return;}
    const submit=$('authSubmit');if(submit.disabled)return;submit.disabled=true;
    try{
      showAuthNotice(authMode==='signup'?'Criando sua conta na nuvem...':'Entrando na sua conta...');
      if(!cloudOnline)await initCloudAuth();
      if(!cloudOnline){showAuthNotice('O Azurecord Cloud está indisponível agora. Nenhuma conta nova foi criada.',true);return;}
      if(authMode==='signup'){
        const cached=state.accounts.find(a=>window.AzurecordAuthRecovery.emailKey(a.email)===email);
        if(cached?.cloud){showAuthNotice('Esse email já está salvo neste computador. Use Entrar.',true);return;}
        const base=email.split('@')[0].replace(/[^a-z0-9_.-]/gi,'').slice(0,24)||'usuario';
        const data=await cloudRequest('/auth/register',{method:'POST',auth:false,body:JSON.stringify({email,password:pass,username:uniqueUsername(base)})});
        authenticateWithCloud(data);
        beginOnboarding(currentUser());return;
      }
      const data=await cloudRequest('/auth/login',{method:'POST',auth:false,body:JSON.stringify({login:email,password:pass})});
      const account=authenticateWithCloud(data);
      if(account?.profileComplete===false)beginOnboarding(account);else enterApp();
      return;
    }catch(err){
      if(err.status===409)showAuthNotice('Esse email ou nome de usuário já está cadastrado. Use Entrar.',true);
      else if(err.status===401)showAuthNotice('Email ou senha incorretos.',true);
      else showAuthNotice(err.message||'Não foi possível acessar o Azurecord Cloud.',true);
    }finally{submit.disabled=false;}
  }

  function authenticateWithCloud(data){
    stopCloudRealtimeSocket();
    const token=data?.session?.token||data?.token;
    if(!token||!data?.user?.id)throw new Error('O Azurecord Cloud não retornou uma sessão válida.');
    cloudToken=token; cloudVerifiedAccountId=data.user.id;
    state.cloudAccountId=data.user.id;
    const account=applyCloudUser(data.user); account.lastLogin=now();account.status='online';
    state.currentAccountId=account.id;
    state.rememberedAccountId=$('rememberLogin').checked?account.id:null;
    if($('rememberLogin').checked){window.azurecordDesktop?.setSecureSession?.(token).catch?.(()=>{});}else{window.azurecordDesktop?.deleteSecureSession?.().catch?.(()=>{});}
    saveNow();
    if(account._needsCloudProfileSync)syncCloudProfile(account,{quiet:true,profileComplete:true}).catch(()=>{});
    if(cloudInfo?.capabilities?.socialCloud){hydrateFromCloudSocial({quiet:true}).then(()=>startCloudSocialPolling()).catch(()=>{});}
    if(cloudInfo?.capabilities?.settingsCloud){fetchCloudSettings({rerender:false}).catch(()=>{});}
    $('passwordInput').value='';$('confirmInput').value='';showAuthNotice('');
    return account;
  }

  function authenticateWithBackend(data){
    if(!data?.token||!data?.user?.id)throw new Error('O backend não retornou uma sessão válida.');
    try{backendEventSource?.close();}catch{}backendEventSource=null;
    backendToken=data.token;verifiedBackendAccountId=data.user.id;state.backendToken=backendToken;state.backendAccountId=data.user.id;
    state.backendOrigin=backendOrigin;
    const account=applyBackendUser(data.user);account.lastLogin=now();account.status='online';
    state.currentAccountId=account.id;
    state.rememberedAccountId=$('rememberLogin').checked?account.id:null;
    saveNow();startBackendEvents();
    $('passwordInput').value='';$('confirmInput').value='';showAuthNotice('');
  }
  function uniqueUsername(base){ let name=base; let n=1; while(allPeople().some(p=>usernameKey(p.username)===usernameKey(name)) || state.accounts.some(a=>usernameKey(a.username)===usernameKey(name))) name=`${base}${++n}`; return name; }
  function demoLogin(){ verifiedBackendAccountId=null;try{backendEventSource?.close();}catch{}backendEventSource=null;backendToken=null;state.backendToken=null;state.backendAccountId=null; if(!state.accounts.some(a=>a.id==='user-fei-demo')) state.accounts.push({id:'user-fei-demo',email:'demo@azurecord.local',passwordHash:hashPassword('azurecord'),username:'Fei',handle:'@fei',bio:'Designer explorando o Azurecord.',accent:'#0066ff',status:'online',avatar:'',banner:'',personality:'Criativo, curioso e gosta de experimentar interfaces.',memberSince:'27 de set. de 2026',role:'Membro',lastLogin:now()}); state.currentAccountId='user-fei-demo'; state.rememberedAccountId=null; if(!state.friends.some(f=>(f.a==='user-fei-demo'&&f.b==='user-lola')||(f.b==='user-fei-demo'&&f.a==='user-lola'))) state.friends.push({a:'user-fei-demo',b:'user-lola',created:now()}); save(); enterApp(); }
  function beginOnboarding(a){ $('usernameInput').value=a.username||a.email.split('@')[0]; $('bioInput').value=a.bio||'Novo por aqui.'; $('accentInput').value=a.accent||'#0066ff'; $('statusInput').value=a.status||'online'; state._onboardAvatar=a.avatar||'';state._onboardBanner=a.banner||'';updatePreview();setScreen('onboardingScreen'); }
  async function finishProfile(){
    const a=currentUser(); if(!a)return;
    let name=$('usernameInput').value.trim().replace(/\s+/g,'');
    if(!name){showToast('Escolha um nome de usuário.');return;}
    if(allPeople().some(p=>p.id!==a.id&&usernameKey(p.username)===usernameKey(name))){showToast('Esse nome de usuário já está em uso.');return;}
    a.username=name;a.handle='@'+name.toLowerCase();a.bio=$('bioInput').value.trim();a.accent=$('accentInput').value;
    a.status=$('statusInput').value;a.avatar=state._onboardAvatar||a.avatar||'';a.banner=state._onboardBanner||a.banner||'';
    a.profileComplete=true;
    state.profiles[a.id]={...a};
    delete state._onboardAvatar;delete state._onboardBanner;saveNow();
    if(a.cloud){
      await syncCloudProfile(a,{profileComplete:true});
    }else if(backendOnline&&backendToken){
      try{
        const data=await backendRequest('/api/me',{method:'PATCH',body:JSON.stringify({username:a.username,bio:a.bio,accent:a.accent,status:a.status,avatar:a.avatar,banner:a.banner,personality:a.personality})});
        applyBackendUser(data.user);save();
      }catch(err){showToast(err.message||'Perfil salvo localmente.');}
    }
    enterApp();
  }
  function readImage(file,cb,options={}){
    if(!file)return;
    if(!String(file.type||'').startsWith('image/')){showToast('Escolha um arquivo de imagem.');return;}
    if(file.size>12*1024*1024){showToast('Essa imagem é grande demais. Use uma com até 12 MB.');return;}
    const maxWidth=Number(options.maxWidth||900),maxHeight=Number(options.maxHeight||900),maxChars=Number(options.maxChars||700000);
    const r=new FileReader();
    r.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        try{
          const scale=Math.min(1,maxWidth/img.width,maxHeight/img.height);
          const canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(img.width*scale));
          canvas.height=Math.max(1,Math.round(img.height*scale));
          const ctx=canvas.getContext('2d',{alpha:true});
          ctx.drawImage(img,0,0,canvas.width,canvas.height);
          let quality=.86;
          let out=canvas.toDataURL('image/webp',quality);
          while(out.length>maxChars && quality>.46){quality-=.08;out=canvas.toDataURL('image/webp',quality);}
          if(out.length>maxChars){
            const fallbackScale=Math.sqrt(maxChars/out.length);
            const w=Math.max(1,Math.round(canvas.width*fallbackScale));
            const h=Math.max(1,Math.round(canvas.height*fallbackScale));
            const smaller=document.createElement('canvas');smaller.width=w;smaller.height=h;
            smaller.getContext('2d').drawImage(canvas,0,0,w,h);
            out=smaller.toDataURL('image/webp',.72);
          }
          if(out.length>maxChars){showToast('Não foi possível compactar essa imagem o suficiente.');return;}
          cb(out);
        }catch(err){console.warn('[Azurecord] Falha ao compactar imagem:',err);cb(r.result);}
      };
      img.onerror=()=>cb(r.result);
      img.src=r.result;
    };
    r.readAsDataURL(file);
  }
  function updatePreview(){ const n=$('usernameInput').value||'Fei';$('previewName').textContent=n;$('previewHandle').textContent='@'+n.toLowerCase();$('previewBio').textContent=$('bioInput').value||'Novo por aqui.';$('previewAvatar').style.backgroundImage=state._onboardAvatar?`url('${safeUrl(state._onboardAvatar)}')`:'';$('previewAvatar').textContent=state._onboardAvatar?'':(n[0]||'F').toUpperCase();$('previewBanner').style.backgroundImage=state._onboardBanner?`url('${safeUrl(state._onboardBanner)}')`:'none';document.documentElement.style.setProperty('--accent',$('accentInput').value||'#0066ff'); }

  function enterApp(){ const u=currentUser(); if(!u){setScreen('loginScreen');return;} ensureLolaSecretRequest(); if(socialCloudReady()){hydrateFromCloudSocial({quiet:true}).then(()=>startCloudSocialPolling()).catch(()=>{});} setScreen('appScreen'); view.mode='home'; view.home='friends'; view.serverId=null; view.channelId=null; view.dmUserId=null; view.showMembers=true; $('homePanel').hidden=false; $('chatView').hidden=true; $('serverSide').hidden=true; $('homeSide').hidden=false; $('profilePeek').hidden=true; document.documentElement.style.setProperty('--accent',u.accent||state.accent); renderShell(); renderSavedAccounts(); save(); if(pendingInviteCode)setTimeout(()=>consumePendingInviteLink(),220); }
  function renderShell(){
    const u=currentUser();
    if(!u){ return; }
    const isHome=view.mode==='home';
    $('userBarName').textContent=u.username;
    $('userBarStatus').textContent=statusLabel(u.status);
    setAvatar($('userMiniAvatar'),u,'F');
    $('serverName').textContent=isHome?'Início':getServer(view.serverId)?.name||'Servidor';
    const activeServer=isHome?null:getServer(view.serverId); $('serverSubtitle').textContent=isHome?'Azurecord':`${activeServer?.description||'Comunidade'} • ${getServerRole(activeServer)}`;
    $('homeSide').hidden=!isHome;
    $('serverSide').hidden=isHome;
    $('homePanel').hidden=!isHome;
    $('chatView').hidden=isHome;
    $('[data-home="friends"]').classList.toggle('active',isHome && view.home==='friends');
    renderServerRail();
    renderDms();
    renderBadges();
    renderHome();
    renderServerChannels();
    renderMemberPanel();
    renderChat();
  }
  function renderServerRail(){
    const wrap=$('serverList');
    if(!wrap)return;
    try{
      state.servers=Array.isArray(state.servers)?state.servers:[];
      const seen=new Set();
      const servers=[];
      for(const raw of state.servers){
        if(!raw?.id)continue;
        const key=String(raw.id);
        if(seen.has(key))continue;
        seen.add(key);
        ensureServerChannels(raw);
        servers.push(raw);
      }

      wrap.className='server-list';
      wrap.hidden=false;
      wrap.style.display='flex';
      wrap.style.visibility='visible';
      wrap.style.opacity='1';
      wrap.innerHTML='';

      for(const s of servers){
        const button=document.createElement('button');
        button.type='button';
        button.className='server'+(view.mode==='server'&&String(view.serverId)===String(s.id)?' active':'');
        button.dataset.server=s.id;
        button.title=s.name||'Servidor';
        button.setAttribute('aria-label',s.name||'Servidor');
        const iconFrame=document.createElement('span');
        iconFrame.className='server-icon-frame';
        const iconUrl=s.iconUrl||(typeof s.icon==='string'&&/^data:image\//i.test(s.icon)?s.icon:'');
        if(iconUrl){
          const img=document.createElement('img');
          img.src=safeUrl(iconUrl);
          img.alt='';
          img.draggable=false;
          img.onerror=()=>{img.remove();const g=document.createElement('span');g.className='server-glyph';g.textContent=String(s.name?.[0]||s.icon||'S').slice(0,2).toUpperCase();iconFrame.appendChild(g);};
          iconFrame.appendChild(img);
        }else{
          const glyph=document.createElement('span');
          glyph.className='server-glyph';
          glyph.textContent=String(s.icon||s.name?.[0]||'S').slice(0,2).toUpperCase();
          iconFrame.appendChild(glyph);
        }
        button.appendChild(iconFrame);
        if(state.unread?.[`server:${s.id}`]){
          const marker=document.createElement('span');
          marker.className='server-unread-marker';
          marker.setAttribute('aria-hidden','true');
          button.appendChild(marker);
        }
        wrap.appendChild(button);
      }

      if(!wrap._azurecordBound){
        wrap.addEventListener('click',e=>{
          const button=e.target.closest?.('[data-server]');
          if(button&&wrap.contains(button))openServer(button.dataset.server);
        });
        wrap._azurecordBound=true;
      }
    }catch(err){
      console.error('[Azurecord] Erro ao renderizar servidores:',err);
      wrap.hidden=false;
      wrap.style.display='flex';
      wrap.textContent='';
      const fallback=document.createElement('div');
      fallback.className='dm-empty';
      fallback.textContent='Nenhum servidor.';
      wrap.appendChild(fallback);
    }
  }

  function ensureServerChannels(server){
    if(!server) return server;
    if(!Array.isArray(server.channels)) server.channels=[];
    if(server.channels.length===0){
      const defaults=[
        {id:uid('channel'),name:'geral',type:'text',topic:'Canal principal.'},
        {id:uid('channel'),name:'Lounge',type:'voice',topic:'Sala de voz.'}
      ];
      server.channels=defaults.map(c=>({...c,serverId:server.id}));
    }else{
      server.channels=server.channels.map(c=>({...c,serverId:c.serverId||server.id}));
    }
    return server;
  }
  function getServer(id){
    const s=(state.servers||[]).find(x=>x.id===id);
    return ensureServerChannels(s);
  }
  function getChannel(serverId,id){ return getServer(serverId)?.channels.find(c=>c.id===id); }
  let renderFrame = null;
  function requestRenderShell(){
    if(renderFrame) return;
    renderFrame=requestAnimationFrame(()=>{ renderFrame=null; renderShell(); });
  }

  function openHome(section='friends'){
    if(isMobileLayout()){closeMobileDms();setMobileNavActive('home');}
    const hasRequests=(state.requests||[]).some(r=>r.status==='pending'&&(r.from===state.currentAccountId||r.to===state.currentAccountId));
    if(section==='requests'&&!hasRequests)section='friends';
    view.mode='home';
    view.home=section;
    view.homeTab=section==='requests'?'pending':section==='add'?'add':'all';
    view.dmUserId=null;
    hideContext();
    requestRenderShell();
    if(socialCloudReady())wakeCloudRealtimeSync({snapshot:false});
  }
  function openServer(id){
    if(isMobileLayout()){closeMobileDms();setMobileNavActive('servers');}
    const s=getServer(id)||state.servers?.[0];
    if(!s){ showToast('Nenhum servidor disponível.'); return; }
    ensureServerChannels(s);
    const firstText=s.channels.find(c=>c.type==='text');
    view.mode='server';
    view.serverId=s.id;
    view.channelId=firstText?.id||s.channels[0]?.id||null;
    view.dmUserId=null;
    hideContext();
    requestRenderShell();
    void syncChannelMessages(view.serverId,view.channelId);
  }
  async function syncChannelMessages(serverId, channelId){
    if(!socialReady())return;
    const srv=getServer(serverId), ch=getChannel(serverId,channelId);
    if(!srv||!ch||ch.type!=='text')return;
    try{
      const sid=srv.backendId||srv.id, cid=ch.backendId||ch.id;
      const result=await socialRequest(`/api/servers/${encodeURIComponent(sid)}/channels/${encodeURIComponent(cid)}/messages?limit=100`);
      const key=`${serverId}|${channelId}`;
      const local=(state.channelMessages[key]||[]).filter(m=>m.pending&&!m.serverId);
      for(const m of (result.messages||[])){if(m.author)hydrateRemoteUser(m.author);}
      state.channelMessages[key]=[...(result.messages||[]).map(m=>({...m,author:m.senderId,serverId:m.id})),...local];
      save();if(view.mode==='server'&&view.serverId===serverId&&view.channelId===channelId)renderMessages();
      return true;
    }catch(err){
      console.warn('[Azurecord] Falha ao sincronizar canal:',err.message);
      return false;
    }
  }
  function openChannel(channelId){
    const c=getChannel(view.serverId,channelId);
    if(!c)return;
    if(c.type==='voice'){showToast('Canal de voz: chamadas com outros membros estão pausadas nesta versão.');return;}
    view.mode='server';
    view.channelId=channelId;
    view.dmUserId=null;
    hideContext();
    requestRenderShell();
    void syncChannelMessages(view.serverId,view.channelId);
  }
  function toggleDms(){ const list=$('dmList'); const hidden=list.hidden;list.hidden=!hidden;$('dmToggle').setAttribute('aria-expanded',String(hidden));$('dmToggle').querySelector('.dm-chevron').textContent=hidden?'⌄':'›'; }

  function renderFriendTabs(){const ids=friendIds(),online=ids.map(getProfile).filter(p=>p&&resolvedPresence(p.id)==='online').length;const a=$('[data-home-tab="all"]'),o=$('[data-home-tab="online"]');if(a){a.textContent=`Todos — ${ids.length}`;a.classList.toggle('active',view.homeTab!=='online');}if(o){o.textContent=`Online — ${online}`;o.classList.toggle('active',view.homeTab==='online');}}
  function renderHome(){ if(view.mode!=='home') return; renderFriendTabs(); const content=$('homeContent'); const hasRequests=(state.requests||[]).some(r=>r.status==='pending'&&(r.from===state.currentAccountId||r.to===state.currentAccountId)); if((view.home==='requests'||view.homeTab==='pending')&&hasRequests){view.home='requests';$('homeTitle').textContent='Solicitações';$('homeSubtitle').textContent='Veja solicitações recebidas e enviadas.';content.innerHTML=renderRequests();bindHome();return;} if(!hasRequests&&(view.home==='requests'||view.homeTab==='pending')){view.home='friends';view.homeTab='all';} if(view.home==='add'||view.homeTab==='add'){view.home='add';$('homeTitle').textContent='Adicionar amigo';$('homeSubtitle').textContent='Encontre alguém pelo nome de usuário.';content.innerHTML=renderAddFriend();bindHome();return;} $('homeTitle').textContent='Amigos';$('homeSubtitle').textContent='Converse, veja quem está online e gerencie suas amizades.';content.innerHTML=renderFriends();bindHome(); }
  function renderFriends(){ const ids=friendIds(); let people=ids.map(getProfile).filter(Boolean); if(view.homeTab==='online')people=people.filter(p=>resolvedPresence(p.id)==='online'); if(!people.length)return `<div class="home-empty"><div class="home-empty-icon">👥</div><h3>Nenhum amigo por aqui ainda</h3><p>Adicione alguém pelo nome de usuário para começar.</p><button class="btn btn-primary" data-action="goto-add">＋ Adicionar amigo</button></div>`; return `<div class="section-title">AMIGOS • ${people.length}</div><div class="friend-list">${people.map(friendRow).join('')}</div><div class="home-section-spaced"><div class="section-title">SUGESTÕES</div><div class="friend-list">${allPeople().filter(p=>p.id!==currentUser()?.id&&!isFriend(p.id)).slice(0,4).map(friendRow).join('')||'<div class="presence-legend">Sem novas sugestões.</div>'}</div></div>`; }
  function renderRequests(){ const incoming=state.requests.filter(r=>r.to===state.currentAccountId&&r.status==='pending'); const outgoing=state.requests.filter(r=>r.from===state.currentAccountId&&r.status==='pending'); return `<div class="add-friend-card"><div class="add-friend-head"><strong>Solicitações recebidas</strong><div class="request-head-actions"><span>${incoming.length} pendente(s)</span><button class="home-mini-btn ghost" id="refreshFriendRequests">↻ Atualizar</button></div></div>${incoming.length?incoming.map(r=>{const p=getProfile(r.from);return friendRow(p,{request:r});}).join(''):'<div class="home-empty compact"><span>Nenhuma solicitação recebida.</span></div>'}<div class="add-friend-head home-section-spaced"><strong>Solicitações enviadas</strong><span>${outgoing.length}</span></div>${outgoing.length?outgoing.map(r=>{const p=getProfile(r.to);return friendRow(p,{outgoing:r});}).join(''):'<div class="home-empty compact"><span>Nenhuma solicitação enviada.</span></div>'}</div>`; }
  function renderAddFriend(){ return `<div class="add-friend-card"><div class="add-friend-head"><strong>Encontrar alguém</strong><span>Use o nome de usuário completo, por exemplo <b>@nome</b>.</span></div><div class="add-friend-search"><input id="friendSearchInput" placeholder="@nome" value="${esc(currentSearch)}"><span>⌕</span></div><div id="friendSearchResults"></div></div>`; }
  function friendRow(p,opts={}){ if(!p)return ''; const incoming=opts.request,outgoing=opts.outgoing; const system=p.id==='user-lola'; const liveStatus=resolvedPresence(p.id); const statusText=system?'Assistente do sistema':statusLabel(liveStatus); return `<div class="friend-row" data-user-row="${p.id}"><div class="home-avatar avatar-img" style="${p.avatar?`background-image:url('${safeUrl(p.avatar)}')`:''}">${p.avatar?'':esc((p.username||'?')[0].toUpperCase())}</div><div class="friend-main"><strong>${esc(p.username)} ${p.badge?`<span class="role-chip">${esc(p.badge)}</span>`:''}</strong><span>${esc(p.handle||'@'+p.username.toLowerCase())} • ${esc(statusText)}</span></div><span class="presence-dot ${liveStatus}"></span><div class="friend-actions">${system?`<button class="home-mini-btn" data-dm="${p.id}">Mensagem</button><button class="home-mini-btn ghost" data-profile="${p.id}">Perfil</button>`:incoming?`<button class="home-mini-btn" data-accept="${incoming.id}">Aceitar</button><button class="home-mini-btn ghost" data-decline="${incoming.id}">Recusar</button>`:outgoing?`<button class="home-mini-btn ghost" data-cancel="${outgoing.id}">Cancelar</button>`:isFriend(p.id)?`<button class="home-mini-btn" data-dm="${p.id}">Mensagem</button><button class="home-mini-btn ghost" data-profile="${p.id}">Perfil</button>`:`<button class="home-mini-btn" data-request-user="${p.id}">Adicionar</button>`}</div></div>`; }
  function bindHome(){ const input=$('friendSearchInput'); if(input){input.oninput=()=>{currentSearch=input.value;renderSearchResults();};renderSearchResults();} const refresh=$('refreshFriendRequests');if(refresh)refresh.onclick=async()=>{refresh.disabled=true;try{await hydrateFromCloudSocial({quiet:false});renderHome();}finally{refresh.disabled=false;}}; $$('#homeContent [data-dm]').forEach(b=>b.onclick=e=>{e.stopPropagation();openDm(b.dataset.dm)});$$('#homeContent [data-profile]').forEach(b=>b.onclick=e=>{e.stopPropagation();openProfileModal(b.dataset.profile)});$$('#homeContent [data-request-user]').forEach(b=>b.onclick=e=>{e.stopPropagation();sendFriendRequest(b.dataset.requestUser)});$$('#homeContent [data-accept]').forEach(b=>b.onclick=e=>{e.stopPropagation();acceptRequest(b.dataset.accept)});$$('#homeContent [data-decline]').forEach(b=>b.onclick=e=>{e.stopPropagation();declineRequest(b.dataset.decline)});$$('#homeContent [data-cancel]').forEach(b=>b.onclick=e=>{e.stopPropagation();cancelRequest(b.dataset.cancel)});$$('#homeContent [data-action="goto-add"]').forEach(b=>b.onclick=()=>openHome('add'));$$('#homeContent [data-user-row]').forEach(r=>r.onclick=()=>openProfileModal(r.dataset.userRow)); }
  async function renderSearchResults(){
    const holder=$('friendSearchResults');if(!holder)return;
    const q=usernameKey(currentSearch);const epoch=++cloudSearchEpoch;
    if(!q){holder.innerHTML='<div class="presence-legend">Digite um nome de usuário para pesquisar.</div>';return;}
    if(!socialCloudReady()){
      holder.innerHTML='<div class="home-empty compact"><span>Entre novamente na sua conta Cloud para pesquisar usuários.</span></div>';
      return;
    }
    holder.innerHTML='<div class="presence-legend">Pesquisando no Azurecord Cloud...</div>';
    try{
      const data=await cloudRequest(`/api/users?search=${encodeURIComponent(q)}`);
      if(epoch!==cloudSearchEpoch)return;
      const remote=Array.isArray(data.users)?data.users:[];
      for(const u of remote)hydrateRemoteUser(u);
      const found=remote.map(u=>getProfile(u.id)).filter(Boolean).filter(p=>p.id!==state.currentAccountId);
      if(epoch!==cloudSearchEpoch||!$('friendSearchResults'))return;
      holder.innerHTML=found.length?found.map(p=>`<div class="result-item"><div class="home-avatar avatar-img" style="${p.avatar?`background-image:url('${safeUrl(p.avatar)}')`:''}">${p.avatar?'':esc((p.username||'?')[0])}</div><div><strong>${esc(p.username)}</strong><p>${esc(p.handle||'@'+p.username.toLowerCase())}</p></div><div class="spacer"></div>${isFriend(p.id)?'<span class="pill">Amigo</span>':state.requests.some(r=>r.status==='pending'&&r.from===state.currentAccountId&&r.to===p.id)?'<span class="pill">Enviado</span>':`<button class="home-mini-btn" data-find-add="${p.id}">Adicionar</button>`}</div>`).join(''):'<div class="home-empty compact"><span>Nenhum usuário Cloud encontrado com esse nome.</span></div>';
      holder.querySelectorAll('[data-find-add]').forEach(b=>b.onclick=()=>sendFriendRequest(b.dataset.findAdd));
    }catch(err){
      console.warn('[Azurecord] Busca cloud:',err.message);
      if(holder)holder.innerHTML=`<div class="home-empty compact"><span>${esc(err.message||'Não foi possível pesquisar no Azurecord Cloud agora.')}</span></div>`;
    }
  }
  async function sendFriendRequest(id){
    const target=getProfile(id);
    if(!target||id===state.currentAccountId)return;
    if(id==='user-lola'){
      showToast('Lola é uma assistente do sistema e não usa pedidos de amizade.');
      return;
    }
    if(isFriend(id)){showToast('Vocês já são amigos.');return;}
    if(!socialCloudReady()){
      showToast('Entre novamente na sua conta Cloud antes de enviar pedidos.');
      return;
    }
    const existing=state.requests.find(r=>r.status==='pending'&&((r.from===state.currentAccountId&&r.to===id)||(r.from===id&&r.to===state.currentAccountId)));
    if(existing){
      showToast(existing.from===state.currentAccountId?'Pedido já enviado.':'Esse usuário já enviou um pedido para você.');
      return;
    }
    try{
      showToast(`Enviando pedido para @${target.username}...`);
      const result=await cloudRequest('/api/friends/requests',{method:'POST',body:JSON.stringify({toUserId:id})});
      if(result?.accepted || result?.alreadyFriends){
        if(!isFriend(id))state.friends.push({a:state.currentAccountId,b:id,created:now()});
        state.requests=(state.requests||[]).filter(r=>!((r.from===state.currentAccountId&&r.to===id)||(r.from===id&&r.to===state.currentAccountId)));
        addNotification('Novo amigo',`${target.username} agora é seu amigo.`,'friend');
      }else if(result?.request){
        const req=result.request;
        state.requests=(state.requests||[]).filter(r=>r.id!==req.id && !((r.from===state.currentAccountId&&r.to===id)||(r.from===id&&r.to===state.currentAccountId)));
        state.requests.push({id:req.id,from:req.from,to:req.to,status:req.status||'pending',time:new Date(req.createdAt||Date.now()).getTime()});
        showToast(`Pedido enviado para @${target.username}.`);
      }
      sendCloudRealtime({type:'social.commit',targetUserId:id,reason:'friend.request'});
      await hydrateFromCloudSocial({quiet:true});
      save();renderHome();renderBadges();renderDms();
    }catch(err){
      showToast(err.message||'Não foi possível enviar a solicitação.');
    }
  }
  async function acceptRequest(id){
    const r=state.requests.find(x=>x.id===id);if(!r)return;
    if(!socialCloudReady()){showToast('Entre na conta Cloud para aceitar pedidos.');return;}
    try{
      await cloudRequest(`/api/friends/requests/${encodeURIComponent(id)}/accept`,{method:'POST'});
      sendCloudRealtime({type:'social.commit',targetUserId:r.from,reason:'friend.accept'});
      await hydrateFromCloudSocial({quiet:true});
      const p=getProfile(r.from);if(p)addNotification('Novo amigo',`${p.username} agora é seu amigo.`,'friend');
      renderHome();renderDms();renderBadges();
    }catch(err){showToast(err.message||'Não foi possível aceitar o pedido.');}
  }
  async function declineRequest(id){
    if(!socialCloudReady()){showToast('Entre na conta Cloud para recusar pedidos.');return;}
    const r=state.requests.find(x=>x.id===id);
    try{
      await cloudRequest(`/api/friends/requests/${encodeURIComponent(id)}/decline`,{method:'POST'});
      sendCloudRealtime({type:'social.commit',targetUserId:r?.from||'',reason:'friend.decline'});
      await hydrateFromCloudSocial({quiet:true});renderHome();renderBadges();
    }catch(err){showToast(err.message||'Não foi possível recusar o pedido.');}
  }
  async function cancelRequest(id){
    if(!socialCloudReady()){showToast('Entre na conta Cloud para cancelar pedidos.');return;}
    const r=state.requests.find(x=>x.id===id);
    try{
      await cloudRequest(`/api/friends/requests/${encodeURIComponent(id)}/cancel`,{method:'POST'});
      sendCloudRealtime({type:'social.commit',targetUserId:r?.to||'',reason:'friend.cancel'});
      await hydrateFromCloudSocial({quiet:true});renderHome();renderBadges();
    }catch(err){showToast(err.message||'Não foi possível cancelar o pedido.');}
  }

  function ensureLolaSecrets(){
    if(!state.lolaSecrets||typeof state.lolaSecrets!=='object')state.lolaSecrets={};
    if(!state.lolaInitiated||typeof state.lolaInitiated!=='object')state.lolaInitiated={};
  }
  function isLolaSecretUnlocked(){ensureLolaSecrets();return !!state.currentAccountId&&!!state.lolaSecrets[state.currentAccountId];}
  function ensureLolaSecretRequest(){
    // Compatibilidade com betas antigas: Lola deixou de ser uma amizade comum.
    const beforeRequests=(state.requests||[]).length;
    const beforeFriends=(state.friends||[]).length;
    state.requests=(state.requests||[]).filter(r=>r.from!=='user-lola'&&r.to!=='user-lola');
    state.friends=(state.friends||[]).filter(f=>f.a!=='user-lola'&&f.b!=='user-lola');
    const changed=beforeRequests!==state.requests.length||beforeFriends!==state.friends.length;
    if(changed)save();
    return false;
  }
  function unlockLolaSecret(source='home'){
    const me=currentUser();
    if(!me){showToast('Entre no Azurecord para usar códigos secretos.');return false;}
    ensureLolaSecrets();
    const firstUnlock=!state.lolaSecrets[me.id];
    state.lolaSecrets[me.id]={unlockedAt:now(),source};
    ensureLolaSecretRequest();
    const key=dmKey('user-lola');
    state.dmMessages[key]=Array.isArray(state.dmMessages[key])?state.dmMessages[key]:[];
    save();
    renderDms();renderBadges();
    if(firstUnlock)showToast('Chat secreto da Lola desbloqueado. 👀💙');
    closeModal();
    openDm('user-lola',{secret:true,suppressProfile:true});
    return true;
  }
  function checkLolaSecretCode(value,source='panel'){
    if(String(value||'').trim().toLowerCase()==='lola')return unlockLolaSecret(source);
    showToast('Código incorreto.');
    return false;
  }
  function openSecretCodes(){
    showModal('Códigos secretos',`<div class="app-card"><strong>🔐 Área de códigos</strong><p>Há experiências escondidas no beta do Azurecord. Digite um código para descobrir se alguma delas foi liberada.</p><label>Código<input id="secretCodeInput" autocomplete="off" spellcheck="false" placeholder="Digite o código"></label><div class="onboarding-actions"><button class="btn btn-ghost" id="secretCodeCancel">Cancelar</button><button class="btn btn-primary" id="secretCodeUnlock">Desbloquear</button></div><p class="tiny-note">Alguns códigos podem desbloquear conversas ou recursos especiais.</p></div>`);
    $('secretCodeCancel').onclick=closeModal;
    $('secretCodeUnlock').onclick=()=>checkLolaSecretCode($('secretCodeInput').value,'panel');
    $('secretCodeInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();checkLolaSecretCode(e.currentTarget.value,'panel');}});
  }

  function renderDms(){
    const box=$('dmList');
    if(!box)return;
    const ids=[...new Set(Object.keys(state.dmMessages||{}).map(k=>k.split('|').find(x=>x!==state.currentAccountId)))].filter(Boolean)
      .filter(id=>!isBlocked(id))
      .filter(id=>!state.closedDms?.[dmKey(id)]);
    if(state.currentAccountId&&!ids.includes('user-lola')&&!state.closedDms?.[dmKey('user-lola')]) ids.unshift('user-lola');
    if(!ids.length){box.innerHTML='<div class="dm-empty">Nenhuma DM aberta.</div>';return;}
    box.innerHTML=ids.map(id=>{
      const p=getProfile(id); const key=dmKey(id); const msgs=(state.dmMessages[key]||[]).filter(m=>!isMessageSourceHidden(m.author||m.senderId)); const last=msgs.at(-1);
      const preview=isIgnored(id)?'Mensagens deste usuário estão ocultas.':(last?.failed?'⚠ Não enviada • ':'')+(last?.text || (id==='user-lola'?'Conversa livre com a Lola.':'Conversa'));
      return `<div class="dm-item" data-dm-row="${esc(id)}"><button type="button" class="dm-open" data-dm-open="${esc(id)}"><span class="mini-avatar avatar-img" style="${p?.avatar?`background-image:url('${safeUrl(p.avatar)}')`:''}">${p?.avatar?'':esc((p?.username||'?')[0])}</span><span class="dm-item-main"><strong>${esc(p?.username||'Usuário')}</strong><span>${esc(preview)}</span></span>${state.unread[key]?'<span class="unread-dot"></span>':''}</button><button type="button" class="dm-close" data-dm-close="${esc(id)}" aria-label="Fechar conversa com ${esc(p?.username||'usuário')}">×</button></div>`;
    }).join('');
    box.hidden=false;
    $('dmToggle').setAttribute('aria-expanded','true');$('dmToggle').querySelector('.dm-chevron').textContent='⌄';
    box.querySelectorAll('[data-dm-open]').forEach(b=>b.onclick=()=>openDm(b.dataset.dmOpen));
    box.querySelectorAll('[data-dm-close]').forEach(b=>b.onclick=e=>{e.stopPropagation();closeDmTab(b.dataset.dmClose);});
  }
  function dmKey(otherId){ return [state.currentAccountId,otherId].sort().join('|'); }
  async function syncDmFromBackend(id){
    if(id==='user-lola' ? !lolaCloudReady() : !socialReady())return;
    const me=state.currentAccountId,epoch=lolaChatEpoch;
    try{
      if(id==='user-lola' && state.lolaSessionInfo?.[me]?.pendingReset){
        const reset=await cloudRequest('/api/ai/conversations/new',{method:'POST',body:'{}'});
        state.lolaSessionInfo[me]={id:reset.sessionId,pendingReset:false};
      }
      const data=id==='user-lola'?await cloudRequest(`/api/dms/${encodeURIComponent(id)}`):await socialRequest(`/api/dms/${encodeURIComponent(id)}`);
      if(me!==state.currentAccountId || (id==='user-lola'&&epoch!==lolaChatEpoch))return;
      if(data.user)hydrateRemoteUser(data.user);
      const key=dmKey(id);
      if(id==='user-lola'){
        const previous=state.lolaSessionInfo?.[me]?.id||'legacy';
        const remote=data.sessionId||'legacy';
        if(previous!==remote){lolaChatEpoch++;state.dmMessages[key]=[];resetLolaRecentContext();}
        state.lolaSessionInfo[me]={id:remote,pendingReset:false};
      }
      const local=state.dmMessages[key]||[];
      const merged=new Map(local.map(m=>[m.clientId||m.serverId||m.id,m]));
      for(const m of data.messages||[])merged.set(m.clientId||m.id,{...m,author:m.senderId,serverId:m.id,pending:false,failed:false});
      state.dmMessages[key]=[...merged.values()].sort((a,b)=>(a.time||0)-(b.time||0));
      save();
      if(view.mode==='dm'&&view.dmUserId===id){renderDms();renderChat();}
      flushPendingDms(id).catch(err=>console.warn('[Azurecord] Fila DM:',err));
      return true;
    }catch(err){
      console.warn('[Azurecord] DM sync failed:',err.message);
      return false;
    }
  }
  function resetLolaRecentContext(){
    const mem=getLolaMemory();
    // Não elimina gostos/projetos duradouros, mas zera o diálogo imediato.
    mem.messages=[];mem.turns=[];mem.replyHistory=[];mem.questions=[];
    mem.lastUserText='';mem.lastLolaQuestion='';mem.lastIntent='chat';mem.lastTopic='';
    mem.favorAwaiting=false;
  }
  async function startNewLolaChat(){
    if(!state.currentAccountId)return;
    const me=state.currentAccountId,key=dmKey('user-lola');
    lolaChatEpoch++;
    state.dmMessages[key]=[];state.unread[key]=0;
    resetLolaRecentContext();
    // Reinicie imediatamente na UI: mesmo offline o campo fica utilizável.
    state.lolaSessionInfo[me]={id:`local-${uid('chat')}`,pendingReset:true};
    saveNow();renderDms();if(view.mode==='dm'&&view.dmUserId==='user-lola'){renderChat();queueLolaInitiation(false);}
    if(lolaCloudReady()){
      try{
        const pending=cloudRequest('/api/ai/conversations/new',{method:'POST',body:'{}'});
        lolaResetPromise=pending;
        const remote=await pending;
        if(me===state.currentAccountId)state.lolaSessionInfo[me]={id:remote.sessionId,pendingReset:false};
      }catch(err){console.warn('[Azurecord] Nova conversa será sincronizada depois:',err.message);}
      finally{lolaResetPromise=null;}
    }
    save();
    if(me===state.currentAccountId){
      if(view.mode==='dm'&&view.dmUserId==='user-lola')queueLolaInitiation(false);
      $('messageInput').disabled=false;$('messageInput').focus();
      showToast('Nova conversa criada. 😈 Histórico anterior arquivado no Azurecord Cloud.');
    }
  }
  async function openDm(id,options={}){
    if(isMobileLayout()){closeMobileDms();setMobileDrawer(false);setMobileNavActive('dms');}
    if(!getProfile(id))return;
    if(id!=='user-lola'&&isBlocked(id)){showToast('Desbloqueie este usuário antes de abrir uma DM.');openProfileModal(id);return;}
    const key=dmKey(id);
    state.closedDms=state.closedDms||{};delete state.closedDms[key];
    view.mode='dm';view.dmUserId=id;$('homePanel').hidden=true;$('chatView').hidden=false;
    $('serverSide').hidden=true;$('homeSide').hidden=false;
    state.unread[key]=0;save();renderDms();renderChat();
    if(socialCloudReady()&&!cloudRealtimeConnected())startCloudRealtimeSocket();
    // O input funciona ao abrir, sem precisar enviar uma mensagem de teste.
    $('messageInput').disabled=false;$('messageInput').readOnly=false;
    $('messageInput').focus();
    if(id==='user-lola' && !(state.dmMessages[key]||[]).length) queueLolaInitiation(options.secret===true);
    await backendReadyPromise;
    await syncDmFromBackend(id);
    if(id==='user-lola' && !(state.dmMessages[key]||[]).length) queueLolaInitiation(options.secret===true);
  }
  function queueLolaInitiation(secret=false){
    const key=dmKey('user-lola'),arr=state.dmMessages[key]||[];
    if(arr.length)return;
    const recent=state.lolaGreetingHistory[state.currentAccountId]||[];
    const candidates=secret?[
      'Ei, achou meu cantinho secreto! 😈 Pode falar.',
      'Olha quem apareceu por aqui... 👹💙 E aí?'
    ]:[
      'Opa! 😈 Chat aberto, já pode falar comigo.',
      'Cheguei! 💙 O que está pegando?',
      'Pronto, novo papo! 👹 Pode começar do jeito que quiser.',
      'Na área! 🔥 Manda o assunto.'
    ];
    const greeting=window.AzurecordLola.pickFresh(candidates,recent);
    state.lolaGreetingHistory[state.currentAccountId]=[...recent,greeting].slice(-8);
    arr.push({id:uid('msg'),author:'user-lola',text:greeting,time:now(),proactive:true,localGreeting:true});
    state.dmMessages[key]=arr;
    save();renderDms();if(view.mode==='dm'&&view.dmUserId==='user-lola')renderMessages();
  }
  function closeDmTab(id){
    const key=dmKey(id);
    state.closedDms=state.closedDms||{};
    state.closedDms[key]=true;
    save();
    if(view.mode==='dm'&&view.dmUserId===id){
      view.mode='home'; view.dmUserId=null; hideContext();
      $('homePanel').hidden=false; $('chatView').hidden=true; $('serverSide').hidden=true; $('homeSide').hidden=false;
      closeProfilePeek();
    }
    renderDms(); renderHome(); renderChat();
    showToast(`Conversa com ${getProfile(id)?.username||'usuário'} fechada.`);
  }
  async function clearDm(){if(view.mode!=='dm'||!view.dmUserId)return;const id=view.dmUserId;if(id==='user-lola'){if(confirm('Iniciar uma nova conversa com a Lola? O chat atual será arquivado no Azurecord Cloud.'))await startNewLolaChat();return;}if(!confirm(`Limpar a conversa com ${getProfile(id)?.username||'usuário'}?`))return;const key=dmKey(id);state.closedDms=state.closedDms||{};delete state.closedDms[key];state.dmMessages[key]=[];state.unread[key]=0;if(id==='user-lola'){state.lolaInitiated=state.lolaInitiated&&typeof state.lolaInitiated==='object'?state.lolaInitiated:{};delete state.lolaInitiated[key];}save();renderDms();renderMessages();if(socialReady()){try{await socialRequest(`/api/dms/${encodeURIComponent(id)}`,{method:'DELETE'});}catch{showToast('Conversa limpa apenas neste dispositivo.');}}showToast('Conversa limpa.');if(id==='user-lola')queueLolaInitiation(false);}

  function renderChat(){
    if(view.mode==='home'){$('chatView').hidden=true;return;}
    $('chatView').hidden=false;
    const isDm=view.mode==='dm',p=isDm?getProfile(view.dmUserId):null,c=isDm?null:getChannel(view.serverId,view.channelId);
    $('chatIcon').textContent=isDm?'':(c?.type==='text'?'#':'◉');
    $('channelTitle').textContent=isDm?p?.username||'Mensagem Direta':c?.name||'geral';
    $('channelTopic').textContent=isDm?`${p?.handle||''} • ${statusLabel(resolvedPresence(p?.id))}`:(c?.topic||'');
    $('channelWelcome').textContent=isDm?`Conversa com ${p?.username||'usuário'}`:`Bem-vindo a #${c?.name||'geral'}`;
    $('chatHeader').classList.toggle('dm-header',isDm);
    $('chatBanner')?.removeAttribute?.('hidden');
    $('messageInput').placeholder=isDm?`Mensagem para ${p?.username||'usuário'}`:`Conversar em #${c?.name||'geral'}`;
    $('clearDmBtn').hidden=!isDm;
    $('newLolaChatBtn').hidden=!(isDm&&view.dmUserId==='user-lola');
    $('lolaStatusBtn').hidden=!(isDm&&view.dmUserId==='user-lola');
    const callable=!!(isDm&&p?.id&&p.id!=='user-lola'&&isFriend(p.id));
    $('voiceBtn').hidden=!callable;$('videoBtn').hidden=!callable;$('screenBtn').hidden=!callable;
    $('messageInput').disabled=false;$('messageInput').readOnly=false;
    $('profilePeek').hidden=!view.showProfile||!isDm;
    renderMessages();renderTypingIndicator();autoResizeComposer();
  }
  function getMessages(){ if(view.mode==='dm')return state.dmMessages[dmKey(view.dmUserId)]||[]; return state.channelMessages[`${view.serverId}|${view.channelId}`]||[]; }
  function setMessages(arr){ if(view.mode==='dm')state.dmMessages[dmKey(view.dmUserId)]=arr; else state.channelMessages[`${view.serverId}|${view.channelId}`]=arr; save(); }
  function renderMessages(){ const box=$('messages');const all=getMessages();const msgs=all.filter(m=>!isMessageSourceHidden(m.author||m.senderId));const hiddenCount=all.length-msgs.length;box.innerHTML=(hiddenCount?`<div class="message-filter-note">${hiddenCount} mensagem${hiddenCount===1?'':'s'} ocultada${hiddenCount===1?'':'s'} por Bloquear/Ignorar.</div>`:'')+(msgs.map(renderMessage).join('')||'<div class="home-empty compact"><span>Nenhuma mensagem visível. Comece a conversa.</span></div>'); box.querySelectorAll('[data-msg]').forEach(el=>el.addEventListener('contextmenu',e=>openContextMenu(e,el.dataset.msg))); box.querySelectorAll('[data-profile-msg]').forEach(el=>el.onclick=(e)=>{e.preventDefault();e.stopPropagation();openProfilePeek(el.dataset.profileMsg,el);});box.querySelectorAll('[data-retry-dm]').forEach(btn=>btn.onclick=async()=>{const m=getMessages().find(x=>x.id===btn.dataset.retryDm);if(m&&view.mode==='dm')await sendDmToBackend(m,view.dmUserId);}); }
  function attachmentListForMessage(m){
    if(Array.isArray(m?.files) && m.files.length) return m.files;
    if(m?.file) return [m.file];
    return [];
  }
  function formatFileSize(bytes){
    const n=Number(bytes)||0;
    if(n<1024)return `${n} B`;
    if(n<1024*1024)return `${(n/1024).toFixed(1)} KB`;
    if(n<1024*1024*1024)return `${(n/1024/1024).toFixed(1)} MB`;
    return `${(n/1024/1024/1024).toFixed(1)} GB`;
  }
  function fileIcon(type=''){
    if(type.startsWith('video/'))return '▶';
    if(type.startsWith('audio/'))return '♫';
    if(type.includes('pdf'))return 'PDF';
    if(type.includes('zip')||type.includes('rar')||type.includes('7z'))return 'ZIP';
    if(type.includes('word')||type.includes('document'))return 'DOC';
    if(type.includes('sheet')||type.includes('excel'))return 'XLS';
    return 'FILE';
  }
  function closeComposerPopover(){
    const box=$('composerPopover');
    if(!box)return;
    box.hidden=true;
    box.innerHTML='';
    $$('.composer-quick').forEach(b=>b.classList.remove('active'));
  }
  function openComposerPopover(type){
    const box=$('composerPopover');
    if(!box)return;
    const active=$('.composer-quick.active');
    if(!box.hidden && active && active.dataset.composerType===type){closeComposerPopover();return;}
    $$('.composer-quick').forEach(b=>b.classList.toggle('active',b.dataset.composerType===type));
    const emoji=['😀','😂','😍','😎','😭','😡','🥹','😴','🤔','😳','🔥','💙','✨','🎮','🎨','🗿','👍','👀'];
    const gifs=['LOL','HYPE','GG','WHAT','NO WAY','NICE'];
    const stickers=['💙 AZURE','BOOST','GG!','KAWAII','LOL','BORA'];
    const apps=['📊 Enquete','@ Menção','</> Código','✦ Ação'];
    let title=''; let items=[]; let helper='';
    if(type==='emoji'){title='Emoji';items=emoji;helper='Escolha um emoji para inserir na mensagem.'}
    if(type==='gif'){title='GIF';items=gifs;helper='Selecione um GIF rápido. Nesta V38 ele entra como um cartão textual leve, sem baixar mídia externa.'}
    if(type==='sticker'){title='Stickers';items=stickers;helper='Stickers rápidos para as conversas do Azurecord.'}
    if(type==='apps'){title='Apps rápidos';items=apps;helper='Atalhos para recursos que já existem no Azurecord.'}
    box.innerHTML=`<h4>${title}</h4><div class="composer-grid">${items.map((item,i)=>`<button type="button" class="composer-chip ${item.length>8?'wide':''}" data-composer-choice="${i}" data-composer-value="${esc(item)}">${esc(item)}</button>`).join('')}</div><p class="composer-helper">${helper}</p>`;
    box.hidden=false;
    box.querySelectorAll('[data-composer-choice]').forEach(btn=>btn.onclick=()=>{
      const val=btn.dataset.composerValue||'';
      if(type==='emoji'){insertAtCursor(val);closeComposerPopover();return;}
      if(type==='gif'){insertAtCursor(`[GIF: ${val}]`);closeComposerPopover();return;}
      if(type==='sticker'){insertAtCursor(`[Sticker: ${val}]`);closeComposerPopover();return;}
      if(type==='apps'){
        if(val.includes('Enquete')){closeComposerPopover();openCreatePoll();return;}
        if(val.includes('Menção')){insertAtCursor('@lola');closeComposerPopover();return;}
        if(val.includes('Código')){insertAtCursor('```\n\n```');closeComposerPopover();return;}
        if(val.includes('Ação')){insertAtCursor('*Lola entra em cena.*');closeComposerPopover();return;}
      }
    });
  }
  function autoResizeComposer(){const input=$('messageInput');if(!input)return;input.style.height='auto';input.style.height=Math.min(input.scrollHeight,132)+'px';}
  function handleComposerKey(e){
    if(e.isComposing)return;
    if(e.key==='Enter' && !e.shiftKey){e.preventDefault();$('composer')?.requestSubmit?.();return;}
    if(e.key==='Escape')closeComposerPopover();
  }
  function releasePendingAttachment(item){
    if(item?._previewUrl){try{URL.revokeObjectURL(item._previewUrl);}catch{}}
  }

  function setDropOverlay(show){
    const overlay=$('chatDropOverlay');if(overlay)overlay.hidden=!show;
    $('chatView')?.classList.toggle('drag-active',!!show);
  }
  function dragHasFiles(e){return Array.from(e.dataTransfer?.types||[]).includes('Files');}
  function handleChatDragEnter(e){if(!dragHasFiles(e))return;e.preventDefault();dragDepth++;setDropOverlay(true);}
  function handleChatDragOver(e){if(!dragHasFiles(e))return;e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='copy';setDropOverlay(true);}
  function handleChatDragLeave(e){if(!dragHasFiles(e))return;e.preventDefault();dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)setDropOverlay(false);}
  async function handleChatDrop(e){
    if(!dragHasFiles(e))return;e.preventDefault();dragDepth=0;setDropOverlay(false);
    const files=[...(e.dataTransfer?.files||[])];if(!files.length)return;
    await handleFiles({target:{files}});$('messageInput')?.focus();
  }

  async function uploadAttachmentInChunks(item){
    const file=item?._file;
    if(!file)return {id:item.id,name:item.name,size:item.size,type:item.type,url:item.url||'',key:item.key||'',visual:item.visual||null};
    if(!socialCloudReady())throw new Error('Entre na sua conta Cloud para enviar arquivos.');

    const init=await cloudRequest('/api/uploads/init',{method:'POST',body:JSON.stringify({
      name:file.name,type:file.type||'application/octet-stream',size:file.size
    })});
    const chunkSize=Math.max(5*1024*1024,Number(init.partSize)||8*1024*1024);
    const parts=[];
    item.uploading=true;item.progress=0;renderAttachmentPreview();
    try{
      let partNumber=1;
      for(let offset=0;offset<file.size||partNumber===1;offset+=chunkSize,partNumber++){
        const end=Math.min(file.size,offset+chunkSize);
        const chunk=file.slice(offset,end);
        const result=await cloudBinaryRequest(
          `/api/uploads/part?key=${encodeURIComponent(init.key)}&uploadId=${encodeURIComponent(init.uploadId)}&partNumber=${partNumber}`,
          {method:'PUT',body:chunk,headers:{'Content-Type':'application/octet-stream'}}
        );
        parts.push({partNumber,etag:result.etag});
        item.progress=file.size?Math.round((end/file.size)*100):100;
        renderAttachmentPreview();
        if(end>=file.size)break;
      }
      const done=await cloudRequest('/api/uploads/complete',{method:'POST',body:JSON.stringify({
        key:init.key,uploadId:init.uploadId,parts,name:file.name,type:file.type||'application/octet-stream',size:file.size
      })});
      item.uploading=false;item.progress=100;
      return {...done.file,visual:item.visual||null};
    }catch(err){
      item.uploading=false;item.progress=0;
      try{await cloudRequest('/api/uploads/abort',{method:'POST',body:JSON.stringify({key:init.key,uploadId:init.uploadId})});}catch{}
      throw err;
    }finally{
      renderAttachmentPreview();
    }
  }

  async function preparePendingAttachmentsForSend(){
    const uploaded=[];
    for(const item of pendingAttachments)uploaded.push(await uploadAttachmentInChunks(item));
    return uploaded;
  }

  async function handleFiles(e){
    const files=[...(e.target?.files||[])];
    if(!files.length)return;
    pendingAttachmentReads+=files.length;
    for(const file of files){
      try{
        const image=String(file.type||'').startsWith('image/');
        const previewable=image&&file.size<=24*1024*1024;
        const previewUrl=previewable?URL.createObjectURL(file):'';
        const visual=previewable
          ? await analyzeImageFile(file,previewUrl)
          : {kind:guessAttachmentKind(file.name,file.type||'')};
        pendingAttachments.push({
          id:uid('file'),name:file.name,size:file.size,type:file.type||'application/octet-stream',
          visual,_file:file,_previewUrl:previewUrl,uploading:false,progress:0
        });
      }catch(err){
        console.warn('[Azurecord] Falha ao preparar anexo:',err);
        showToast(`Não foi possível preparar ${file.name}.`);
      }finally{
        pendingAttachmentReads=Math.max(0,pendingAttachmentReads-1);
      }
    }
    e.target.value='';
    renderAttachmentPreview();
  }
  function getLolaMemory(){
    if(!state.lolaMemory||typeof state.lolaMemory!=='object') state.lolaMemory={};
    const id=state.currentAccountId||'guest';
    const existing=state.lolaMemory[id];
    if(existing&&typeof existing==='object'){
      existing.messages=Array.isArray(existing.messages)?existing.messages:[];
      existing.topics=existing.topics&&typeof existing.topics==='object'?existing.topics:{};
      existing.likes=Array.isArray(existing.likes)?existing.likes:[];
      existing.dislikes=Array.isArray(existing.dislikes)?existing.dislikes:[];
      existing.facts=Array.isArray(existing.facts)?existing.facts:[];
      existing.projects=Array.isArray(existing.projects)?existing.projects:[];
      existing.moods=Array.isArray(existing.moods)?existing.moods:[];
      existing.designs=Array.isArray(existing.designs)?existing.designs:[];
      existing.questions=Array.isArray(existing.questions)?existing.questions:[];
      existing.goals=Array.isArray(existing.goals)?existing.goals:[];
      existing.recentSubjects=Array.isArray(existing.recentSubjects)?existing.recentSubjects:[];
      existing.relationshipNotes=Array.isArray(existing.relationshipNotes)?existing.relationshipNotes:[];
      existing.replyHistory=Array.isArray(existing.replyHistory)?existing.replyHistory:[];
      existing.openLoops=Array.isArray(existing.openLoops)?existing.openLoops:[];
      existing.entities=Array.isArray(existing.entities)?existing.entities:[];
      existing.stylePreferences=Array.isArray(existing.stylePreferences)?existing.stylePreferences:[];
      existing.memorySummary=String(existing.memorySummary||'');
      existing.turns=Array.isArray(existing.turns)?existing.turns:[];
      existing.lastSeen=existing.lastSeen||now();
      existing.messageCount=Number(existing.messageCount||0);
      existing.lastUserText=String(existing.lastUserText||'');
      existing.lastIntent=String(existing.lastIntent||'chat');
      existing.lastTopic=String(existing.lastTopic||'');
      existing.lastLolaQuestion=String(existing.lastLolaQuestion||'');
      existing.favorAwaiting=!!existing.favorAwaiting;
      return existing;
    }
    const fresh={
      messages:[],topics:{},likes:[],dislikes:[],facts:[],projects:[],moods:[],designs:[],
      questions:[],goals:[],recentSubjects:[],relationshipNotes:[],replyHistory:[],openLoops:[],entities:[],stylePreferences:[],memorySummary:'',turns:[],
      lastSeen:now(),messageCount:0,lastUserText:'',lastIntent:'chat',lastTopic:'',lastLolaQuestion:'',favorAwaiting:false
    };
    state.lolaMemory[id]=fresh;
    return fresh;
  }
  function capList(arr,n=12){ return Array.isArray(arr)?arr.slice(-n):[]; }
  function pushUnique(arr,value,max=12){
    if(!value)return;
    const v=String(value).trim();
    if(!v)return;
    if(!arr.some(x=>String(x).toLowerCase()===v.toLowerCase())) arr.push(v);
    while(arr.length>max)arr.shift();
  }
  function cleanMemoryPhrase(value){ return String(value||'').replace(/[.?!,;:]+$/,'').replace(/^\s+|\s+$/g,'').slice(0,90); }
  function extractListPhrase(text,patterns){ for(const re of patterns){ const m=String(text||'').match(re); if(m?.[1]) return cleanMemoryPhrase(m[1]); } return ''; }
  function learnFromUserText(text,author='user'){
    const mem=getLolaMemory(); const raw=String(text||'').trim(); if(!raw)return mem;
    const lower=raw.toLowerCase(); mem.lastSeen=now();
    mem.messages=capList([...(mem.messages||[]),{text:raw,time:now(),author}],24);
    if(author!=='user') return mem;
    mem.messageCount=(mem.messageCount||0)+1;
    mem.lastUserText=raw;
    mem.lastIntent=(typeof inferLolaIntent==='function'?inferLolaIntent(raw):'chat');
    mem.turns=capList([...(mem.turns||[]),{text:raw,time:now(),intent:mem.lastIntent}],30);
    const topicRules={
      design:['design','photoshop','corel','illustrator','identidade','logo','banner','avatar','ui','ux','interface','mockup','arte','flyer','tipografia'],
      azurecord:['azurecord','servidor','canal','dm','mensagem','perfil','app'],
      games:['jogo','games','gunvolt','kingdom hearts','minecraft','speedrun','steam'],
      programming:['código','programa','javascript','html','css','python','backend','frontend','websocket','electron'],
      anime:['anime','manga','mangá','personagem'],
      school:['escola','prova','professor','matéria','aula','ensino médio']
    };
    for(const [topic,words] of Object.entries(topicRules)){ const hits=words.filter(w=>lower.includes(w)).length; if(hits)mem.topics[topic]=(mem.topics[topic]||0)+hits; }
    const like=extractListPhrase(raw,[/\b(?:eu\s+)?(?:gosto|curto|adoro|amo)\s+(?:de\s+)?(.+)/i,/\b(?:meu|minha)\s+(?:favorit[oa])\s+(?:é|e)\s+(.+)/i]);
    const dislike=extractListPhrase(raw,[/\b(?:eu\s+)?(?:não\s+gosto|nao\s+gosto|detesto|odeio)\s+(?:de\s+)?(.+)/i]);
    if(like)pushUnique(mem.likes,like,16); if(dislike)pushUnique(mem.dislikes,dislike,16);
    const nick=extractListPhrase(raw,[/\b(?:me\s+chame|pode\s+me\s+chamar)\s+(?:de\s+)?([^.!?]+)/i,/\bmeu\s+nome\s+(?:é|e)\s+([^.!?]+)/i]);
    if(nick)mem.preferredName=nick;
    const project=extractListPhrase(raw,[/\b(?:meu|minha)\s+projet[oa]\s+(?:é|e)\s+([^.!?]+)/i,/\b(?:estou|tô|to)\s+(?:fazendo|trabalhando em)\s+([^.!?]+)/i]);
    if(project)pushUnique(mem.projects,project,12);
    const fact=extractListPhrase(raw,[/\b(?:sou|eu sou)\s+([^.!?]+)/i,/\btrabalho\s+com\s+([^.!?]+)/i]);
    if(fact&&fact.length>2)pushUnique(mem.facts,fact,14);
    const positive=/(kk+|haha|muito bom|perfeito|lindo|foda|do cacete|do caralho|adorei|amei|feliz|animad)/i.test(lower);
    const negative=/(bug|erro|quebrou|quebrado|merda|porra|travou|travando|não funciona|nao funciona|irritad|revoltad|crash)/i.test(lower);
    if(positive)pushUnique(mem.moods,'animado',8); if(negative)pushUnique(mem.moods,'frustrado',8);
    const q=raw.endsWith('?')||/^(?:como|por que|porque|o que|qual|quando|onde|quem|será|sera|pode|posso|você pode|vc pode)\b/i.test(lower);
    if(q)pushUnique(mem.questions,raw,14);
    const goal=extractListPhrase(raw,[/\b(?:quero|preciso|vou|pretendo|decidi|decidi fazer|quero criar|quero montar)\s+(.+)/i]);
    if(goal&&goal.length>3)pushUnique(mem.goals,goal,14);
    const note=extractListPhrase(raw,[/\b(?:lembra que|não esquece que|nao esquece que|anota que|guarda que)\s+(.+)/i]);
    if(note)pushUnique(mem.relationshipNotes,note,12);
    const subjects=recentTopicContext(mem);
    if(subjects.length){
      mem.lastTopic=subjects[0];
      pushUnique(mem.recentSubjects,subjects[0],10);
    }
    if(/\b(e você|e vc|e voce|e contigo|e com você)\b/i.test(lower))mem.turns=capList([...(mem.turns||[]),{text:raw,time:now(),intent:'follow-up-self'}],30);
    return mem;
  }
  function recentTopicContext(mem){
    const rules={
      design:['design','photoshop','corel','illustrator','identidade','logo','banner','avatar','ui','ux','interface','mockup','arte','flyer','tipografia'],
      azurecord:['azurecord','servidor','canal','dm','mensagem','perfil','app'],
      games:['jogo','games','gunvolt','kingdom hearts','minecraft','speedrun','steam'],
      programming:['código','programa','javascript','html','css','python','backend','frontend','websocket','electron','programação'],
      anime:['anime','manga','mangá','personagem'],
      school:['escola','prova','professor','matéria','aula','ensino médio']
    };
    const recent=(mem?.messages||[]).filter(x=>x?.author==='user').slice(-8);
    const scores={};
    recent.forEach((entry,index)=>{
      const lower=String(entry.text||'').toLowerCase();
      const weight=index+1;
      for(const [topic,words] of Object.entries(rules)){
        const hits=words.reduce((n,w)=>n+(lower.includes(w)?1:0),0);
        if(hits) scores[topic]=(scores[topic]||0)+(hits*weight);
      }
    });
    return Object.entries(scores).sort((a,b)=>b[1]-a[1]).filter(([,score])=>score>=3).slice(0,2).map(([topic])=>topic);
  }
  function memoryContext(mem){
    const recentTopics=recentTopicContext(mem);
    const longTermTopics=Object.entries(mem?.topics||{}).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k])=>k);
    const recentMessages=(mem?.messages||[]).slice(-7);
    const recentUsers=recentMessages.filter(x=>x?.author==='user').slice(-5).map(x=>x.text);
    const recentLola=recentMessages.filter(x=>x?.author==='lola').slice(-4).map(x=>x.text);
    return {
      preferredName:mem?.preferredName||'',
      topics:recentTopics,
      longTermTopics,
      likes:(mem?.likes||[]).slice(-5),
      dislikes:(mem?.dislikes||[]).slice(-4),
      projects:(mem?.projects||[]).slice(-4),
      facts:(mem?.facts||[]).slice(-4),
      recent:recentUsers,
      recentLola,
      questions:(mem?.questions||[]).slice(-4),
      goals:(mem?.goals||[]).slice(-4),
      recentSubjects:(mem?.recentSubjects||[]).slice(-4),
      relationshipNotes:(mem?.relationshipNotes||[]).slice(-4),
      openLoops:(mem?.openLoops||[]).slice(-6),
      entities:(mem?.entities||[]).slice(-8),
      stylePreferences:(mem?.stylePreferences||[]).slice(-6),
      memorySummary:String(mem?.memorySummary||'').slice(0,3000),
      mood:mem?.moods?.at?.(-1)||'',
      lastUserText:mem?.lastUserText||'',
      lastIntent:mem?.lastIntent||'chat',
      lastTopic:mem?.lastTopic||recentTopics[0]||'',
      lastLolaQuestion:mem?.lastLolaQuestion||''
    };
  }
  function guessAttachmentKind(name,type=''){
    const n=String(name||'').toLowerCase();
    if(type.startsWith('image/')){
      if(/logo|identidade|brand|branding|banner|flyer|poster|cartaz|mockup|ui|ux|interface|layout|arte|design|thumb|thumbnail|capa|icon|ícone|icone/.test(n))return 'design';
      if(/dsc|img[_-]?\d|photo|foto|camera|screenshot|print|capture/.test(n))return 'foto';
      return 'imagem';
    }
    if(/\.psd$|\.ai$|\.cdr$|\.fig$|\.xd$|\.sketch$/.test(n))return 'design';
    return 'arquivo';
  }
  function colorName(r,g,b){
    const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,bright=max/255;
    if(d<22){if(bright<.22)return 'quase preto';if(bright>.88)return 'claro/quase branco';return 'cinza';}
    let h=0;if(max===r)h=((g-b)/d)%6;else if(max===g)h=(b-r)/d+2;else h=(r-g)/d+4;h=Math.round(h*60);if(h<0)h+=360;
    if(h<15||h>=345)return 'vermelho';if(h<45)return 'laranja';if(h<70)return 'amarelo';if(h<165)return 'verde';if(h<200)return 'ciano';if(h<255)return 'azul';if(h<290)return 'roxo';return 'magenta';
  }
  async function analyzeImageFile(file,dataUrl){
    return await new Promise(resolve=>{
      const img=new Image();
      img.onload=()=>{
        try{
          const canvas=document.createElement('canvas'),size=48;canvas.width=size;canvas.height=size;
          const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,size,size);
          const px=ctx.getImageData(0,0,size,size).data;let r=0,g=0,b=0,luma=0,sat=0,count=0;
          for(let i=0;i<px.length;i+=4){if(px[i+3]<16)continue;r+=px[i];g+=px[i+1];b+=px[i+2];const mx=Math.max(px[i],px[i+1],px[i+2]),mn=Math.min(px[i],px[i+1],px[i+2]);luma+=0.2126*px[i]+0.7152*px[i+1]+0.0722*px[i+2];sat+=mx-mn;count++;}
          r=Math.round(r/(count||1));g=Math.round(g/(count||1));b=Math.round(b/(count||1));
          const aspect=img.width/img.height;
          resolve({width:img.width,height:img.height,aspectRatio:Number(aspect.toFixed(3)),orientation:aspect>=1.45?'horizontal':aspect<=0.75?'vertical':'quadrada/compacta',brightness:Math.round((luma/(count||1))/2.55),saturation:Math.round((sat/(count||1))/2.55),dominantColor:colorName(r,g,b),rgb:[r,g,b],kind:guessAttachmentKind(file.name,file.type||'')});
        }catch{resolve({width:img.width,height:img.height,aspectRatio:Number((img.width/img.height).toFixed(3)),orientation:img.width/img.height>=1.45?'horizontal':img.width/img.height<=0.75?'vertical':'quadrada/compacta',kind:guessAttachmentKind(file.name,file.type||'')});}
      };
      img.onerror=()=>resolve({kind:guessAttachmentKind(file.name,file.type||'')}); img.src=dataUrl;
    });
  }
  function rememberDesign(file){ if(!file)return; const mem=getLolaMemory();mem.designs=capList([...(mem.designs||[]),{name:file.name||'imagem',type:file.type||'',size:file.size||0,time:now(),visual:file.visual||null}],12); }
  function formatVisualObservation(file){ const v=file?.visual||{};if(!v.width||!v.height)return '';const bits=[];if(v.dominantColor)bits.push(`predomínio de ${v.dominantColor}`);if(typeof v.brightness==='number')bits.push(v.brightness<30?'luminosidade baixa':v.brightness>75?'luminosidade alta':'luminosidade equilibrada');if(v.orientation)bits.push(`formato ${v.orientation}`);return bits.join(', '); }
  function buildLolaDesignReply(file,mem){
    const v=file?.visual||{},kind=v.kind||guessAttachmentKind(file?.name,file?.type),name=file?.name||'esse arquivo',obs=formatVisualObservation(file),size=v.width&&v.height?`${v.width}×${v.height}`:'';const ctx=memoryContext(mem);const projectHint=ctx.projects.length?` Isso combina com o que você anda fazendo em ${ctx.projects.at(-1)}.`:'';
    if(kind==='design')return `Eu vi o arquivo “${name}” 👀🎨${size?` Ele tem ${size} px`:''}${obs?` e ${obs}`:''}. Pelo nome e pelo visual do arquivo, isso tem muita cara de peça de design. Quero saber o que você estava tentando comunicar aqui.${projectHint}`;
    if(kind==='foto')return `Vi “${name}” 👀${size?` e o arquivo tem ${size} px`:''}${obs?` (${obs})`:''}. Gostei de você me mostrar isso. Me conta o contexto dessa imagem? 💙`;
    return `Recebi “${name}” 👀${size?` em ${size}`:''}${obs?`, com ${obs}`:''}. O que você quer que eu observe nele?`;
  }
  function isFavorRequest(text){
    return /(?:posso|poderia|posso eu)\s+(?:te\s+)?pedir\s+um\s+favor/i.test(String(text||'')) || /você\s+me\s+faz\s+um\s+favor/i.test(String(text||''));
  }
  function isDesignEvaluationRequest(text){
    const lower=String(text||'').toLowerCase();
    const asksEvaluate=/(?:avaliar|avalia|avalie|avaliando|dar\s+uma\s+olhada|analisar|analisa|analise|julgar|dar\s+feedback)/.test(lower);
    const mentionsDesign=/(?:peça\s+de\s+design|peca\s+de\s+design|design|arte|layout|banner|logo|identidade|flyer|poster|cartaz|mockup|ui|ux|interface)/.test(lower);
    const asksCriteria=/(?:pontos\s+fortes|pontos\s+fracos|fortes\s+e\s+fracos|nota|0\s*(?:a|-|até)\s*10|de\s+0\s+a\s+10)/.test(lower);
    return asksEvaluate && mentionsDesign && (asksCriteria || /essa\s+pe[cç]a|essa\s+arte|esse\s+design|essa\s+imagem|essa\s+peça/.test(lower));
  }
  function buildLolaDesignEvaluation(file,mem,userText,hadFavor=false){
    const v=file?.visual||{};
    const name=file?.name||'essa peça';
    const obs=formatVisualObservation(file);
    const lowerName=name.toLowerCase();
    const notes=[];
    const strengths=[];
    const weaknesses=[];
    if(v.orientation==='horizontal')strengths.push('o formato horizontal tende a funcionar bem para peças de capa, banner e composição com leitura lateral');
    if(v.orientation==='vertical')strengths.push('o formato vertical favorece uma composição mais focada e funciona bem em peças de impacto');
    if(v.orientation==='quadrada/compacta')strengths.push('o enquadramento compacto costuma ajudar a manter a composição concentrada');
    if(typeof v.saturation==='number' && v.saturation>=55)strengths.push('há bastante presença de cor, o que pode ajudar a criar destaque visual');
    if(typeof v.saturation==='number' && v.saturation<=25)strengths.push('a saturação mais contida pode ajudar a manter uma aparência mais sofisticada e controlada');
    if(typeof v.brightness==='number' && v.brightness>=68)strengths.push('a luminosidade alta tende a favorecer uma leitura mais aberta e leve');
    if(typeof v.brightness==='number' && v.brightness<=32)strengths.push('a luminosidade baixa pode reforçar contraste e uma atmosfera mais dramática');
    if(/logo|identidade|brand|branding/.test(lowerName))notes.push('Pelo nome do arquivo, parece haver foco em identidade de marca.');
    if(/banner|capa|header/.test(lowerName))notes.push('O nome do arquivo sugere que a peça pode ter sido pensada como banner/capa.');
    if(/ui|ux|interface|mockup/.test(lowerName))notes.push('O nome do arquivo sugere uma peça ligada a interface ou apresentação de produto.');
    if(/flyer|poster|cartaz/.test(lowerName))notes.push('O nome do arquivo sugere uma peça promocional ou editorial.');
    if(typeof v.saturation==='number' && v.saturation>80)weaknesses.push('a intensidade das cores pode ficar pesada se muitos elementos disputarem atenção ao mesmo tempo');
    if(typeof v.brightness==='number' && v.brightness<20)weaknesses.push('a luminosidade muito baixa pode esconder detalhes e reduzir a leitura de elementos secundários');
    if(typeof v.brightness==='number' && v.brightness>88)weaknesses.push('a luminosidade muito alta pode diminuir a força de elementos com pouco contraste');
    if(!strengths.length)strengths.push('o arquivo já permite uma leitura inicial de composição, proporção e tratamento de cor');
    if(!weaknesses.length)weaknesses.push('eu conferiria principalmente hierarquia, contraste e consistência entre os elementos antes de considerar a peça fechada');
    const scoreBase=6.6 + (strengths.length*0.45) - (weaknesses.length*0.3) + (notes.length*0.15);
    const score=Math.max(0,Math.min(10,Number(scoreBase.toFixed(1))));
    const ctx=memoryContext(mem);
    const personal=ctx.projects.length?` E como você já vem trabalhando em ${ctx.projects.at(-1)}, eu também olharia se essa peça conversa com a identidade do projeto.`:'';
    const opening=hadFavor ? 'Pode. E já que você pediu uma avaliação, vou ser bem direta contigo. 👀🎨' : 'Posso avaliar, sim. 👀🎨';
    return `${opening}${notes.length?' '+notes.join(' '):''}${obs?` Na prévia técnica, percebi ${obs}.`:''}\n\n**Pontos fortes**\n• ${strengths.join('\n• ')}\n\n**Pontos fracos**\n• ${weaknesses.join('\n• ')}${personal}\n\n**Nota final: ${score}/10**\nEu trataria essa como uma primeira avaliação baseada na prévia da imagem, no nome do arquivo e nas características visuais que o Azurecord conseguiu extrair. Para uma crítica mais completa, eu ainda conferiria tipografia, alinhamento, espaçamento e hierarquia diretamente na arte.`;
  }
  function inferLolaIntent(text){
    const lower=String(text||'').toLowerCase();
    if(isFavorRequest(lower))return 'favor';
    if(isDesignEvaluationRequest(lower))return 'design-evaluation';
    if(/^\s*\*.*\*\s*$/.test(lower))return 'action';
    if(/^(oi|olá|ola|e aí|e ai|bom dia|boa tarde|boa noite)\b/.test(lower))return 'greeting';
    if(/tudo\s*bem|como\s+(você|voce|vc)|como\s+est[aá]/.test(lower))return 'check-in';
    if(/obrigad|valeu|vlw/.test(lower))return 'gratitude';
    if(/desculp|foi mal|perd[aã]o/.test(lower))return 'apology';
    if(/lembra|mem[oó]ria|o que você sabe|o que voce sabe/.test(lower))return 'memory';
    if(/bug|erro|crash|travou|travando|não funciona|nao funciona/.test(lower))return 'debug';
    if(/design|logo|layout|banner|flyer|mockup|ui|ux|photoshop|corel/.test(lower))return 'design';
    if(/jogo|games|minecraft|gunvolt|kingdom hearts|speedrun|steam/.test(lower))return 'games';
    if(/c[oó]digo|programa|javascript|html|css|python|backend|frontend|electron|websocket/.test(lower))return 'programming';
    if(/matem[aá]tica|equação|equacao|porcentagem|fração|fracao|número|numero/.test(lower))return 'math';
    if(/física|fisica|química|quimica|biologia|ciência|ciencia|espaço|espaco/.test(lower))return 'science';
    if(/hist[oó]ria|geografia|pol[ií]tica|filosofia|literatura/.test(lower))return 'humanities';
    if(/música|musica|filme|série|serie|livro|anime|mang[aá]/.test(lower))return 'media';
    if(/escola|professor|aula|prova|trabalho escolar|ensino/.test(lower))return 'school';
    if(/quero|vou|vamos|bora|decidi|pretendo|preciso/.test(lower))return 'planning';
    if(lower.endsWith('?'))return 'question';
    return 'chat';
  }

  function chooseFreshLolaReply(mem,choices){return window.AzurecordLola.pickFresh(choices,mem?.replyHistory||[]);}
  function lolaBasicReply(text,mem,ctx){
    const lower=String(text||'').trim().toLowerCase();
    if(/\b(oi|olá|ola|e aí|e ai|bom dia|boa tarde|boa noite)\b/.test(lower)){
      return chooseFreshLolaReply(mem,['Oii! 💙 Tô aqui com você.','Opa! 👀 Que bom te ver por aqui.']);
    }
    if(/\b(tudo\s+bem|como\s+(você|voce|vc)\s+est[aá]|como\s+voc[eê]\s+t[aá])/.test(lower)){
      return chooseFreshLolaReply(mem,['Tô bem sim. 💙 E agora fiquei curiosa com o que você queria me contar.','Tô tranquila por aqui. ✨ O que você quer fazer agora?']);
    }
    if(/\b(obrigad|valeu|vlw)\b/.test(lower)) return 'De nada! 💙';
    if(/\b(desculp|foi mal|perd[aã]o)\b/.test(lower)) return 'Relaxa, acontece. 💙';
    if(/^(sim|claro|pode|bora|aceito|quero|com certeza|vamos)$/i.test(lower)){
      return chooseFreshLolaReply(mem,['Então bora. 👀 Me conta o que vem agora.','Fechou. 💙 Tô acompanhando.','Pode deixar. ✨ Continua.']);
    }
    const arithmetic=lower.match(/^(?:quanto\s+é\s+|quanto\s+eh\s+)?(-?\d+(?:[.,]\d+)?)\s*([+\-*x×÷\/])\s*(-?\d+(?:[.,]\d+)?)\s*\??$/i);
    if(arithmetic){
      const a=Number(arithmetic[1].replace(',','.')),op=arithmetic[2].trim(),b=Number(arithmetic[3].replace(',','.'));
      let result=null;
      if(op==='+')result=a+b; else if(op==='-')result=a-b; else if(op==='*'||/x|×/i.test(op))result=a*b; else if(op==='/'||op==='÷')result=b===0?null:a/b;
      if(result!==null&&Number.isFinite(result)) return `Dá ${Number.isInteger(result)?result:result.toFixed(4).replace(/0+$/,'').replace(/\.$/,'')}. 🧮`;
    }
    if(/^(quem|o que|qual|como|por que|porque|onde|quando)\b/.test(lower)){
      // Fallback conservador: se a IA real estiver indisponível, ainda responde
      // de forma útil sem fingir conhecimento específico que não possui.
      if(/\b(você|voce|vc)\b.*\b(lola|é|eh|está|esta)\b/.test(lower)) return 'Sou a Lola do Azurecord. 💙 Tô aqui pra conversar, pensar junto e acompanhar o que você estiver fazendo.';
      return 'Eu consigo responder isso melhor com a IA conectada. Enquanto ela processa, me passa a pergunta exatamente como você quer saber e eu continuo daqui. 👀';
    }
    return null;
  }

  function lolaBroadReply(text,mem,ctx){
    const lower=String(text||'').toLowerCase();
    const intent=mem.lastIntent||inferLolaIntent(text);
    const recent=ctx.recent.at(-2)||'';
    const map={
      greeting:['Oii! 💙 Tô aqui. Conta, o que está acontecendo?','Opa, oi! 👀 Já cheguei. Me conta o que você quer conversar.'],
      planning:['Beleza, vamos pensar nisso juntos. 💙 Me dá o contexto inteiro que eu consigo acompanhar a ideia melhor.'],
      math:['Pode mandar a parte de matemática. 🧮 Eu acompanho o raciocínio passo a passo e, se tiver erro, a gente confere onde ele apareceu.'],
      science:['Manda a pergunta de ciência. 🔬 Eu separo o que é fato, hipótese e o que depende do contexto, sem inventar certeza onde não existe.'],
      humanities:['Pode mandar. 📚 Eu consigo conversar sobre história, geografia, filosofia, literatura e assuntos parecidos, levando em conta o contexto que você der.'],
      media:['Bora. 🎬🎮 Me diz qual obra, personagem ou situação você quer discutir e eu sigo o assunto daqui.'],
      school:['Manda o que aconteceu na escola. 📚 Se for exercício, eu consigo acompanhar a questão; se for só conversa, também.'],
      programming:['Manda o código, erro ou ideia. 💻 Eu sigo o contexto técnico e separo o que é causa provável do que ainda precisa ser verificado.'],
      debug:['Tá, vamos caçar esse bug. 🔧 Me mostra o comportamento, o que mudou por último e o erro que apareceu.'],
      design:['Pode mandar. 🎨 Se for uma peça, arquivo ou ideia visual, eu consigo comentar o nome do arquivo, a prévia e o contexto que você der.'],
      games:['Hahaha, bora pros jogos. 🎮 Manda a situação completa que eu entro na conversa.'],
      question:['Posso discutir isso com você. 👀 Só me dá o contexto que estiver faltando e eu sigo a linha da conversa.'],
      chat:[recent?`Entendi. 👀 Tô acompanhando o que você acabou de falar sobre “${recent.slice(0,70)}${recent.length>70?'…':''}”. Continua.`:'Entendi. 💙 Pode continuar, eu tô acompanhando.']
    };
    const choices=map[intent]||map.chat;
    return choices[Math.floor((mem.messageCount+choices.length)%choices.length)];
  }

  async function simulateLolaReply(message){
    if(!message || message.author!==state.currentAccountId || message.__simulatedReply)return;
    const target=view.mode==='dm'?view.dmUserId:'user-lola';
    if(target!=='user-lola')return;
    const epoch=lolaChatEpoch;
    const accountAtSend=state.currentAccountId;
    const originalView={mode:view.mode,serverId:view.serverId,channelId:view.channelId,dmUserId:view.dmUserId};
    const text=String(message.text||'').trim();
    const mem=learnFromUserText(text);mem.lastIntent=inferLolaIntent(text);
    const files=attachmentListForMessage(message);
    const messages=getMessages().filter(m=>m?.id!==message.id).slice(-32);
    const aiResult=await askLolaAi(text,messages,files,false);
    if(accountAtSend!==state.currentAccountId||epoch!==lolaChatEpoch||aiResult?.discarded)return;
    if(aiResult?.newChat){await startNewLolaChat();return;}
    const previousReplies=(state.dmMessages[dmKey('user-lola')]||[]).filter(m=>m.author==='user-lola').slice(-10).map(m=>m.text);
    let reply=aiResult?.text;
    if(!reply){
      const diagnostic={AI_NOT_CONFIGURED:'O Workers AI ainda não está disponível no Azurecord Cloud. Confira o binding AI e o Worker 0.6. 🔧',AI_PROVIDER_ERROR:'O Workers AI não conseguiu responder agora. Tente novamente em instantes. 🧠',AI_EMPTY_RESPONSE:'O modelo respondeu sem texto. Tente novamente. 🧠',AI_RATE_LIMIT:'Muitas mensagens em pouco tempo. Espera alguns segundos e tenta de novo. ⏳',login_required:'Sua sessão Cloud não está ativa. Entre novamente na sua conta para usar a Lola. 💙'};
      reply=diagnostic[aiResult?.code]||window.AzurecordLola.offlineReply(text,previousReplies,files.length);
    }
    if(!reply)return;
    // Ao falhar o provedor, não inventa uma resposta factual e nem entra
    // num loop de "entendi, me conta mais". O fallback é explicitamente local.
    const key=originalView.mode==='dm'?dmKey('user-lola'):`${originalView.serverId}|${originalView.channelId}`;
    let arr=originalView.mode==='dm'?state.dmMessages[key]||[]:state.channelMessages[key]||[];
    const backendId=aiResult?.message?.id||null;
    if(arr.some(m=>(backendId&&(m.id===backendId||m.serverId===backendId))||m.simulatedFor===message.id))return;
    arr.push({id:backendId||uid('msg'),serverId:backendId||undefined,author:'user-lola',text:reply,
      time:aiResult?.message?.time||now(),simulatedFor:message.id,backendPersisted:!!backendId,
      ...(originalView.mode==='dm'?{lolaSessionId:aiResult?.sessionId||state.lolaSessionInfo?.[accountAtSend]?.id||'legacy'}:{})});
    if(originalView.mode==='dm')state.dmMessages[key]=arr;else state.channelMessages[key]=arr;
    mem.replyHistory=capList([...(mem.replyHistory||[]),reply],16);
    learnFromUserText(reply,'lola');save();
    if(originalView.mode==='dm'&&view.mode==='dm'&&view.dmUserId==='user-lola')renderMessages();
    else if(originalView.mode==='server'&&view.mode==='server'&&view.serverId===originalView.serverId&&view.channelId===originalView.channelId)renderMessages();
  }
  function renderAttachmentCards(files=[]){
    return files.map(f=>{
      const type=String(f.type||'');
      const source=safeUrl(f.url||f.dataUrl||'');
      const image=type.startsWith('image/')&&source;
      if(image){
        return `<figure class="message-attachment image-attachment"><a href="${source}" target="_blank" rel="noopener"><img src="${source}" alt="${esc(f.name||'Imagem')}" loading="lazy"></a><figcaption><span>${esc(f.name||'Imagem')}</span><small>${formatFileSize(f.size)}</small></figcaption></figure>`;
      }
      const card=`<div class="message-attachment file-attachment"><div class="attachment-file-icon">${fileIcon(type)}</div><div class="attachment-file-meta"><strong>${esc(f.name||'Arquivo')}</strong><span>${esc(type||'Arquivo')} • ${formatFileSize(f.size)}</span></div>${source?'<span class="attachment-open">↗</span>':''}</div>`;
      return source?`<a class="attachment-link" href="${source}" target="_blank" rel="noopener">${card}</a>`:card;
    }).join('');
  }
  function renderAttachmentPreview(){
    const box=$('attachmentPreview'); if(!box)return;
    if(!pendingAttachments.length){box.hidden=true;box.innerHTML='';return;}
    box.hidden=false;
    box.innerHTML=`<div class="attachment-preview-head"><span>Anexos (${pendingAttachments.length})</span><button type="button" class="attachment-clear" id="clearPendingAttachments">Limpar</button></div><div class="attachment-preview-grid">${pendingAttachments.map((f,i)=>{
      const preview=safeUrl(f._previewUrl||f.url||f.dataUrl||'');
      const image=String(f.type||'').startsWith('image/')&&preview;
      const visual=f.visual?.width&&f.visual?.height?`${f.visual.width}×${f.visual.height}`:'';
      const progress=f.uploading?` • enviando ${Number(f.progress||0)}%`:'';
      return `<div class="pending-attachment">${image?`<img src="${preview}" alt="${esc(f.name)}">`:`<div class="pending-file-icon">${fileIcon(f.type)}</div>`}<div class="pending-attachment-name" title="${esc(f.name)}">${esc(f.name)}</div><div class="pending-attachment-meta">${visual?`${visual} • `:''}${formatFileSize(f.size)}${progress}</div><button type="button" class="pending-remove" data-remove-attachment="${i}" aria-label="Remover ${esc(f.name)}" ${f.uploading?'disabled':''}>×</button></div>`;
    }).join('')}</div>`;
    $('clearPendingAttachments').onclick=()=>{pendingAttachments.forEach(releasePendingAttachment);pendingAttachments=[];renderAttachmentPreview();};
  }
  function renderMessage(m){
    const p=getProfile(m.author)||{username:'Usuário'};
    const own=m.author===state.currentAccountId;
    const action=/^\*.*\*$/.test(m.text?.trim()||'')&&!m.actionTextOnly;
    const formatted=formatText(m.text||'',p.username);
    const reactions=Object.entries(m.reactions||{}).filter(([,v])=>v>0).map(([k,v])=>`<button class="reaction-chip ${m.myReaction===k?'active':''}" data-react="${m.id}" data-emoji="${k}">${k} ${v}</button>`).join('');
    const attachments=renderAttachmentCards(attachmentListForMessage(m));
    const deliveryClass=own&&m.failed?'message-failed':own&&m.pending?'message-pending':'message-delivered';
    const deliveryLabel=own&&m.failed?'Falha no envio':own&&m.pending?'Enviando':'Enviada';
    return `<article class="message-row ${deliveryClass}" data-msg="${m.id}" data-delivery="${deliveryLabel}"><button type="button" class="message-avatar avatar-img" data-profile-msg="${p.id}" aria-label="Abrir perfil de ${esc(p.username)}" style="${p.avatar?`background-image:url('${safeUrl(p.avatar)}')`:''}">${p.avatar?'':esc((p.username||'?')[0].toUpperCase())}</button><div class="message-content"><button type="button" class="message-meta message-profile-trigger" data-profile-msg="${p.id}" aria-label="Abrir perfil de ${esc(p.username)}"><strong>${esc(p.username)}</strong><span class="role-chip ${getServerRole(getServer(view.serverId),p.id)==='Admin'?'admin':''}">${esc(getServerRole(getServer(view.serverId),p.id))}</span><time>${formatTime(m.time)}</time>${m.edited?'<span class="message-edited">editada</span>':''}</button>${m.replyTo?`<div class="reply-preview">↩ ${esc(m.replyTo.authorName)}: ${esc(m.replyTo.text)}</div>`:''}<div class="message-text ${action?'action-text':''}">${formatted}</div>${attachments}${own&&m.pending?`<small class="dm-delivery ${m.failed?'dm-failed':''}">${m.failed?'⚠ Não enviada':'◌ Enviando'} ${m.failed&&view.mode==='dm'?`<button type="button" data-retry-dm="${esc(m.id)}">Tentar novamente</button>`:''}</small>`:''}${reactions?`<div class="message-reactions">${reactions}</div>`:''}</div></article>`;
  }
  function formatText(text,username){ let s=esc(text);s=s.replace(/@([\w\d_]+)/g,(m,n)=>`<span class="mention">@${esc(n)}</span>`); if(/^\*.*\*$/.test(text.trim()))s=`<span class="action-text">${s}</span>`; return s; }
  async function sendDmToBackend(m,id){
    if(!m || m.sending || m.serverId || !id)return !!m?.serverId;
    const fail=(reason)=>{
      m.pending=true;m.failed=true;m.lastError=reason||'Falha de conexão';saveNow();
      if(view.mode==='dm'&&view.dmUserId===id)renderMessages();
      return false;
    };
    if(typeof navigator!=='undefined'&&navigator.onLine===false){
      const failed=fail('Sem conexão com a internet.');
      showToast('DM não enviada: sem conexão com a internet.');
      return failed;
    }
    if(id==='user-lola' ? !lolaCloudReady() : !socialReady()){
      const failed=fail('Azurecord Cloud indisponível.');
      return failed;
    }
    if(id==='user-lola' && m.lolaSessionId && m.lolaSessionId!==(state.lolaSessionInfo?.[state.currentAccountId]?.id||'legacy'))return false;
    m.sending=true;m.pending=true;m.failed=false;delete m.lastError;saveNow();
    if(view.mode==='dm'&&view.dmUserId===id)renderMessages();
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const options={method:'POST',signal:controller.signal,body:JSON.stringify({clientId:m.id,text:m.text,
        files:m.files||[],replyTo:m.replyTo||null,...(id==='user-lola'?{sessionId:m.lolaSessionId||'legacy'}:{})})};
      const response=id==='user-lola'
        ?await cloudRequest(`/api/dms/${encodeURIComponent(id)}/messages`,options)
        :await socialRequest(`/api/dms/${encodeURIComponent(id)}/messages`,options);
      m.serverId=response.message.id;m.clientId=m.id;m.pending=false;m.failed=false;delete m.lastError;saveNow();
      if(view.mode==='dm'&&view.dmUserId===id)renderMessages();
      if(id!=='user-lola')sendCloudRealtime({type:'dm.commit',targetUserId:id,messageId:m.serverId,clientId:m.id});
      wakeCloudRealtimeSync();
      return true;
    }catch(err){
      const reason=err?.name==='AbortError'?'Tempo limite de envio.':(err.message||'Falha de conexão');
      fail(reason);
      showToast(`DM não enviada: ${reason}`);
      return false;
    }finally{
      clearTimeout(timeout);
      m.sending=false;
    }
  }
  async function flushPendingDms(onlyId=null){
    if((!socialReady()&&!lolaCloudReady())||!state.currentAccountId)return;
    const me=state.currentAccountId;
    for(const [key,messages] of Object.entries(state.dmMessages||{})){
      const users=key.split('|'); if(!users.includes(me))continue;
      const other=users.find(x=>x!==me);if(!other||(onlyId&&other!==onlyId))continue;
      for(const message of messages){
        if(message.author!==me||!message.pending||message.failed||message.serverId||message.sending)continue;
        if(other==='user-lola' && message.lolaSessionId!==(state.lolaSessionInfo?.[me]?.id||'legacy'))continue;
        await sendDmToBackend(message,other);
      }
    }
  }
  async function sendMessage(e){
    e.preventDefault();
    const input=$('messageInput'),text=input.value.trim();
    const mode=view.mode, dmId=view.dmUserId, serverId=view.serverId, channelId=view.channelId;
    if(mode==='dm'&&dmId==='user-lola'&&!pendingAttachments.length&&window.AzurecordLola.wantsNewConversation(text)){
      input.value='';await startNewLolaChat();return;
    }
    if((!text&&!pendingAttachments.length)||pendingAttachmentReads>0){if(pendingAttachmentReads>0)showToast('Aguarde os anexos.');return;}
    if(mode==='dm'&&dmId==='user-lola'&&lolaCloudReady()){
      if(lolaResetPromise){try{await lolaResetPromise;}catch{}}
      if(!state.lolaSessionInfo?.[state.currentAccountId]){
        try{const remote=await cloudRequest('/api/ai/conversations');state.lolaSessionInfo[state.currentAccountId]={id:remote.sessionId||'legacy',pendingReset:false};}
        catch(err){console.warn('[Azurecord] Sessão da Lola:',err.message);}
      }
    }
    const p=currentUser();if(!p)return;
    let outgoingFiles=[];
    if(pendingAttachments.length){
      try{
        outgoingFiles=await preparePendingAttachmentsForSend();
      }catch(err){
        console.warn('[Azurecord] Upload de anexo:',err);
        showToast(err.message||'Não foi possível enviar os anexos.');
        return;
      }
    }
    const m={id:uid('msg'),author:p.id,text,time:now(),...(mode==='dm'?{clientId:null}:{}),
      ...(mode==='dm'&&dmId==='user-lola'?{lolaSessionId:state.lolaSessionInfo?.[p.id]?.id||'legacy'}:{})};
    if(replyTo){m.replyTo={authorName:getProfile(replyTo.author)?.username||'Usuário',text:replyTo.text};replyTo=null;}
    if(outgoingFiles.length){m.files=outgoingFiles;if(m.files.length===1)m.file=m.files[0];}
    learnFromUserText(text);
    if(m.files?.length)m.files.forEach(f=>{if(String(f.type||'').startsWith('image/'))rememberDesign(f);});
    if(mode==='dm'){
      const key=dmKey(dmId);state.dmMessages[key]=state.dmMessages[key]||[];m.pending=socialReady() && dmId!=='user-lola';
      if(dmId!=='user-lola')m.pending=true;
      else if(lolaCloudReady())m.pending=true;
      state.dmMessages[key].push(m);
    }else{
      const key=`${serverId}|${channelId}`;state.channelMessages[key]=state.channelMessages[key]||[];state.channelMessages[key].push(m);
    }
    input.value='';autoResizeComposer();stopTypingNow();$('fileInput').value='';pendingAttachments.forEach(releasePendingAttachment);pendingAttachments=[];renderAttachmentPreview();saveNow();renderMessages();renderDms();
    if(mode==='dm'){
      if((dmId==='user-lola'&&lolaCloudReady())||(dmId!=='user-lola'&&socialReady())){
        const persisted=await sendDmToBackend(m,dmId);
        if(dmId==='user-lola' && persisted){simulateLolaReply(m).catch(err=>console.warn('[Azurecord] Lola:',err));}
        else if(dmId==='user-lola' && !persisted){simulateLolaReply(m).catch(()=>{});}
      }else if(dmId==='user-lola'){
        m.pending=false;save();simulateLolaReply(m).catch(()=>{});
      }else{m.pending=true;m.failed=true;saveNow();renderMessages();showToast('DM guardada localmente; faça login para enviá-la.');}
    }else if(mode==='server'){
      const srv=getServer(serverId),ch=getChannel(serverId,channelId);
      if(srv&&ch){
        m.pending=true;m.failed=false;saveNow();renderMessages();
        if(typeof navigator!=='undefined'&&navigator.onLine===false){
          m.failed=true;m.lastError='Sem conexão com a internet.';saveNow();renderMessages();
        }else if(socialReady()){
          const controller=new AbortController();
          const timeout=setTimeout(()=>controller.abort(),12000);
          socialRequest(`/api/servers/${encodeURIComponent(srv.backendId||srv.id)}/channels/${encodeURIComponent(ch.backendId||ch.id)}/messages`,{method:'POST',signal:controller.signal,body:JSON.stringify({text:m.text,files:m.files||[],replyTo:m.replyTo||null,clientId:m.id})})
            .then(result=>{if(result.message){m.serverId=result.message.id;m.pending=false;m.failed=false;delete m.lastError;saveNow();renderMessages();sendCloudRealtime({type:'channel.commit',serverId:srv.backendId||srv.id,channelId:ch.backendId||ch.id,messageId:m.serverId,clientId:m.id});wakeCloudRealtimeSync();}})
            .catch(err=>{m.pending=true;m.failed=true;m.lastError=err?.name==='AbortError'?'Tempo limite de envio.':(err.message||'Falha no envio');saveNow();renderMessages();showToast('Canal: '+m.lastError);})
            .finally(()=>clearTimeout(timeout));
        }else{
          m.failed=true;m.lastError='Azurecord Cloud indisponível.';saveNow();renderMessages();
        }
      }
    }
  }
  function insertAtCursor(txt){ const i=$('messageInput');const s=i.selectionStart??i.value.length; i.value=i.value.slice(0,s)+txt+i.value.slice(i.selectionEnd);i.focus();i.selectionStart=i.selectionEnd=s+txt.length; }

  function openContextMenu(ev,msgId){ev.preventDefault();hideContext();view.contextMessageId=msgId;const box=$('contextMenu');const m=getMessages().find(x=>x.id===msgId);if(!m)return;const own=m.author===state.currentAccountId;box.innerHTML=`<div class="context-section"><div class="context-heading">REAÇÕES</div><div class="choice-row" style="padding:5px 10px">${['👍','❤️','😂','🔥','🎮'].map(x=>`<button class="choice-btn" data-context-react="${x}">${x}</button>`).join('')}</div></div><div class="context-section"><button class="context-item" data-context="reply">↩ Responder</button><button class="context-item" data-context="forward">↪ Encaminhar</button><button class="context-item" data-context="pin">📌 ${state.pinned[messageKey(msgId)]?'Desfixar':'Fixar'} mensagem</button><button class="context-item" data-context="unread">● Marcar como não lido</button></div><div class="context-section"><button class="context-item" data-context="copy">🔗 Copiar texto</button><button class="context-item" data-context="edit" ${own?'':'style="display:none"'}>✎ Editar mensagem</button><button class="context-item danger" data-context="delete" ${own?'':'style="display:none"'}>🗑 Excluir mensagem</button></div><div class="context-section"><button class="context-item" data-context="id">🆔 Copiar ID da mensagem</button></div>`;box.hidden=false;box.style.left=Math.min(ev.clientX,window.innerWidth-235)+'px';box.style.top=Math.min(ev.clientY,window.innerHeight-330)+'px';box.querySelectorAll('[data-context-react]').forEach(b=>b.onclick=()=>reactMessage(msgId,b.dataset.contextReact));box.querySelectorAll('[data-context]').forEach(b=>b.onclick=()=>contextAction(b.dataset.context,msgId)); }
  function messageKey(id){return `${view.mode}|${view.serverId}|${view.channelId}|${view.dmUserId||''}|${id}`;}
  function reactMessage(id,emoji){const arr=getMessages();const m=arr.find(x=>x.id===id);if(!m)return;m.reactions=m.reactions||{};m.reactions[emoji]=(m.reactions[emoji]||0)+1;m.myReaction=emoji;setMessages(arr);hideContext();renderMessages();}
  function contextAction(action,id){const arr=getMessages();const m=arr.find(x=>x.id===id);if(!m)return;hideContext();if(action==='reply'){replyTo=m;$('messageInput').focus();showToast('Respondendo esta mensagem.');return;}if(action==='forward'){const target=prompt('Encaminhar para qual @usuário?');if(!target)return;const p=allPeople().find(x=>usernameKey(x.username)===usernameKey(target));if(!p){showToast('Usuário não encontrado.');return;}const key=dmKey(p.id);state.dmMessages[key]=state.dmMessages[key]||[];state.dmMessages[key].push({id:uid('msg'),author:state.currentAccountId,text:m.text||'',time:now(),forwarded:true});save();renderDms();showToast(`Mensagem encaminhada para ${p.handle||p.username}.`);return;}if(action==='pin'){const k=messageKey(id);state.pinned[k]=!state.pinned[k];save();showToast(state.pinned[k]?'Mensagem fixada.':'Mensagem desfixada.');return;}if(action==='unread'){const k=view.mode==='dm'?dmKey(view.dmUserId):`${view.serverId}|${view.channelId}`;state.unread[k]=1;save();renderDms();showToast('Marcado como não lido.');return;}if(action==='copy'){navigator.clipboard?.writeText(m.text||'');showToast('Texto copiado.');return;}if(action==='id'){navigator.clipboard?.writeText(m.id);showToast('ID da mensagem copiado.');return;}if(action==='edit'){const next=prompt('Editar mensagem:',m.text||'');if(next!==null&&next.trim()){m.text=next.trim();m.edited=true;setMessages(arr);renderMessages();}return;}if(action==='delete'){m.deleted=true;m.text='Mensagem excluída.';m.reactions={};setMessages(arr);renderMessages();}}
  function closeContextOnOutside(e){if(!$('contextMenu').hidden&&!e.target.closest('#contextMenu'))hideContext();if($('composerPopover')&&!$('composerPopover').hidden&&!e.target.closest('#composerPopover')&&!e.target.closest('.composer-quick'))closeComposerPopover();}
  function closeProfilePeek(){const panel=$('profilePeek');if(!panel)return;selectedProfile=null;view.showProfile=false;panel.hidden=true;panel.style.left='';panel.style.top='';}
  function closeProfilePeekOnOutside(e){const panel=$('profilePeek');if(!panel||panel.hidden)return;if(e.target.closest('#profilePeek'))return;if(e.target.closest('[data-profile-msg], [data-member], #userBar, #chatTitleTrigger'))return;closeProfilePeek();}
  function hideContext(){ $('contextMenu').hidden=true; }

  function renderMemberPanel(){ const panel=$('memberPanel'); if(view.mode!=='server'||!view.showMembers){panel.hidden=true;return;}panel.hidden=false;const members=[currentUser(),...DEMO_USERS.filter(x=>x.id!==currentUser()?.id)];$('memberList').innerHTML=`<div class="member-panel-head"><strong>MEMBROS • ${members.length}</strong><span class="presence-legend">${members.filter(m=>m.status==='online').length} online</span></div>`+members.filter(Boolean).map(p=>`<button class="member-item" data-member="${p.id}"><div class="mini-avatar avatar-img" style="${p.avatar?`background-image:url('${safeUrl(p.avatar)}')`:''}">${p.avatar?'':esc(p.username[0])}</div><div><strong>${esc(p.username)}</strong><span>${statusLabel(resolvedPresence(p.id))}</span></div><span class="role-chip ${getServerRole(getServer(view.serverId),p.id)==='Admin'?'admin':''}">${esc(getServerRole(getServer(view.serverId),p.id))}</span></button>`).join('');$('[data-member]')?.focus?.();$$('#memberList [data-member]').forEach(b=>b.onclick=(e)=>{e.stopPropagation();openProfilePeek(b.dataset.member,b);}); }
  function openProfilePeek(id,anchorEl=null){
    const p=getProfile(id); if(!p)return;
    selectedProfile=id; view.showProfile=true;
    const panel=$('profilePeek'); panel.hidden=false;
    $('profilePeekCard').innerHTML=profilePeekHtml(p,{peek:true});
    bindProfileActions(id);
    const anchor=anchorEl?.getBoundingClientRect?.();
    const width=Math.min(390,window.innerWidth-24);
    const height=Math.min(460,window.innerHeight-24);
    let left=anchor?anchor.right+10:Math.round((window.innerWidth-width)/2);
    let top=anchor?anchor.top:Math.round((window.innerHeight-height)/2);
    if(left+width>window.innerWidth-12) left=anchor?anchor.left-width-10:Math.max(12,window.innerWidth-width-12);
    if(left<12) left=12;
    if(top+height>window.innerHeight-12) top=Math.max(12,window.innerHeight-height-12);
    if(top<12) top=12;
    panel.style.width=width+'px'; panel.style.left=left+'px'; panel.style.top=top+'px';
  }
  function profilePeekHtml(p,opts={}){
    if(!p)return '';
    const self=p.id===state.currentAccountId;
    const system=p.id==='user-lola';
    const compact=opts.peek===true;
    const blocked=!system&&isBlocked(p.id), ignored=!system&&isIgnored(p.id);
    const friendship=system?'Assistente do sistema':(self?'Seu perfil':(blocked?'Bloqueado':(isFriend(p.id)?'Amigo':'Ainda não são amigos')));
    const avatar=p.avatar?safeUrl(p.avatar):'';
    const banner=p.banner?safeUrl(p.banner):'';
    if(compact){
      return `<div class="profile-detail profile-preview-compact">
        <div class="profile-hero" style="${banner?`background-image:linear-gradient(180deg,rgba(5,8,14,.05),rgba(5,8,14,.65)),url('${banner}')`:`background:linear-gradient(135deg,${p.accent||'#0066ff'},#0b1224)`}"></div>
        <div class="profile-main-head">
          <div class="big-avatar avatar-img profile-avatar-large" style="${avatar?`background-image:url('${avatar}')`:''}">${avatar?'':esc((p.username||'?')[0].toUpperCase())}</div>
          <div class="profile-title-block"><h2>${esc(p.username)}</h2><div class="handle">${esc(p.handle||'@'+p.username.toLowerCase())}</div><div class="profile-status-line"><span class="status-dot ${p.status||'offline'}"></span>${statusLabel(p.status)} <span class="profile-bullet">•</span> ${esc(friendship)}</div></div>
        </div>
        <div class="profile-preview-bio">${esc(p.bio||'Sem bio.')}</div>
        <div class="profile-actions profile-preview-actions"><button class="btn btn-primary wide" data-profile-full="${p.id}">Exibir perfil completo</button></div>
      </div>`;
    }
    return `<div class="profile-detail profile-full-detail">
      <div class="profile-hero" style="${banner?`background-image:linear-gradient(180deg,rgba(5,8,14,.05),rgba(5,8,14,.65)),url('${banner}')`:`background:linear-gradient(135deg,${p.accent||'#0066ff'},#0b1224)`}"></div>
      <div class="profile-main-head">
        <div class="big-avatar avatar-img profile-avatar-large" style="${avatar?`background-image:url('${avatar}')`:''}">${avatar?'':esc((p.username||'?')[0].toUpperCase())}</div>
        <div class="profile-title-block"><h2>${esc(p.username)}</h2><div class="handle">${esc(p.handle||'@'+p.username.toLowerCase())}</div><div class="profile-status-line"><span class="status-dot ${p.status||'offline'}"></span>${statusLabel(p.status)} <span class="profile-bullet">•</span> ${esc(friendship)}${ignored?' <span class="profile-bullet">•</span> Ignorado':''}</div></div>
        <div class="profile-top-actions">${self?'<button class="btn btn-primary" data-profile-edit>Editar perfil</button>':''}</div>
      </div>
      <div class="profile-badges-row"><span class="role-chip">${esc(p.badge||'✦')}</span><span class="role-chip">ID ${esc(p.id)}</span></div>
      <div class="profile-body-grid">
        <section class="profile-section-card"><div class="dm-peek-label">SOBRE MIM</div><p>${esc(p.bio||'Sem bio.')}</p></section>
        <section class="profile-section-card"><div class="dm-peek-label">PERSONALIDADE</div><p>${esc(p.personality||'Usuário do Azurecord.')}</p></section>
      </div>
      <div class="profile-meta-grid"><div><span>Membro desde</span><strong>${esc(p.memberSince||'2026')}</strong></div><div><span>${system?'Tipo':'Amigos'}</span><strong>${system?'Assistente':String(p.friendCount??friendIdsForProfile(p.id))}</strong></div><div><span>Usuário</span><strong>${esc(p.handle||'@'+p.username.toLowerCase())}</strong></div></div>
      ${system?`<div class="profile-actions profile-action-grid profile-action-grid-system"><button class="btn btn-primary" data-profile-dm="${p.id}">Mensagem direta</button></div>`:!self?`<div class="profile-actions profile-action-grid">
        <button class="btn btn-primary" data-profile-dm="${p.id}" ${blocked?'disabled':''}>Mensagem direta</button>
        <button class="btn btn-ghost" data-profile-friend="${p.id}" ${blocked?'disabled':''}>${isFriend(p.id)?'Remover amigo':'Adicionar amigo'}</button>
        <button class="btn ${blocked?'btn-ghost':'btn-danger'}" data-profile-block="${p.id}">${blocked?'Desbloquear':'Bloquear'}</button>
        <button class="btn btn-ghost" data-profile-ignore="${p.id}" ${blocked?'disabled':''}>${ignored?'Parar de ignorar':'Ignorar'}</button>
      </div>`:''}
    </div>`;
  }
  function friendIdsForProfile(id){ return state.friends.filter(f=>f.a===id||f.b===id).length; }
  function bindProfileActions(id){
    const full=$(`[data-profile-full="${CSS.escape(id)}"]`);if(full)full.onclick=()=>{closeProfilePeek();openProfileModal(id);};
    const d=$(`[data-profile-dm="${CSS.escape(id)}"]`);if(d)d.onclick=()=>{closeModal();closeProfilePeek();openDm(id,{suppressProfile:true});};
    const f=$(`[data-profile-friend="${CSS.escape(id)}"]`);if(f)f.onclick=async()=>{if(isFriend(id))removeFriend(id);else await sendFriendRequest(id);openProfileModal(id);};
    const b=$(`[data-profile-block="${CSS.escape(id)}"]`);if(b)b.onclick=async()=>{if(isBlocked(id))await unblockUser(id);else await blockUser(id);openProfileModal(id);};
    const ig=$(`[data-profile-ignore="${CSS.escape(id)}"]`);if(ig)ig.onclick=async()=>{if(isIgnored(id))await unignoreUser(id);else await ignoreUser(id);openProfileModal(id);};
    const e=$('[data-profile-edit]');if(e)e.onclick=()=>openEditProfile();
  }
  function removeFriend(id){const f=findFriend(id);if(f){state.friends=state.friends.filter(x=>x!==f);save();showToast('Amigo removido.');renderHome();renderDms();if(socialReady())socialRequest(`/api/friends/${encodeURIComponent(id)}`,{method:'DELETE'}).catch(()=>{});}}
  async function blockUser(id){
    if(id==='user-lola'||id===state.currentAccountId)return;
    if(!confirm(`Bloquear ${getProfile(id)?.username||'este usuário'}? A amizade será removida e, após desbloquear, será necessário enviar um novo pedido.`))return;
    try{
      if(userControlsCloudReady())await cloudRequest(`/api/users/${encodeURIComponent(id)}/block`,{method:'POST',body:'{}'});
      state.blockedUsers=[...new Set([...(state.blockedUsers||[]),id])];
      state.ignoredUsers=(state.ignoredUsers||[]).filter(x=>x!==id);
      state.friends=(state.friends||[]).filter(f=>f.a!==id&&f.b!==id);
      state.requests=(state.requests||[]).filter(r=>r.from!==id&&r.to!==id);
      state.closedDms=state.closedDms||{};state.closedDms[dmKey(id)]=true;
      save();renderHome();renderDms();renderMessages();showToast('Usuário bloqueado.');
    }catch(err){showToast(err.message||'Não foi possível bloquear.');}
  }
  async function unblockUser(id){
    try{
      if(userControlsCloudReady())await cloudRequest(`/api/users/${encodeURIComponent(id)}/block`,{method:'DELETE'});
      state.blockedUsers=(state.blockedUsers||[]).filter(x=>x!==id);save();renderHome();renderDms();renderMessages();showToast('Usuário desbloqueado. Para voltar a ser amigo, envie um novo pedido.');
    }catch(err){showToast(err.message||'Não foi possível desbloquear.');}
  }
  async function ignoreUser(id){
    if(id==='user-lola'||id===state.currentAccountId||isBlocked(id))return;
    try{
      if(userControlsCloudReady())await cloudRequest(`/api/users/${encodeURIComponent(id)}/ignore`,{method:'POST',body:'{}'});
      state.ignoredUsers=[...new Set([...(state.ignoredUsers||[]),id])];save();renderDms();renderMessages();showToast('Mensagens desse usuário agora ficam ocultas.');
    }catch(err){showToast(err.message||'Não foi possível ignorar.');}
  }
  async function unignoreUser(id){
    try{
      if(userControlsCloudReady())await cloudRequest(`/api/users/${encodeURIComponent(id)}/ignore`,{method:'DELETE'});
      state.ignoredUsers=(state.ignoredUsers||[]).filter(x=>x!==id);save();renderDms();renderMessages();showToast('Mensagens desse usuário voltaram a aparecer.');
    }catch(err){showToast(err.message||'Não foi possível parar de ignorar.');}
  }
  function openProfileModal(id){const p=getProfile(id);if(!p){showToast('Perfil não encontrado.');return;}closeProfilePeek();showModal(p.id===state.currentAccountId?'Seu perfil':`Perfil de ${p.username}`,profilePeekHtml(p,{peek:false}));$('modalLayer')?.querySelector('.modal')?.classList.add('profile-full-modal');bindProfileActions(id);}
  function openEditProfile(){
    const p=currentUser(); if(!p)return;
    showModal('Editar perfil',`<div class="profile-edit-grid">
      <div class="edit-cover"><div class="edit-cover-preview" id="editCoverPreview" style="${p.banner?`background-image:url('${safeUrl(p.banner)}')`:''}"></div><label class="btn btn-ghost">Trocar banner<input id="editBannerFile" type="file" accept="image/*" hidden></label></div>
      <div class="edit-avatar-row"><div class="profile-avatar-large avatar-img" id="editAvatarPreview" style="${p.avatar?`background-image:url('${safeUrl(p.avatar)}')`:''}">${p.avatar?'':esc((p.username||'?')[0].toUpperCase())}</div><label class="btn btn-ghost">Trocar avatar<input id="editAvatarFile" type="file" accept="image/*" hidden></label></div>
      <label>Nome de usuário<input id="editUsername" value="${esc(p.username)}" maxlength="24"></label>
      <label>Bio<input id="editBio" value="${esc(p.bio||'')}" maxlength="160"></label>
      <label>Cor de destaque<input id="editAccent" type="color" value="${esc(p.accent||'#0066ff')}"></label>
    </div><div class="onboarding-actions"><button class="btn btn-ghost" id="editCancel">Cancelar</button><button class="btn btn-primary" id="editSave">Salvar alterações</button></div>`);
    let avatar=p.avatar||'',banner=p.banner||'';
    $('editAvatarFile').onchange=e=>readImage(e.target.files?.[0],u=>{avatar=u;$('editAvatarPreview').style.backgroundImage=`url('${u}')`;$('editAvatarPreview').textContent='';},{maxWidth:512,maxHeight:512,maxChars:420000});
    $('editBannerFile').onchange=e=>readImage(e.target.files?.[0],u=>{banner=u;$('editCoverPreview').style.backgroundImage=`url('${u}')`;},{maxWidth:1600,maxHeight:600,maxChars:700000});
    $('editCancel').onclick=closeModal;
    $('editSave').onclick=async()=>{
      const nu=$('editUsername').value.trim().replace(/\s+/g,'');
      if(!nu){showToast('Escolha um nome de usuário.');return;}
      if(allPeople().some(x=>x.id!==p.id&&usernameKey(x.username)===usernameKey(nu))){showToast('Esse nome de usuário já está em uso.');return;}
      p.username=nu;p.handle='@'+nu.toLowerCase();p.bio=$('editBio').value.trim();p.accent=$('editAccent').value;
      p.avatar=avatar;p.banner=banner;p.profileComplete=true;
      const account=state.accounts.find(a=>a.id===p.id);
      if(account)Object.assign(account,{username:p.username,handle:p.handle,bio:p.bio,accent:p.accent,avatar:p.avatar,banner:p.banner,profileComplete:true});
      state.profiles[p.id]={...p};saveNow();
      if(p.cloud){
        await syncCloudProfile(p,{profileComplete:true});
      }else if(backendOnline&&backendToken){
        try{
          const data=await backendRequest('/api/me',{method:'PATCH',body:JSON.stringify({username:p.username,bio:p.bio,accent:p.accent,avatar:p.avatar,banner:p.banner})});
          applyBackendUser(data.user);
        }catch(e){showToast('Salvo localmente.');}
      }
      closeModal();document.documentElement.style.setProperty('--accent',p.accent||'#0066ff');renderShell();openProfileModal(p.id);showToast('Perfil atualizado.');
    };
  }

  function openNotifications(){ showModal('Notificações',`<div class="notification-center">${state.lastNotifications.length?state.lastNotifications.map(n=>`<div class="notification-item ${n.unread?'unread':''}" data-notif="${n.id}"><strong>${esc(n.title)}</strong><p>${esc(n.body)}</p><p>${formatTime(n.time)}</p></div>`).join(''):'<div class="home-empty compact"><span>Sem notificações.</span></div>'}</div><div class="onboarding-actions"><button class="btn btn-ghost" id="markNotificationsRead">Marcar todas como lidas</button></div>`);state.lastNotifications.forEach(n=>n.unread=false);save();renderBadges();$('markNotificationsRead').onclick=()=>closeModal(); }
  function renderBadges(){
    const incoming=(state.requests||[]).filter(r=>r.to===state.currentAccountId&&r.status==='pending').length;
    const pending=(state.requests||[]).filter(r=>r.status==='pending'&&(r.to===state.currentAccountId||r.from===state.currentAccountId)).length;
    const requestBadge=$('requestBadge');
    if(requestBadge){requestBadge.hidden=incoming===0;requestBadge.textContent=incoming||'';}
    const requestNav=$('[data-home="requests"]');
    if(requestNav)requestNav.hidden=pending===0;
    const friendBadge=$('friendBadge');
    if(friendBadge){friendBadge.hidden=true;friendBadge.textContent='';}
    if(pending===0&&view.mode==='home'&&(view.home==='requests'||view.homeTab==='pending')){
      view.home='friends';view.homeTab='all';
    }
  }

  async function sendBetaFeedback(){if(!backendOnline||!backendToken){showToast('Conecte-se ao backend para enviar feedback.');return;}const category=prompt('Categoria: bug, suggestion, design, performance ou other','bug');if(!category)return;const description=prompt('Descreva o que aconteceu (mínimo 10 caracteres):');if(!description)return;try{const result=await backendRequest('/api/beta/feedback',{method:'POST',body:JSON.stringify({category:category.trim().toLowerCase(),description,appVersion:'1.0.0'})});showToast('Feedback registrado: '+result.feedback.id);}catch(err){showToast(err.message||'Não foi possível enviar feedback.');}}
  async function fetchCloudSettings({rerender=false,tab='account'}={}){
    if(!socialCloudReady())return state.cloudSettings;
    try{
      const data=await cloudRequest('/api/settings');
      if(data?.settings){state.cloudSettings={...state.cloudSettings,...data.settings};if(data.settings.theme)state.theme=data.settings.theme;if(data.settings.notificationsEnabled!==undefined)state.notificationsEnabled=!!data.settings.notificationsEnabled;if(data.settings.nativeNotifications!==undefined)state.nativeNotifications=!!data.settings.nativeNotifications;document.documentElement.dataset.compact=state.cloudSettings.compactMode?'1':'0';document.documentElement.dataset.reducedMotion=state.cloudSettings.reducedMotion?'1':'0';applyTheme();save();if(rerender)openAppSettings(tab);}
    }catch(err){console.warn('[Azurecord] Configurações cloud:',err.message);}
    return state.cloudSettings;
  }
  async function patchCloudSettings(patch){
    state.cloudSettings={...state.cloudSettings,...patch};save();
    if(!socialCloudReady())return state.cloudSettings;
    try{const data=await cloudRequest('/api/settings',{method:'PATCH',body:JSON.stringify(patch)});if(data?.settings){state.cloudSettings={...state.cloudSettings,...data.settings};save();}}catch(err){showToast(err.message||'Não foi possível salvar na nuvem.');}
    return state.cloudSettings;
  }
  function settingsToggleRow(id,title,desc,on){return `<div class="settings-option"><div><strong>${esc(title)}</strong><span>${esc(desc)}</span></div><button type="button" class="toggle ${on?'on':''}" id="${id}" aria-pressed="${on?'true':'false'}"><span></span></button></div>`;}
  function settingsWorkspace(title,nav,active,content,kind='app'){
    const layer=$('modalLayer');if(!layer)return;
    const user=currentUser();
    const avatarStyle=user?.avatar?`background-image:url('${safeUrl(user.avatar)}')`:'';
    layer.classList.add('settings-layer');
    layer.hidden=false;
    layer.innerHTML=`<div class="modal settings-modal settings-${kind}" role="dialog" aria-modal="true">
      <aside class="settings-sidebar">
        <div class="settings-account-card">
          <div class="settings-account-avatar avatar-img" style="${avatarStyle}">${user?.avatar?'':esc((user?.username||'A')[0])}</div>
          <div class="settings-account-copy"><strong>${esc(user?.username||'Azurecord')}</strong><span>${esc(user?.handle||'Configurações')}</span></div>
        </div>
        <label class="settings-search"><span>⌕</span><input id="settingsNavSearch" type="search" placeholder="Buscar" autocomplete="off"></label>
        <div class="settings-sidebar-title">${esc(title)}</div>
        <nav>${nav.map(item=>`<button type="button" class="settings-nav-item ${item.id===active?'active':''} ${item.danger?'danger':''}" data-settings-tab="${item.id}" data-settings-label="${esc(item.label.toLowerCase())}"><span class="settings-nav-icon">${item.icon||''}</span><span>${esc(item.label)}</span></button>`).join('')}</nav>
      </aside>
      <section class="settings-main">
        <header class="settings-main-head"><div><h2>${esc(nav.find(x=>x.id===active)?.label||title)}</h2><p>${esc(nav.find(x=>x.id===active)?.hint||'')}</p></div><button type="button" class="settings-close" id="modalClose" aria-label="Fechar">×</button></header>
        <div class="settings-scroll">${content}</div>
      </section>
    </div>`;
    $('modalClose').onclick=closeModal;
    layer.onclick=e=>{if(e.target===layer)closeModal();};
    const search=$('settingsNavSearch');
    if(search)search.oninput=()=>{
      const q=search.value.trim().toLowerCase();
      $('.settings-nav-item').forEach(btn=>btn.hidden=!!q&&!String(btn.dataset.settingsLabel||'').includes(q));
    };
  }
  const APP_SETTINGS_NAV=[
    {id:'account',label:'Minha conta',icon:'👤',hint:'Conta, identidade e acesso ao Azurecord.'},
    {id:'profile',label:'Perfil',icon:'🪪',hint:'Avatar, banner, bio e presença.'},
    {id:'security',label:'Senha e segurança',icon:'🔐',hint:'Senha e sessões conectadas.'},
    {id:'privacy',label:'Privacidade',icon:'🛡',hint:'Amizades, DMs, ignorados e bloqueados.'},
    {id:'notifications',label:'Notificações',icon:'🔔',hint:'Controle como o Azurecord chama sua atenção.'},
    {id:'appearance',label:'Aparência',icon:'🎨',hint:'Tema, destaque e densidade da interface.'},
    {id:'language',label:'Idioma',icon:'🌐',hint:'Idioma da interface.'},
    {id:'lola',label:'Lola / IA',icon:'🧠',hint:'Workers AI, memória e histórico da Lola.'},
    {id:'points',label:'AzurePoints',icon:'🪙',hint:'Carteira e histórico cloud.'},
    {id:'media',label:'Arquivos e mídia',icon:'📁',hint:'Preferências de anexos e mídia.'},
    {id:'calls',label:'Chamadas',icon:'📞',hint:'Preparação para AzureCall com WebRTC.'},
    {id:'advanced',label:'Avançado',icon:'⚙',hint:'Informações técnicas da instalação.'},
    {id:'danger',label:'Sair / Excluir conta',icon:'⚠',hint:'Ações da conta.',danger:true},
  ];
  function appSettingsContent(tab){
    const u=currentUser();const cs=state.cloudSettings||defaultState.cloudSettings;
    if(tab==='account')return `<div class="settings-section"><h3>Informações da conta</h3><div class="settings-info-grid"><div><span>Nome de usuário</span><strong>${esc(u?.username||'')}</strong></div><div><span>E-mail</span><strong>${esc(u?.email||'')}</strong></div><div><span>Conta</span><strong>${u?.cloud?'Azurecord Cloud':'Local'}</strong></div><div><span>ID</span><strong class="mono">${esc(u?.id||'')}</strong></div></div><div class="settings-actions"><button class="btn btn-primary" id="settingsEditProfile">Editar perfil</button><button class="btn btn-ghost" id="settingsCopyId">Copiar ID</button></div></div>`;
    if(tab==='profile')return `<div class="settings-section"><h3>Perfil</h3><div class="settings-profile-card"><div class="settings-profile-banner" style="${u?.banner?`background-image:url('${safeUrl(u.banner)}')`:''}"></div><div class="settings-profile-row"><div class="big-avatar avatar-img" style="${u?.avatar?`background-image:url('${safeUrl(u.avatar)}')`:''}">${u?.avatar?'':esc((u?.username||'?')[0])}</div><div><strong>${esc(u?.username||'')}</strong><span>${esc(u?.handle||'')}</span><p>${esc(u?.bio||'Sem bio.')}</p></div></div></div><div class="settings-actions"><button class="btn btn-primary" id="settingsOpenProfileEditor">Editar perfil completo</button></div><div class="settings-subsection"><h4>Presença</h4><div class="choice-row" id="presenceChoices">${['online','idle','dnd','offline'].map(x=>`<button class="choice-btn ${u?.status===x?'active':''}" data-settings-status="${x}">${statusLabel(x)}</button>`).join('')}</div></div></div>`;
    if(tab==='security')return `<div class="settings-section"><h3>Senha e segurança</h3><div class="settings-option"><div><strong>Senha</strong><span>Altere a senha da conta Cloud.</span></div><button class="home-mini-btn" id="settingsChangePassword">Alterar senha</button></div><div class="settings-option"><div><strong>Sessões conectadas</strong><span>Veja e encerre sessões em outros dispositivos.</span></div><button class="home-mini-btn" id="settingsLoadSessions">Carregar</button></div><div id="settingsSessions" class="settings-session-list"></div><div class="settings-actions"><button class="btn btn-ghost" id="settingsRevokeOthers">Sair de outros dispositivos</button></div></div>`;
    if(tab==='privacy')return `<div class="settings-section"><h3>Privacidade</h3>${settingsToggleRow('allowFriendsToggle','Pedidos de amizade','Permitir que outras contas enviem solicitações.',cs.allowFriendRequests!==false)}${settingsToggleRow('allowDmsToggle','DMs de amigos','Permitir mensagens diretas de pessoas adicionadas.',cs.allowDmsFromFriends!==false)}<div class="settings-split"><div><h4>Ignorados</h4><div class="settings-user-list">${(state.ignoredUsers||[]).map(id=>{const p=getProfile(id);return p?`<button data-settings-profile="${p.id}">${esc(p.username)}</button>`:''}).join('')||'<span class="muted">Ninguém ignorado.</span>'}</div></div><div><h4>Bloqueados</h4><div class="settings-user-list">${(state.blockedUsers||[]).map(id=>{const p=getProfile(id);return p?`<button data-settings-profile="${p.id}">${esc(p.username)}</button>`:''}).join('')||'<span class="muted">Ninguém bloqueado.</span>'}</div></div></div></div>`;
    if(tab==='notifications')return `<div class="settings-section"><h3>Notificações</h3>${settingsToggleRow('notifToggleV83','Notificações no app','Exibe alertas dentro do Azurecord.',state.notificationsEnabled!==false)}${settingsToggleRow('nativeToggleV83','Notificações do sistema','Usa notificações do Windows ou do navegador quando suportado.',state.nativeNotifications!==false)}</div>`;
    if(tab==='appearance')return `<div class="settings-section"><h3>Aparência</h3><div class="settings-option"><div><strong>Tema</strong><span>Escolha a aparência principal.</span></div><div class="choice-row"><button class="choice-btn ${state.theme==='dark'?'active':''}" data-theme-v83="dark">Escuro</button><button class="choice-btn ${state.theme==='light'?'active':''}" data-theme-v83="light">Claro</button></div></div><div class="settings-option"><div><strong>Cor de destaque</strong><span>Também aparece no seu perfil.</span></div><input id="settingsAccentV83" type="color" value="${esc(u?.accent||'#0066ff')}"></div>${settingsToggleRow('compactToggleV83','Modo compacto','Reduz espaços na interface.',!!cs.compactMode)}${settingsToggleRow('motionToggleV83','Reduzir movimento','Diminui animações da interface.',!!cs.reducedMotion)}</div>`;
    if(tab==='language')return `<div class="settings-section"><h3>Idioma</h3><div class="settings-option"><div><strong>Idioma do Azurecord</strong><span>Outros idiomas entram depois.</span></div><select id="languageV83"><option value="pt-BR" selected>Português (Brasil)</option></select></div></div>`;
    if(tab==='lola')return `<div class="settings-section"><h3>Lola / Workers AI</h3>${settingsToggleRow('lolaEnabledV83','Ativar Lola','Permite conversar com a assistente do Azurecord.',cs.lolaEnabled!==false)}${settingsToggleRow('lolaMemoryV83','Memória da Lola','Permite usar memória de contexto quando disponível.',cs.lolaMemoryEnabled!==false)}<div class="settings-option"><div><strong>Modelo</strong><span>${esc(cloudInfo?.capabilities?.lolaWorkersAI?'Cloudflare Workers AI ativo':'Workers AI indisponível')}</span></div><span class="pill">Llama 4 Scout</span></div><div class="settings-actions"><button class="btn btn-primary" id="openLolaFromSettings">Abrir Lola</button><button class="btn btn-ghost" id="newLolaFromSettings">Nova conversa</button></div></div>`;
    if(tab==='points')return `<div class="settings-section"><h3>AzurePoints</h3><div class="settings-feature-card"><strong>Carteira Cloud</strong><p>Saldo, histórico e loja usam sua conta Azurecord Cloud.</p><button class="btn btn-primary" id="openPointsSettings">Abrir AzurePoints</button></div></div>`;
    if(tab==='media')return `<div class="settings-section"><h3>Arquivos e mídia</h3>${settingsToggleRow('autoplayV83','Reprodução automática','Permite mídia compatível tocar automaticamente.',cs.mediaAutoplay!==false)}<div class="settings-feature-card"><strong>Uploads grandes</strong><p>A interface já está preparada para a futura migração para Cloudflare R2. Até essa etapa, os limites atuais continuam para não sobrecarregar o D1.</p></div></div>`;
    if(tab==='calls')return `<div class="settings-section"><h3>AzureCall</h3><div class="settings-feature-card"><strong>Chamadas estão no roadmap</strong><p>A futura implementação usará WebRTC para voz, vídeo e compartilhamento de tela, com sinalização Cloud.</p><div class="choice-row"><button class="choice-btn active" disabled>◉ Voz</button><button class="choice-btn" disabled>▣ Vídeo</button><button class="choice-btn" disabled>▤ Tela</button></div></div></div>`;
    if(tab==='advanced')return `<div class="settings-section"><h3>Avançado</h3><div class="settings-info-grid"><div><span>Azurecord</span><strong>Azurecord 1.0</strong></div><div><span>Worker</span><strong>${esc(cloudInfo?.version||'desconhecido')}</strong></div><div><span>Cloud API</span><strong class="mono">${esc(CLOUD_API_URL)}</strong></div><div><span>Ambiente</span><strong>${window.azurecordDesktop?.platform?'Desktop / Electron':'Web'}</strong></div></div><div class="settings-actions"><button class="btn btn-ghost" id="betaFeedbackBtnV83">Enviar feedback</button></div></div>`;
    return `<div class="settings-section danger-zone"><h3>Conta</h3><div class="settings-option"><div><strong>Sair</strong><span>Encerra esta sessão neste dispositivo.</span></div><button class="home-mini-btn" id="logoutV83">Sair</button></div><div class="settings-option danger"><div><strong>Excluir conta</strong><span>Remove permanentemente sua conta e dados Cloud.</span></div><button class="home-mini-btn danger" id="deleteAccountBtn">Excluir conta</button></div></div>`;
  }
  function bindAppSettings(tab){
    $$('[data-settings-tab]').forEach(b=>b.onclick=()=>openAppSettings(b.dataset.settingsTab));
    $('settingsEditProfile')?.addEventListener('click',()=>openProfileModal(state.currentAccountId));$('settingsOpenProfileEditor')?.addEventListener('click',()=>openProfileModal(state.currentAccountId));
    $('settingsCopyId')?.addEventListener('click',()=>{navigator.clipboard?.writeText(currentUser()?.id||'');showToast('ID copiado.');});
    $$('[data-settings-status]').forEach(b=>b.onclick=()=>{const u=currentUser();u.status=b.dataset.settingsStatus;save();scheduleCloudProfileSync(u,50);openAppSettings('profile');});
    $('settingsChangePassword')?.addEventListener('click',changePassword);
    $('settingsLoadSessions')?.addEventListener('click',loadSettingsSessions);$('settingsRevokeOthers')?.addEventListener('click',async()=>{try{await cloudRequest('/auth/sessions/revoke-others',{method:'POST',body:'{}'});showToast('Outras sessões encerradas.');loadSettingsSessions();}catch(err){showToast(err.message||'Falha ao encerrar sessões.');}});
    $('allowFriendsToggle')?.addEventListener('click',async()=>{await patchCloudSettings({allowFriendRequests:!(state.cloudSettings.allowFriendRequests!==false)});openAppSettings('privacy');});
    $('allowDmsToggle')?.addEventListener('click',async()=>{await patchCloudSettings({allowDmsFromFriends:!(state.cloudSettings.allowDmsFromFriends!==false)});openAppSettings('privacy');});
    $$('[data-settings-profile]').forEach(b=>b.onclick=()=>openProfileModal(b.dataset.settingsProfile));
    $('notifToggleV83')?.addEventListener('click',async()=>{state.notificationsEnabled=!state.notificationsEnabled;save();await patchCloudSettings({notificationsEnabled:state.notificationsEnabled});openAppSettings('notifications');});
    $('nativeToggleV83')?.addEventListener('click',async()=>{state.nativeNotifications=!state.nativeNotifications;save();await patchCloudSettings({nativeNotifications:state.nativeNotifications});openAppSettings('notifications');});
    $$('[data-theme-v83]').forEach(b=>b.onclick=async()=>{state.theme=b.dataset.themeV83;applyTheme();save();await patchCloudSettings({theme:state.theme});openAppSettings('appearance');});
    $('settingsAccentV83')?.addEventListener('input',e=>{const u=currentUser();u.accent=e.target.value;document.documentElement.style.setProperty('--accent',e.target.value);save();});$('settingsAccentV83')?.addEventListener('change',()=>scheduleCloudProfileSync(currentUser(),50));
    $('compactToggleV83')?.addEventListener('click',async()=>{await patchCloudSettings({compactMode:!state.cloudSettings.compactMode});document.documentElement.dataset.compact=state.cloudSettings.compactMode?'1':'0';openAppSettings('appearance');});
    $('motionToggleV83')?.addEventListener('click',async()=>{await patchCloudSettings({reducedMotion:!state.cloudSettings.reducedMotion});document.documentElement.dataset.reducedMotion=state.cloudSettings.reducedMotion?'1':'0';openAppSettings('appearance');});
    $('lolaEnabledV83')?.addEventListener('click',async()=>{await patchCloudSettings({lolaEnabled:!(state.cloudSettings.lolaEnabled!==false)});openAppSettings('lola');});
    $('lolaMemoryV83')?.addEventListener('click',async()=>{await patchCloudSettings({lolaMemoryEnabled:!(state.cloudSettings.lolaMemoryEnabled!==false)});openAppSettings('lola');});
    $('openLolaFromSettings')?.addEventListener('click',()=>{closeModal();openDm('user-lola',{suppressProfile:true});});$('newLolaFromSettings')?.addEventListener('click',()=>{closeModal();openDm('user-lola',{suppressProfile:true});setTimeout(()=>startNewLolaChat(),80);});
    $('openPointsSettings')?.addEventListener('click',()=>{closeModal();openAzurePoints();});
    $('autoplayV83')?.addEventListener('click',async()=>{await patchCloudSettings({mediaAutoplay:!(state.cloudSettings.mediaAutoplay!==false)});openAppSettings('media');});
    $('betaFeedbackBtnV83')?.addEventListener('click',sendBetaFeedback);$('logoutV83')?.addEventListener('click',logout);$('deleteAccountBtn')?.addEventListener('click',deleteAccount);
  }
  async function loadSettingsSessions(){
    const holder=$('settingsSessions');if(!holder)return;holder.innerHTML='<span class="muted">Carregando sessões...</span>';
    try{const data=await cloudRequest('/auth/sessions');holder.innerHTML=(data.sessions||[]).map(s=>`<div class="settings-session"><div><strong>${s.current?'Este dispositivo':'Sessão conectada'}</strong><span>Último uso: ${new Date(s.lastUsedAt||s.createdAt).toLocaleString('pt-BR')}</span></div>${s.current?'<span class="pill">Atual</span>':`<button class="home-mini-btn danger" data-revoke-session="${esc(s.id)}">Encerrar</button>`}</div>`).join('')||'<span class="muted">Nenhuma sessão encontrada.</span>';holder.querySelectorAll('[data-revoke-session]').forEach(b=>b.onclick=async()=>{try{await cloudRequest(`/auth/sessions/${encodeURIComponent(b.dataset.revokeSession)}`,{method:'DELETE'});loadSettingsSessions();}catch(err){showToast(err.message||'Falha ao encerrar sessão.');}});}catch(err){holder.innerHTML=`<span class="danger-text">${esc(err.message||'Falha ao carregar sessões.')}</span>`;}
  }
  function openAppSettings(tab='account'){
    settingsWorkspace('Configurações',APP_SETTINGS_NAV,tab,appSettingsContent(tab),'app');bindAppSettings(tab);
    if(socialCloudReady())fetchCloudSettings({rerender:false,tab}).catch(()=>{});
    if(tab==='security')setTimeout(loadSettingsSessions,50);
  }
  function openSettings(){openAppSettings('account');}

  async function changePassword(){const oldp=prompt('Senha atual:');if(!oldp)return;const np=prompt('Nova senha (mín. 8 caracteres):');if(!np||np.length<8){showToast('A nova senha precisa ter pelo menos 8 caracteres.');return;}if(currentUser()?.cloud){try{await cloudRequest('/auth/password',{method:'POST',body:JSON.stringify({currentPassword:oldp,newPassword:np})});showToast('Senha cloud alterada.');return;}catch(err){if(err.status===404)showToast('Seu Worker Cloud está desatualizado. Implante cloud/worker-v0.4.js.');else showToast(err.message||'Não foi possível alterar a senha.');return;}}showToast('Este perfil não usa senha cloud.');}
  function toggleTheme(){state.theme=state.theme==='dark'?'light':'dark';applyTheme();save();showToast(`Tema ${state.theme==='dark'?'escuro':'claro'} ativado.`);}
  function applyTheme(){document.documentElement.dataset.theme=state.theme;document.documentElement.style.setProperty('--accent',currentUser()?.accent||state.accent);localStorage.setItem(THEME_KEY,state.theme);}

  function openGlobalSearch(){ showModal('Busca global',`<div class="search-box"><input id="globalSearchInput" placeholder="Usuários, servidores, mensagens..."><button class="btn btn-primary" id="globalSearchGo">Buscar</button></div><div id="globalResults" class="result-list"></div>`);$('globalSearchGo').onclick=runGlobalSearch;$('globalSearchInput').onkeydown=e=>{if(e.key==='Enter')runGlobalSearch();}; }
  function runGlobalSearch(){const q=usernameKey($('globalSearchInput').value);const holder=$('globalResults');if(!q){holder.innerHTML='';return;}const userResults=allPeople().filter(p=>usernameKey(p.username).includes(q));const serverResults=state.servers.filter(s=>s.name.toLowerCase().includes(q));const channelResults=Object.entries(state.channelMessages).flatMap(([k,arr])=>arr.map(m=>({...m,key:k,source:'server'}))).filter(m=>String(m.text).toLowerCase().includes(q)).slice(0,8);const dmResults=Object.entries(state.dmMessages).flatMap(([key,arr])=>arr.map(m=>({...m,key,source:'dm'}))).filter(m=>String(m.text||'').toLowerCase().includes(q)).slice(0,8);const msgResults=[...channelResults,...dmResults].slice(0,14);holder.innerHTML=[...userResults.map(p=>`<div class="result-item"><span class="home-avatar avatar-img" style="${p.avatar?`background-image:url('${safeUrl(p.avatar)}')`:''}">${p.avatar?'':esc(p.username[0])}</span><div><strong>${esc(p.username)}</strong><p>${esc(p.handle)}</p></div><div class="spacer"></div><button class="home-mini-btn" data-g-user="${p.id}">Perfil</button></div>`),...serverResults.map(s=>`<div class="result-item"><span class="server">${esc(s.icon||'A')}</span><div><strong>${esc(s.name)}</strong><p>Servidor</p></div><div class="spacer"></div><button class="home-mini-btn" data-g-server="${s.id}">Abrir</button></div>`),...msgResults.map((m,i)=>`<div class="result-item" data-global-msg="${i}"><div><strong>${esc(getProfile(m.author)?.username||getProfile(m.senderId)?.username||'Usuário')}</strong><p>${esc(m.text)}</p></div><div class="spacer"></div><span class="pill">${m.source==='dm'?'DM':'Mensagem'}</span></div>`)].join('')||'<div class="home-empty compact"><span>Nenhum resultado.</span></div>';holder.querySelectorAll('[data-g-user]').forEach(b=>b.onclick=()=>{closeModal();openProfileModal(b.dataset.gUser)});holder.querySelectorAll('[data-g-server]').forEach(b=>b.onclick=()=>{closeModal();openServer(b.dataset.gServer)});holder.querySelectorAll('[data-global-msg]').forEach((b)=>b.onclick=()=>{const m=msgResults[Number(b.dataset.globalMsg)];closeModal();if(m?.source==='dm'){openDm(m.senderId===state.currentAccountId?m.recipientId:m.senderId);}else{const [serverId,channelId]=m.key.split('|');openServer(serverId);if(channelId)openChannel(channelId);}});}
  function openChannelSearch(){const msgs=getMessages();showModal('Buscar nesta conversa',`<div class="search-box"><input id="channelSearchInput" placeholder="Buscar mensagens..."><button class="btn btn-primary" id="channelSearchGo">Buscar</button></div><div id="channelResults" class="result-list"></div>`);$('channelSearchGo').onclick=()=>{const q=$('channelSearchInput').value.toLowerCase().trim();$('channelResults').innerHTML=msgs.filter(m=>m.text.toLowerCase().includes(q)).map(m=>`<div class="result-item"><div><strong>${esc(getProfile(m.author)?.username||'Usuário')}</strong><p>${esc(m.text)}</p></div><div class="spacer"></div><span class="pill">${formatTime(m.time)}</span></div>`).join('')||'<div class="home-empty compact"><span>Nenhuma mensagem encontrada.</span></div>';}; }

  function normalizeRemoteServer(data){
    const srv=data?.server||data;if(!srv?.id)return null;
    return {...srv,id:srv.id,backendId:srv.id,owner:srv.owner||srv.ownerId||state.currentAccountId,channels:(data?.channels||srv.channels||[]).map(c=>({id:c.id,backendId:c.id,serverId:srv.id,name:c.name,type:c.type,topic:c.topic||''}))};
  }
  async function joinServerByInvite(value,{closeAfter=true,fromLink=false}={}){
    const code=normalizeServerInvite(value);if(!code){showToast('Cole um link ou código de convite válido.');return false;}
    if(!socialCloudReady()){showToast('Entre na conta Cloud para entrar em servidores.');return false;}
    try{
      const data=await socialRequest('/api/servers/join',{method:'POST',body:JSON.stringify({code})});
      const remote=normalizeRemoteServer(data);if(!remote)throw new Error('O servidor não pôde ser carregado.');
      state.servers=mergeServers(state.servers,[remote]).filter(s=>s?.id!=='server-azurecord');save();persistServersNow();
      sendCloudRealtime({type:'account.commit',reason:'server.join'});sendCloudRealtime({type:'server.commit',serverId:remote.backendId||remote.id,reason:'member.join'});
      pendingInviteCode='';
      if(fromLink){try{const u=new URL(window.location.href);u.searchParams.delete('invite');history.replaceState({},'',u.toString());}catch{}}
      if(closeAfter)closeModal();openServer(remote.id);showToast(data.alreadyMember?'Servidor aberto.':'Você entrou no servidor.');return true;
    }catch(err){showToast(err.message||'Não foi possível entrar no servidor.');return false;}
  }
  async function consumePendingInviteLink(){if(inviteAutoJoinBusy||!pendingInviteCode||!socialCloudReady())return;inviteAutoJoinBusy=true;try{await joinServerByInvite(pendingInviteCode,{closeAfter:false,fromLink:true});}finally{inviteAutoJoinBusy=false;}}
  function openCreateServer(mode='create'){
    const joining=mode==='join';
    showModal('Servidores',`<div class="server-entry-tabs"><button type="button" class="server-entry-tab ${joining?'':'active'}" id="serverCreateTab">Criar servidor</button><button type="button" class="server-entry-tab ${joining?'active':''}" id="serverJoinTab">Entrar com link</button></div>${joining?`<div class="server-join-card"><h4>Entrar em um servidor</h4><p>Cole um link de convite ou o código.</p><input id="serverJoinLink" placeholder="https://.../?invite=ABC123 ou ABC123" autofocus><div class="onboarding-actions"><button class="btn btn-ghost" id="serverJoinCancel">Cancelar</button><button class="btn btn-primary" id="serverJoinConfirm">Entrar no servidor</button></div></div>`:`<div class="modal-grid"><label>Nome<input id="newServerName" placeholder="Meu servidor" maxlength="80" autofocus></label><label>Ícone do servidor<div class="server-icon-picker"><input id="newServerIcon" type="file" accept="image/*"><span class="tiny-note">Sem limite artificial de MB. O arquivo é enviado ao R2.</span></div></label></div><div id="newServerIconPreview" class="server-icon-preview" hidden></div><div id="newServerUploadState" class="tiny-note"></div><div class="onboarding-actions"><button type="button" class="btn btn-ghost" id="createServerCancel">Cancelar</button><button type="button" class="btn btn-primary" id="createServerConfirm">Criar servidor</button></div>`}`);
    $('serverCreateTab').onclick=()=>openCreateServer('create');$('serverJoinTab').onclick=()=>openCreateServer('join');
    if(joining){
      $('serverJoinCancel').onclick=closeModal;
      $('serverJoinConfirm').onclick=async()=>{const b=$('serverJoinConfirm');b.disabled=true;try{await joinServerByInvite($('serverJoinLink').value,{closeAfter:true});}finally{if($('serverJoinConfirm'))$('serverJoinConfirm').disabled=false;}};
      $('serverJoinLink').onkeydown=e=>{if(e.key==='Enter')$('serverJoinConfirm').click();};return;
    }
    let iconFile=null,previewUrl='';
    $('newServerIcon').onchange=e=>{if(previewUrl)try{URL.revokeObjectURL(previewUrl);}catch{};iconFile=e.target.files?.[0]||null;previewUrl=iconFile?URL.createObjectURL(iconFile):'';const p=$('newServerIconPreview');if(p){p.hidden=!previewUrl;p.style.backgroundImage=previewUrl?`url('${previewUrl}')`:'';}if(iconFile)$('newServerUploadState').textContent=`${iconFile.name} • ${formatFileSize(iconFile.size)}`;};
    $('createServerCancel').onclick=()=>{if(previewUrl)try{URL.revokeObjectURL(previewUrl);}catch{};closeModal();};
    $('createServerConfirm').onclick=async()=>{
      const b=$('createServerConfirm');if(b.disabled)return;const name=$('newServerName').value.trim()||'Novo servidor';
      if(!socialCloudReady()){showToast('Entre na conta Cloud para criar um servidor sincronizado.');return;}
      b.disabled=true;b.textContent='Criando...';
      try{
        let iconUrl='';
        if(iconFile){$('newServerUploadState').textContent='Enviando ícone para o R2...';const up=await uploadAttachmentInChunks({id:uid('server-icon'),name:iconFile.name,size:iconFile.size,type:iconFile.type||'image/*',_file:iconFile,visual:{kind:'server-icon'}});iconUrl=up.url||'';}
        const data=await socialRequest('/api/servers',{method:'POST',body:JSON.stringify({name,icon:name[0]||'S',iconUrl})});
        const remote=normalizeRemoteServer(data);if(!remote)throw new Error('Resposta Cloud incompleta.');
        state.servers=mergeServers(state.servers,[remote]);state.roles[remote.id]=state.roles[remote.id]||{};state.roles[remote.id][state.currentAccountId]='Admin';save();persistServersNow();
        sendCloudRealtime({type:'account.commit',reason:'server.create'});sendCloudRealtime({type:'server.commit',serverId:remote.backendId||remote.id,reason:'server.create'});
        if(previewUrl)try{URL.revokeObjectURL(previewUrl);}catch{};closeModal();openServer(remote.id);addNotification('Servidor criado',`Seu servidor ${name} está pronto.`);showToast(`Servidor "${name}" criado.`);
      }catch(err){showToast(err.message||'Não foi possível criar o servidor.');b.disabled=false;b.textContent='Criar servidor';}
    };
  }

  function openCreateChannel(type){
    showModal(type==='voice'?'Criar canal de voz':'Criar canal de texto',`<label>Nome do canal<input id="newChannelName" placeholder="novo-canal" maxlength="80"></label><div class="onboarding-actions"><button class="btn btn-ghost" id="ccCancel">Cancelar</button><button class="btn btn-primary" id="ccConfirm">Criar canal</button></div>`);
    $('ccCancel').onclick=closeModal;
    $('ccConfirm').onclick=async()=>{
      const s=getServer(view.serverId); if(!s)return;
      const name=$('newChannelName').value.trim()||`novo-${type}`;
      const channel={id:uid('channel'),backendId:null,serverId:s.id,name,type,topic:type==='voice'?'Canal de voz criado por você.':'Novo canal de texto.'};
      s.channels=Array.isArray(s.channels)?s.channels:[];
      s.channels.push(channel);
      save();persistServersNow();closeModal();
      if(type==='text')view.channelId=channel.id;
      renderShell();
      showToast(`${type==='voice'?'Canal de voz':'Canal #'+name} criado.`);
      if(socialReady()&&s.backendId){
        try{
          const data=await socialRequest(`/api/servers/${encodeURIComponent(s.backendId)}/channels`,{method:'POST',body:JSON.stringify({name,type,topic:channel.topic})});
          if(data?.channel){channel.backendId=data.channel.id;save();persistServersNow();sendCloudRealtime({type:'server.commit',serverId:s.backendId||s.id,reason:'channel.create'});}
        }catch(err){console.warn('[Azurecord] Canal salvo localmente; sincronização remota falhou:',err);}
      }
    };
  }
  function openChannelContextMenu(ev,channelId){
    ev.preventDefault(); ev.stopPropagation(); hideContext();
    const s=getServer(view.serverId); const c=getChannel(view.serverId,channelId);
    if(!s||!c||c.type!=='text')return;
    view.contextChannelId=channelId;
    const textChannels=s.channels.filter(x=>x.type==='text');
    const index=textChannels.findIndex(x=>x.id===channelId);
    const canManage=canManageServer(s);
    const canDelete=canManage && textChannels.length>1;
    const box=$('contextMenu');
    box.innerHTML=`<div class="context-section"><div class="context-heading">CANAL #${esc(c.name||'canal')}</div><button class="context-item" data-channel-context="up" ${(!canManage||index<=0)?'disabled':''}>↑ Mover para cima</button><button class="context-item" data-channel-context="down" ${(!canManage||index===textChannels.length-1)?'disabled':''}>↓ Mover para baixo</button></div><div class="context-section"><button class="context-item danger" data-channel-context="delete" ${canDelete?'':'disabled'}>🗑 Excluir canal</button></div>`;
    box.hidden=false;
    box.style.left=Math.min(ev.clientX,window.innerWidth-250)+'px'; box.style.top=Math.min(ev.clientY,window.innerHeight-180)+'px';
    box.querySelectorAll('[data-channel-context]').forEach(b=>{b.onclick=()=>channelContextAction(b.dataset.channelContext,channelId);});
  }
  async function syncChannelOrder(s){
    if(!socialReady()||!s?.backendId)return;
    const order=s.channels.map(c=>c.backendId).filter(Boolean);
    if(!order.length)return;
    try{await socialRequest(`/api/servers/${encodeURIComponent(s.backendId)}/channels/reorder`,{method:'PATCH',body:JSON.stringify({order})});}
    catch(err){console.warn('[Azurecord] Falha ao sincronizar ordem dos canais:',err);}
  }
  async function channelContextAction(action,id){
    const s=getServer(view.serverId); const c=getChannel(view.serverId,id); hideContext();
    if(!s||!c||c.type!=='text')return;
    if(!canManageServer(s)){showToast('Você não tem permissão para gerenciar este canal.');return;}
    const textChannels=s.channels.filter(x=>x.type==='text'); const pos=textChannels.findIndex(x=>x.id===id);
    if(action==='delete'){
      if(textChannels.length<=1){showToast('O servidor precisa manter pelo menos um canal de texto.');return;}
      if(!confirm(`Excluir o canal #${c.name}?`))return;
      s.channels=s.channels.filter(x=>x.id!==id);
      delete state.channelMessages[`${s.id}|${id}`];
      if(view.channelId===id){const next=s.channels.find(x=>x.type==='text');view.channelId=next?.id||null;}
      save();persistServersNow();renderShell();showToast(`#${c.name} excluído.`);
      if(socialReady()&&s.backendId&&c.backendId){
        try{await socialRequest(`/api/servers/${encodeURIComponent(s.backendId)}/channels/${encodeURIComponent(c.backendId)}`,{method:'DELETE'});sendCloudRealtime({type:'server.commit',serverId:s.backendId||s.id,reason:'channel.delete'});}
        catch(err){showToast('Canal excluído localmente; sincronização falhou.');console.warn(err);}
      }
      return;
    }
    if(action==='up'||action==='down'){
      const targetPos=action==='up'?pos-1:pos+1; if(targetPos<0||targetPos>=textChannels.length)return;
      const a=textChannels[pos], b=textChannels[targetPos];
      const ia=s.channels.findIndex(x=>x.id===a.id), ib=s.channels.findIndex(x=>x.id===b.id); if(ia<0||ib<0)return;
      [s.channels[ia],s.channels[ib]]=[s.channels[ib],s.channels[ia]];
      save();persistServersNow();renderServerChannels();showToast(`#${c.name} movido ${action==='up'?'para cima':'para baixo'}.`);
      await syncChannelOrder(s);
    }
  }
  function openInvite(){const s=getServer(view.serverId);if(!s)return;const link=serverInviteLink(s.invite);showModal('Convidar pessoas',`<p class="muted">Compartilhe o link. No Desktop, também dá para colar esse link na tela de servidores.</p><div class="invite-link-card"><a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a><span>Código: <b class="mono">${esc(s.invite)}</b></span></div><div class="onboarding-actions"><button class="btn btn-ghost" id="copyInviteCode">Copiar código</button><button class="btn btn-primary" id="copyInviteLink">Copiar link</button></div>`);$('copyInviteCode').onclick=()=>{navigator.clipboard?.writeText(s.invite);showToast('Código copiado.');};$('copyInviteLink').onclick=()=>{navigator.clipboard?.writeText(link);showToast('Link de convite copiado.');};}
  function getServerRole(server,userId=state.currentAccountId){
    const s=typeof server==='string'?getServer(server):server;
    if(!s||!userId)return 'Membro';
    if(s.owner===userId)return 'Admin';
    return state.roles?.[s.id]?.[userId] || s.myRole || 'Membro';
  }
  function canManageServer(server){ const s=typeof server==='string'?getServer(server):server; return !!s && (s.owner===state.currentAccountId || getServerRole(s,state.currentAccountId)==='Admin'); }
  function openRoleManager(){const s=getServer(view.serverId);if(!s)return;const members=[currentUser(),...DEMO_USERS.filter(x=>x.id!==currentUser()?.id)];state.roles[s.id]=state.roles[s.id]||{};if(s.owner===state.currentAccountId)state.roles[s.id][state.currentAccountId]='Admin';showModal('Cargos e permissões',`<p class="muted">Protótipo local: defina o cargo visual de cada membro deste servidor.</p><div class="setting-list">${members.filter(Boolean).map(p=>`<div class="setting-row"><div><strong>${esc(p.username)}</strong><span>${esc(p.handle)}</span></div><select data-role-user="${p.id}"><option ${((state.roles[s.id]||{})[p.id]||getServerRole(s,p.id))==='Admin'?'selected':''}>Admin</option><option ${((state.roles[s.id]||{})[p.id]||getServerRole(s,p.id))==='Moderador'?'selected':''}>Moderador</option><option ${((state.roles[s.id]||{})[p.id]||getServerRole(s,p.id))==='Membro'?'selected':''}>Membro</option></select></div>`).join('')}</div><p class="tiny-note">Permissões reais por canal entram quando houver backend.</p>`);$$('[data-role-user]').forEach(sel=>sel.onchange=()=>{state.roles[s.id]=state.roles[s.id]||{};state.roles[s.id][sel.dataset.roleUser]=sel.value;save();renderMemberPanel();});}
  const SERVER_SETTINGS_NAV=[
    {id:'profile',label:'Perfil do servidor',icon:'🏠',hint:'Nome, ícone, faixa e descrição.'},
    {id:'channels',label:'Canais',icon:'#',hint:'Crie e organize canais.'},
    {id:'members',label:'Membros',icon:'👥',hint:'Veja e gerencie pessoas do servidor.'},
    {id:'roles',label:'Cargos',icon:'🏷',hint:'Admin, moderador e membro.'},
    {id:'invites',label:'Convites',icon:'🔗',hint:'Crie, copie e revogue convites.'},
    {id:'access',label:'Acesso',icon:'🔐',hint:'Regras gerais de acesso.'},
    {id:'moderation',label:'Moderação',icon:'🛡',hint:'Ferramentas de segurança e moderação.'},
    {id:'integrations',label:'Integrações',icon:'🧩',hint:'Apps e integrações do servidor.'},
    {id:'audit',label:'Auditoria',icon:'📜',hint:'Registro administrativo.'},
    {id:'delete',label:'Excluir servidor',icon:'🗑',hint:'Zona de perigo.',danger:true},
  ];
  function serverSettingsContent(tab,s){
    const manager=canManageServer(s);const channels=s.channels||[];
    if(tab==='profile')return `<div class="settings-section"><h3>Perfil do servidor</h3><p class="muted">Personalize como o servidor aparece no Azurecord.</p><div class="server-settings-preview" style="--server-accent:${esc(s.accent||'#5865f2')}"><div class="server-settings-banner" style="${s.bannerUrl?`background-image:url('${safeUrl(s.bannerUrl)}')`:''}"></div><div class="server-settings-card-head"><div class="server-settings-icon" style="${s.iconUrl?`background-image:url('${safeUrl(s.iconUrl)}')`:''}">${s.iconUrl?'':esc(s.icon||s.name?.[0]||'S')}</div><div><strong>${esc(s.name)}</strong><span>${esc(s.description||'Comunidade do Azurecord.')}</span></div></div></div><div class="settings-form-grid"><label>Nome<input id="serverSettingsName" maxlength="80" value="${esc(s.name)}" ${manager?'':'disabled'}></label><label>Cor da faixa<input id="serverSettingsAccent" type="color" value="${esc(s.accent||'#5865f2')}" ${manager?'':'disabled'}></label><label class="span-2">Descrição<textarea id="serverSettingsDescription" maxlength="240" ${manager?'':'disabled'}>${esc(s.description||'')}</textarea></label><label>Ícone<input id="serverSettingsIconFile" type="file" accept="image/*" ${manager?'':'disabled'}></label><label>Faixa / banner<input id="serverSettingsBannerFile" type="file" accept="image/*" ${manager?'':'disabled'}></label></div><div class="settings-actions"><button class="btn btn-primary" id="saveServerProfile" ${manager?'':'disabled'}>Salvar alterações</button></div></div>`;
    if(tab==='channels')return `<div class="settings-section"><div class="settings-title-row"><div><h3>Canais</h3><p class="muted">${channels.length} canal(is)</p></div>${manager?'<div class="choice-row"><button class="btn btn-primary" id="serverAddText">+ Texto</button><button class="btn btn-ghost" id="serverAddVoice">+ Voz</button></div>':''}</div><div class="settings-list-cards">${channels.map(c=>`<div class="settings-list-card"><div><strong>${c.type==='voice'?'◉':'#'} ${esc(c.name)}</strong><span>${esc(c.topic||'Sem tópico')}</span></div>${manager?`<button class="home-mini-btn danger" data-settings-delete-channel="${esc(c.id)}">Excluir</button>`:''}</div>`).join('')}</div></div>`;
    if(tab==='members')return `<div class="settings-section"><h3>Membros</h3><div id="serverSettingsMembers"><span class="muted">Carregando membros...</span></div></div>`;
    if(tab==='roles')return `<div class="settings-section"><h3>Cargos</h3><p class="muted">Altere o cargo dos membros. O dono permanece Admin.</p><div id="serverSettingsRoles"><span class="muted">Carregando cargos...</span></div></div>`;
    if(tab==='invites')return `<div class="settings-section"><div class="settings-title-row"><div><h3>Convites</h3><p class="muted">Compartilhe códigos para outras pessoas entrarem.</p></div>${manager?'<button class="btn btn-primary" id="createServerInviteV83">Criar convite</button>':''}</div><div id="serverSettingsInvites"><span class="muted">Carregando convites...</span></div></div>`;
    if(tab==='access')return `<div class="settings-section"><h3>Acesso</h3><div class="settings-feature-card"><strong>Entrada por convite</strong><p>O Azurecord usa convites Cloud. Permissões por canal e regras avançadas entram junto da camada completa de cargos.</p></div></div>`;
    if(tab==='moderation')return `<div class="settings-section"><h3>Moderação</h3><div class="settings-feature-card"><strong>Bloqueio e controle de usuários já estão ativos</strong><p>Ferramentas específicas do servidor, como timeout, AutoMod e banimento, estão preparadas como próxima expansão.</p></div></div>`;
    if(tab==='integrations')return `<div class="settings-section"><h3>Integrações</h3><div class="settings-feature-card"><strong>Lola e AzurePoints</strong><p>Apps nativos do Azurecord já usam o backend Cloud. Integrações de terceiros entram depois.</p></div></div>`;
    if(tab==='audit')return `<div class="settings-section"><h3>Registro de auditoria</h3><div class="settings-feature-card"><strong>Em preparação</strong><p>O Worker ainda não grava um log administrativo completo. A interface já reserva esse espaço.</p></div></div>`;
    return `<div class="settings-section danger-zone"><h3>Excluir servidor</h3><p>Essa ação apaga o servidor Cloud e não pode ser desfeita.</p><label>Digite o nome do servidor<input id="deleteServerPhrase" placeholder="${esc(s.name)}"></label><div class="settings-actions"><button class="btn btn-danger" id="deleteServerV83" ${s.owner===state.currentAccountId?'':'disabled'}>Excluir servidor</button></div></div>`;
  }
  function openServerSettings(tab='profile'){
    const s=getServer(view.serverId);if(!s)return;settingsWorkspace(s.name,SERVER_SETTINGS_NAV,tab,serverSettingsContent(tab,s),'server');$$('[data-settings-tab]').forEach(b=>b.onclick=()=>openServerSettings(b.dataset.settingsTab));bindServerSettings(tab,s);
  }
  function bindServerSettings(tab,s){
    const manager=canManageServer(s);const sid=s.backendId||s.id;
    if(tab==='profile'&&manager){
      let iconFile=null,bannerFile=null,iconPreview='',bannerPreview='';
      $('serverSettingsIconFile')?.addEventListener('change',e=>{if(iconPreview)try{URL.revokeObjectURL(iconPreview);}catch{};iconFile=e.target.files?.[0]||null;iconPreview=iconFile?URL.createObjectURL(iconFile):'';const n=$('.server-settings-icon');if(n&&iconPreview){n.style.backgroundImage=`url('${iconPreview}')`;n.textContent='';}if(iconFile)showToast(`Ícone preparado • ${formatFileSize(iconFile.size)}`);});
      $('serverSettingsBannerFile')?.addEventListener('change',e=>{if(bannerPreview)try{URL.revokeObjectURL(bannerPreview);}catch{};bannerFile=e.target.files?.[0]||null;bannerPreview=bannerFile?URL.createObjectURL(bannerFile):'';const n=$('.server-settings-banner');if(n&&bannerPreview)n.style.backgroundImage=`url('${bannerPreview}')`;if(bannerFile)showToast(`Banner preparado • ${formatFileSize(bannerFile.size)}`);});
      $('saveServerProfile')?.addEventListener('click',async()=>{
        const b=$('saveServerProfile');b.disabled=true;b.textContent='Salvando...';
        try{
          let nextIcon=s.iconUrl||'',nextBanner=s.bannerUrl||'';
          if(iconFile){const up=await uploadAttachmentInChunks({id:uid('server-icon'),name:iconFile.name,size:iconFile.size,type:iconFile.type||'image/*',_file:iconFile,visual:{kind:'server-icon'}});nextIcon=up.url||nextIcon;}
          if(bannerFile){const up=await uploadAttachmentInChunks({id:uid('server-banner'),name:bannerFile.name,size:bannerFile.size,type:bannerFile.type||'image/*',_file:bannerFile,visual:{kind:'server-banner'}});nextBanner=up.url||nextBanner;}
          const patch={name:$('serverSettingsName').value.trim(),description:$('serverSettingsDescription').value.trim(),accent:$('serverSettingsAccent').value,iconUrl:nextIcon,bannerUrl:nextBanner,icon:s.icon||s.name?.[0]||'S'};if(!patch.name){showToast('Digite um nome.');return;}
          if(socialCloudReady()){const data=await cloudRequest(`/api/servers/${encodeURIComponent(sid)}`,{method:'PATCH',body:JSON.stringify(patch)});Object.assign(s,data.server||patch);}else Object.assign(s,patch);
          save();persistServersNow();sendCloudRealtime({type:'server.commit',serverId:sid,reason:'server.profile'});renderShell();renderServerRail();openServerSettings('profile');showToast('Servidor salvo.');
        }catch(err){showToast(err.message||'Falha ao salvar servidor.');}
        finally{if(iconPreview)try{URL.revokeObjectURL(iconPreview);}catch{};if(bannerPreview)try{URL.revokeObjectURL(bannerPreview);}catch{};}
      });
    }
    if(tab==='channels'){ $('serverAddText')?.addEventListener('click',()=>{closeModal();openCreateChannel('text');});$('serverAddVoice')?.addEventListener('click',()=>{closeModal();openCreateChannel('voice');});$$('[data-settings-delete-channel]').forEach(b=>b.onclick=async()=>{const id=b.dataset.settingsDeleteChannel;const c=getChannel(s.id,id);if(!c)return;if(c.type==='text'){await channelContextAction('delete',id);}else{if(!confirm(`Excluir o canal de voz ${c.name}?`))return;s.channels=s.channels.filter(x=>x.id!==id);save();persistServersNow();renderShell();if(socialCloudReady()&&s.backendId&&c.backendId){try{await cloudRequest(`/api/servers/${encodeURIComponent(s.backendId)}/channels/${encodeURIComponent(c.backendId)}`,{method:'DELETE'});}catch(err){showToast(err.message||'Falha ao excluir canal.');}}}setTimeout(()=>openServerSettings('channels'),80);});}
    if(tab==='members'||tab==='roles')loadServerSettingsMembers(s,tab==='roles');
    if(tab==='invites'){loadServerSettingsInvites(s);$('createServerInviteV83')?.addEventListener('click',async()=>{try{await cloudRequest(`/api/servers/${encodeURIComponent(sid)}/invites`,{method:'POST',body:'{}'});sendCloudRealtime({type:'server.commit',serverId:sid,reason:'invite.create'});loadServerSettingsInvites(s);showToast('Convite criado.');}catch(err){showToast(err.message||'Falha ao criar convite.');}});}
    $('deleteServerV83')?.addEventListener('click',async()=>{if($('deleteServerPhrase').value.trim()!==s.name){showToast('Digite o nome exato do servidor.');return;}try{if(socialCloudReady())await cloudRequest(`/api/servers/${encodeURIComponent(sid)}`,{method:'DELETE'});sendCloudRealtime({type:'account.commit',reason:'server.delete'});state.servers=state.servers.filter(x=>x.id!==s.id);save();persistServersNow();closeModal();openHome('friends');showToast('Servidor excluído.');}catch(err){showToast(err.message||'Falha ao excluir servidor.');}});
  }
  async function loadServerSettingsMembers(s,rolesMode=false){
    const holder=$(rolesMode?'serverSettingsRoles':'serverSettingsMembers');if(!holder)return;const sid=s.backendId||s.id;
    try{let members=[];if(socialCloudReady()){const data=await cloudRequest(`/api/servers/${encodeURIComponent(sid)}/members`);members=data.members||[];for(const m of members)hydrateRemoteUser(m);}else members=[currentUser(),...DEMO_USERS.filter(x=>x.id!==state.currentAccountId)].filter(Boolean);
      holder.innerHTML=members.map(m=>`<div class="settings-list-card"><div class="settings-user-line"><div class="mini-avatar avatar-img" style="${m.avatar?`background-image:url('${safeUrl(m.avatar)}')`:''}">${m.avatar?'':esc((m.username||'?')[0])}</div><div><strong>${esc(m.username)}</strong><span>${esc(m.handle||'')}</span></div></div>${rolesMode&&canManageServer(s)&&m.id!==s.owner?`<select data-server-role-user="${esc(m.id)}"><option ${m.serverRole==='Admin'?'selected':''}>Admin</option><option ${m.serverRole==='Moderador'?'selected':''}>Moderador</option><option ${!m.serverRole||m.serverRole==='Membro'?'selected':''}>Membro</option></select>`:`<span class="pill">${esc(m.serverRole||getServerRole(s,m.id))}</span>`}${!rolesMode&&canManageServer(s)&&m.id!==s.owner?`<button class="home-mini-btn danger" data-remove-server-member="${esc(m.id)}">Remover</button>`:''}</div>`).join('')||'<span class="muted">Nenhum membro.</span>';
      holder.querySelectorAll('[data-server-role-user]').forEach(sel=>sel.onchange=async()=>{try{if(socialCloudReady())await cloudRequest(`/api/servers/${encodeURIComponent(sid)}/members/${encodeURIComponent(sel.dataset.serverRoleUser)}`,{method:'PATCH',body:JSON.stringify({role:sel.value})});state.roles[s.id]=state.roles[s.id]||{};state.roles[s.id][sel.dataset.serverRoleUser]=sel.value;save();showToast('Cargo atualizado.');}catch(err){showToast(err.message||'Falha ao atualizar cargo.');}});
      holder.querySelectorAll('[data-remove-server-member]').forEach(btn=>btn.onclick=async()=>{if(!confirm('Remover este membro do servidor?'))return;try{if(socialCloudReady())await cloudRequest(`/api/servers/${encodeURIComponent(sid)}/members/${encodeURIComponent(btn.dataset.removeServerMember)}`,{method:'DELETE'});loadServerSettingsMembers(s,false);}catch(err){showToast(err.message||'Falha ao remover membro.');}});
    }catch(err){holder.innerHTML=`<span class="danger-text">${esc(err.message||'Falha ao carregar membros.')}</span>`;}
  }
  async function loadServerSettingsInvites(s){
    const holder=$('serverSettingsInvites');if(!holder)return;const sid=s.backendId||s.id;
    try{
      let invites=[];if(socialCloudReady()){const data=await cloudRequest(`/api/servers/${encodeURIComponent(sid)}/invites`);invites=data.invites||[];}else invites=s.invite?[{id:'local',code:s.invite,uses:0}]:[];
      holder.innerHTML=invites.map(i=>{const link=serverInviteLink(i.code);return `<div class="settings-list-card invite-settings-card"><div><strong class="mono">${esc(i.code)}</strong><span>${Number(i.uses||0)} uso(s)</span><a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a></div><div class="choice-row"><button class="home-mini-btn" data-copy-server-invite-link="${esc(i.code)}">Copiar link</button><button class="home-mini-btn ghost" data-copy-server-invite-code="${esc(i.code)}">Código</button>${i.id!=='local'&&canManageServer(s)?`<button class="home-mini-btn danger" data-revoke-server-invite="${esc(i.id)}">Revogar</button>`:''}</div></div>`;}).join('')||'<span class="muted">Nenhum convite.</span>';
      holder.querySelectorAll('[data-copy-server-invite-link]').forEach(b=>b.onclick=()=>{navigator.clipboard?.writeText(serverInviteLink(b.dataset.copyServerInviteLink));showToast('Link copiado.');});
      holder.querySelectorAll('[data-copy-server-invite-code]').forEach(b=>b.onclick=()=>{navigator.clipboard?.writeText(b.dataset.copyServerInviteCode);showToast('Código copiado.');});
      holder.querySelectorAll('[data-revoke-server-invite]').forEach(b=>b.onclick=async()=>{try{await cloudRequest(`/api/servers/${encodeURIComponent(sid)}/invites/${encodeURIComponent(b.dataset.revokeServerInvite)}`,{method:'DELETE'});sendCloudRealtime({type:'server.commit',serverId:sid,reason:'invite.revoke'});loadServerSettingsInvites(s);}catch(err){showToast(err.message||'Falha ao revogar convite.');}});
    }catch(err){holder.innerHTML=`<span class="danger-text">${esc(err.message||'Falha ao carregar convites.')}</span>`;}
  }
  function openServerMenu(){openServerSettings('profile');}


  function callKindLabel(kind){return kind==='video'?'vídeo':kind==='screen'?'compartilhamento de tela':'voz';}
  function callPeer(){return getProfile(activeCall?.peerId)||{username:'Usuário',avatar:''};}
  function outboundVideoTrack(call=activeCall){return call?.screenTrack||((call?.cameraTrack?.enabled!==false)?call?.cameraTrack:null)||null;}
  function getCallVideoSender(call=activeCall){
    if(!call?.pc)return null;
    return call.pc.getSenders().find(sender=>sender.track?.kind==='video')||call.pc.getTransceivers().find(t=>t.receiver?.track?.kind==='video'||t.sender?.track?.kind==='video')?.sender||null;
  }
  function setCallStatus(status){if(!activeCall)return;activeCall.status=status;updateCallUi();}
  function updateCallUi(){
    const overlay=$('callOverlay');if(!overlay)return;
    const call=activeCall;
    if(!call){overlay.hidden=true;return;}
    overlay.hidden=false;
    const peer=callPeer();
    $('callPeerName').textContent=peer.username||'Usuário';
    $('callTitle').textContent=call.direction==='incoming'&&call.status==='ringing'?`Chamada de ${callKindLabel(call.type)} recebida`:`AzureCall com ${peer.username||'Usuário'}`;
    $('callSubtitle').textContent=`Chamada privada • ${callKindLabel(call.type)} • WebRTC P2P`;
    const statusText={ringing:call.direction==='incoming'?'Quer falar com você':'Chamando…',connecting:'Conectando…',active:'Conectado',reconnecting:'Reconectando…'}[call.status]||'AzureCall';
    $('callStatusText').textContent=statusText;
    const avatar=$('callRemoteAvatar');
    avatar.textContent=peer.avatar?'':String(peer.username||'A')[0].toUpperCase();
    avatar.style.backgroundImage=peer.avatar?`url('${safeUrl(peer.avatar)}')`:'';
    const incoming=call.direction==='incoming'&&call.status==='ringing';
    $('callAcceptBtn').hidden=!incoming;$('callDeclineBtn').hidden=!incoming;
    $('callMicBtn').hidden=incoming;$('callCameraBtn').hidden=incoming;$('callShareBtn').hidden=incoming;$('callHangupBtn').hidden=incoming;
    const remote=$('remoteCallVideo');
    if(call.remoteStream&&remote.srcObject!==call.remoteStream)remote.srcObject=call.remoteStream;
    const remoteVideo=call.remoteStream?.getVideoTracks?.().find(t=>t.readyState==='live'&&!t.muted);
    remote.classList.toggle('audio-only',!remoteVideo);
    $('callRemoteFallback').hidden=!!remoteVideo;
    const localTrack=outboundVideoTrack(call);const local=$('localCallVideo');
    if(localTrack&&localTrack.readyState==='live'){const preview=new MediaStream([localTrack]);local.srcObject=preview;local.hidden=false;}else{local.srcObject=null;local.hidden=true;}
    const audio=call.localStream?.getAudioTracks?.()[0];$('callMicBtn').classList.toggle('off',!!audio&&!audio.enabled);
    $('callCameraBtn').classList.toggle('off',!call.cameraTrack||call.cameraTrack.enabled===false);
    $('callShareBtn').classList.toggle('off',!call.screenTrack);
  }
  function sendCallSignal(kind,payload={}){
    const call=activeCall;if(!call||!cloudRealtimeConnected())return false;
    return sendCloudRealtime({type:'call.signal',targetUserId:call.peerId,signal:{kind,callId:call.id,callType:call.type,...payload}});
  }
  function directCallSignal(targetUserId,signal){if(!cloudRealtimeConnected())return false;return sendCloudRealtime({type:'call.signal',targetUserId,signal});}
  async function acquireCallMedia(call,{incoming=false}={}){
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Este dispositivo não oferece acesso ao microfone/câmera.');
    const wantsCamera=call.type==='video';
    call.localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:wantsCamera});
    call.cameraTrack=call.localStream.getVideoTracks()[0]||null;
    if(call.type==='screen'&&!incoming){
      if(!navigator.mediaDevices.getDisplayMedia)throw new Error('Compartilhamento de tela não disponível neste dispositivo.');
      call.screenStream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
      call.screenTrack=call.screenStream.getVideoTracks()[0]||null;
      if(call.screenTrack)call.screenTrack.onended=()=>{if(activeCall===call)stopCallScreenShare().catch(()=>{});};
    }
  }
  function createCallPeer(call,{offerer=false}={}){
    if(call.pc)return call.pc;
    const pc=new RTCPeerConnection(AZURECALL_RTC_CONFIG);call.pc=pc;call.remoteStream=new MediaStream();
    pc.onicecandidate=e=>{if(e.candidate)sendCallSignal('ice',{candidate:e.candidate.toJSON?e.candidate.toJSON():e.candidate});};
    pc.ontrack=e=>{
      const stream=e.streams?.[0];
      if(stream){for(const track of stream.getTracks())if(!call.remoteStream.getTracks().some(t=>t.id===track.id))call.remoteStream.addTrack(track);}
      else if(e.track&&!call.remoteStream.getTracks().some(t=>t.id===e.track.id))call.remoteStream.addTrack(e.track);
      e.track.onunmute=updateCallUi;e.track.onmute=updateCallUi;e.track.onended=updateCallUi;updateCallUi();
    };
    pc.onconnectionstatechange=()=>{
      if(activeCall!==call)return;
      if(pc.connectionState==='connected')setCallStatus('active');
      else if(pc.connectionState==='disconnected')setCallStatus('reconnecting');
      else if(pc.connectionState==='failed')endActiveCall({notify:true,message:'A conexão da chamada falhou.'});
      else if(pc.connectionState==='closed')updateCallUi();
    };
    if(offerer)call.offerer=true;
    return pc;
  }
  function attachCallLocalTracks(call,{offerer=false}={}){
    if(!call?.pc||call.tracksAttached)return;
    for(const track of call.localStream?.getAudioTracks?.()||[])call.pc.addTrack(track,call.localStream);
    const video=outboundVideoTrack(call);
    if(video)call.pc.addTrack(video,call.screenStream||call.localStream);
    else if(offerer)call.pc.addTransceiver('video',{direction:'sendrecv'});
    call.tracksAttached=true;
  }
  async function flushCallIce(call){
    if(!call?.pc?.remoteDescription)return;
    const queued=call.pendingIce||[];call.pendingIce=[];
    for(const candidate of queued){try{await call.pc.addIceCandidate(candidate);}catch(err){console.warn('[AzureCall] ICE:',err?.message||err);}}
  }
  async function handleCallOffer(call,description){
    if(!call||!description)return;
    if(call.direction==='incoming'&&call.status==='ringing'){call.pendingOffer=description;return;}
    const pc=createCallPeer(call,{offerer:false});
    await pc.setRemoteDescription(description);
    attachCallLocalTracks(call,{offerer:false});
    await flushCallIce(call);
    const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
    sendCallSignal('answer',{description:pc.localDescription});
    setCallStatus('connecting');
  }
  async function renegotiateCall(){
    const call=activeCall;if(!call?.pc)return;
    const offer=await call.pc.createOffer();await call.pc.setLocalDescription(offer);sendCallSignal('offer',{description:call.pc.localDescription});
  }
  async function azureCallRealtimeHealth(){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),4500);
    try{
      const response=await fetch(`${CLOUD_REALTIME_URL}/health`,{cache:'no-store',signal:controller.signal});
      if(!response.ok)return {ok:false,status:response.status,version:null};
      const data=await response.json().catch(()=>({}));
      return {ok:data?.ok!==false,version:String(data?.version||''),service:String(data?.service||'')};
    }catch(err){
      return {ok:false,version:null,error:err?.name==='AbortError'?'timeout':(err?.message||'network_error')};
    }finally{clearTimeout(timer);}
  }
  function versionAtLeast(actual,minimum){
    const a=String(actual||'').split('.').map(n=>Number(n)||0),b=String(minimum||'').split('.').map(n=>Number(n)||0);
    for(let i=0;i<Math.max(a.length,b.length);i++){if((a[i]||0)>(b[i]||0))return true;if((a[i]||0)<(b[i]||0))return false;}
    return true;
  }
  async function ensureAzureCallRealtime(timeoutMs=8000){
    if(!socialCloudReady())return {ok:false,reason:'session'};
    const health=await azureCallRealtimeHealth();
    if(!health.ok)return {ok:false,reason:'health',health};
    if(!versionAtLeast(health.version,'1.3.0'))return {ok:false,reason:'version',health};
    if(cloudRealtimeConnected())return {ok:true,health};
    startCloudRealtimeSocket(true);
    const started=Date.now();let retried=false;
    while(Date.now()-started<timeoutMs){
      if(cloudRealtimeConnected())return {ok:true,health};
      if(typeof navigator!=='undefined'&&navigator.onLine===false)return {ok:false,reason:'offline',health};
      if(!retried&&Date.now()-started>3500&&(!cloudRealtimeSocket||cloudRealtimeSocket.readyState===WebSocket.CLOSED)){
        retried=true;startCloudRealtimeSocket(true);
      }
      await new Promise(resolve=>setTimeout(resolve,160));
    }
    return {ok:cloudRealtimeConnected(),reason:'socket',health};
  }
  function explainAzureCallRealtimeFailure(result){
    if(result?.reason==='offline')return 'Sem internet. Reconecte antes de iniciar a chamada.';
    if(result?.reason==='session')return 'Sua sessão Cloud não está pronta. Saia e entre novamente no Azurecord.';
    if(result?.reason==='version')return `Realtime Worker ${result.health?.version||'antigo'} detectado. Publique o Worker 1.3.0 para usar chamadas.`;
    if(result?.reason==='health')return 'O Realtime Worker não respondeu. Verifique o deploy do Cloudflare.';
    return 'O Realtime respondeu, mas o WebSocket não conectou. Tente novamente ou entre de novo na conta.';
  }
  async function startDmCall(type='voice'){
    if(view.mode!=='dm'||!view.dmUserId||view.dmUserId==='user-lola'){showToast('Abra uma DM com um amigo para iniciar uma chamada.');return;}
    if(!isFriend(view.dmUserId)){showToast('Chamadas estão disponíveis entre amigos.');return;}
    if(activeCall){showToast('Você já está em uma chamada.');return;}
    const realtime=await ensureAzureCallRealtime();
    if(!realtime.ok){showToast(explainAzureCallRealtimeFailure(realtime));return;}
    if(typeof RTCPeerConnection==='undefined'){showToast('WebRTC não está disponível neste dispositivo.');return;}
    const call={id:uid('call'),peerId:view.dmUserId,type,direction:'outgoing',status:'connecting',pc:null,localStream:null,remoteStream:null,cameraTrack:null,screenTrack:null,screenStream:null,pendingIce:[],pendingOffer:null,tracksAttached:false,ringTimer:null};
    activeCall=call;updateCallUi();
    try{
      await acquireCallMedia(call,{incoming:false});
      const pc=createCallPeer(call,{offerer:true});attachCallLocalTracks(call,{offerer:true});
      setCallStatus('ringing');
      if(!sendCallSignal('ring'))throw new Error('Realtime desconectado.');
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);sendCallSignal('offer',{description:pc.localDescription});
      call.ringTimer=setTimeout(()=>{if(activeCall===call&&call.status==='ringing')endActiveCall({notify:true,message:'A chamada não foi atendida.'});},45000);
    }catch(err){endActiveCall({notify:false});showToast(err.message||'Não foi possível iniciar a chamada.');}
  }
  async function acceptIncomingCall(){
    const call=activeCall;if(!call||call.direction!=='incoming'||call.status!=='ringing')return;
    clearTimeout(call.ringTimer);call.status='connecting';updateCallUi();
    try{
      await acquireCallMedia(call,{incoming:true});createCallPeer(call,{offerer:false});
      if(call.pendingOffer){const offer=call.pendingOffer;call.pendingOffer=null;await handleCallOffer(call,offer);}
      else setCallStatus('connecting');
    }catch(err){directCallSignal(call.peerId,{kind:'decline',callId:call.id,callType:call.type,reason:'media_error'});endActiveCall({notify:false});showToast(err.message||'Não foi possível acessar o microfone/câmera.');}
  }
  function declineIncomingCall(){
    const call=activeCall;if(!call)return;
    directCallSignal(call.peerId,{kind:'decline',callId:call.id,callType:call.type});endActiveCall({notify:false});
  }
  async function toggleCallMic(){const call=activeCall;const track=call?.localStream?.getAudioTracks?.()[0];if(!track)return;track.enabled=!track.enabled;updateCallUi();}
  async function toggleCallCamera(){
    const call=activeCall;if(!call?.pc)return;
    if(call.screenTrack){showToast('Pare o compartilhamento de tela antes de alternar a câmera.');return;}
    if(call.cameraTrack){call.cameraTrack.enabled=!call.cameraTrack.enabled;updateCallUi();return;}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:true});const track=stream.getVideoTracks()[0];if(!track)return;
      call.cameraTrack=track;if(!call.localStream)call.localStream=new MediaStream();call.localStream.addTrack(track);
      let sender=getCallVideoSender(call);
      if(sender)await sender.replaceTrack(track);else{call.pc.addTrack(track,call.localStream);await renegotiateCall();}
      track.onended=()=>{if(activeCall===call){call.cameraTrack=null;updateCallUi();}};updateCallUi();
    }catch(err){showToast('Não foi possível ligar a câmera.');}
  }
  async function stopCallScreenShare(){
    const call=activeCall;if(!call?.screenTrack)return;
    const old=call.screenTrack;call.screenTrack=null;try{old.stop();}catch{}
    if(call.screenStream){for(const t of call.screenStream.getTracks())if(t!==old)try{t.stop();}catch{}call.screenStream=null;}
    const sender=getCallVideoSender(call);if(sender)await sender.replaceTrack(call.cameraTrack?.enabled!==false?call.cameraTrack:null);
    updateCallUi();
  }
  async function toggleCallScreen(){
    const call=activeCall;if(!call?.pc)return;
    if(call.screenTrack){await stopCallScreenShare();return;}
    if(!navigator.mediaDevices?.getDisplayMedia){showToast('Compartilhamento de tela indisponível neste dispositivo.');return;}
    try{
      const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});const track=stream.getVideoTracks()[0];if(!track)return;
      call.screenStream=stream;call.screenTrack=track;let sender=getCallVideoSender(call);
      if(sender)await sender.replaceTrack(track);else{const transceiver=call.pc.addTransceiver('video',{direction:'sendrecv'});await transceiver.sender.replaceTrack(track);await renegotiateCall();}
      track.onended=()=>{if(activeCall===call)stopCallScreenShare().catch(()=>{});};updateCallUi();
    }catch(err){if(err?.name!=='NotAllowedError')showToast('Não foi possível compartilhar a tela.');}
  }
  function endActiveCall({notify=true,message=''}={}){
    const call=activeCall;if(!call)return;
    if(notify)sendCallSignal('hangup');
    clearTimeout(call.ringTimer);
    const tracks=new Set([...(call.localStream?.getTracks?.()||[]),...(call.screenStream?.getTracks?.()||[])]);for(const track of tracks)try{track.stop();}catch{}
    try{call.pc?.close();}catch{}
    const remote=$('remoteCallVideo'),local=$('localCallVideo');if(remote)remote.srcObject=null;if(local)local.srcObject=null;
    activeCall=null;updateCallUi();if(message)showToast(message);
  }
  async function handleCallSignalEvent(event){
    const from=String(event.fromUserId||''),signal=event.signal||{},kind=String(signal.kind||''),callId=String(signal.callId||'');
    if(!from||!callId)return;
    if(activeCall&&activeCall.id!==callId){
      if(kind==='ring'||kind==='offer')directCallSignal(from,{kind:'busy',callId,callType:signal.callType||'voice'});
      return;
    }
    if(!activeCall&&(kind==='ring'||kind==='offer')){
      if(!isFriend(from))return;
      activeCall={id:callId,peerId:from,type:['voice','video','screen'].includes(signal.callType)?signal.callType:'voice',direction:'incoming',status:'ringing',pc:null,localStream:null,remoteStream:null,cameraTrack:null,screenTrack:null,screenStream:null,pendingIce:[],pendingOffer:null,tracksAttached:false,ringTimer:null};
      activeCall.ringTimer=setTimeout(()=>{if(activeCall?.id===callId)declineIncomingCall();},45000);
      updateCallUi();showToast(`${getProfile(from)?.username||'Alguém'} está ligando…`);
      try{window.azurecordDesktop?.notify?.('AzureCall',`${getProfile(from)?.username||'Alguém'} está ligando para você.`);}catch{}
    }
    const call=activeCall;if(!call||call.id!==callId||call.peerId!==from)return;
    if(kind==='ring'){updateCallUi();return;}
    if(kind==='offer'){try{await handleCallOffer(call,signal.description);}catch(err){console.warn('[AzureCall] offer:',err);endActiveCall({notify:true,message:'A chamada não conseguiu conectar.'});}return;}
    if(kind==='answer'){try{if(call.pc){await call.pc.setRemoteDescription(signal.description);await flushCallIce(call);setCallStatus('connecting');}}catch(err){console.warn('[AzureCall] answer:',err);}return;}
    if(kind==='ice'){if(signal.candidate){if(call.pc?.remoteDescription){try{await call.pc.addIceCandidate(signal.candidate);}catch{}}else call.pendingIce.push(signal.candidate);}return;}
    if(kind==='decline'){endActiveCall({notify:false,message:'A chamada foi recusada.'});return;}
    if(kind==='busy'){endActiveCall({notify:false,message:'A pessoa já está em outra chamada.'});return;}
    if(kind==='hangup'){endActiveCall({notify:false,message:'A chamada foi encerrada.'});return;}
  }
  function openCallInfo(){showToast('Abra uma DM com um amigo para usar o AzureCall.');}
  async function openApps(){
    const aiLabel=cloudInfo?.capabilities?.lolaWorkersAI
      ? `Workers AI conectado • ${cloudInfo.version||'Worker Cloud'}`
      : 'Workers AI não detectado no Worker';
    showModal('Apps do Azurecord',`<div class="modal-grid"><div class="app-card"><strong>🧠 Lola IA</strong><p>${esc(aiLabel)}</p><button class="home-mini-btn" id="lolaAiSetup">Configurar</button></div><div class="app-card"><strong>🪙 AzurePoints</strong><p>Carteira, histórico, loja e solicitações de resgate.</p><button class="home-mini-btn" id="pointsApps">Abrir</button></div><div class="app-card"><strong>📊 Enquete</strong><p>Crie uma votação rápida no canal.</p><button class="home-mini-btn" id="createPollApp">Criar</button></div><div class="app-card"><strong>🕹 Mini-jogos</strong><p>Atividades rápidas para comunidades.</p><button class="home-mini-btn" type="button" disabled>Em breve</button></div><div class="app-card"><strong>🔔 Lembretes</strong><p>Organize avisos dentro do servidor.</p><button class="home-mini-btn" type="button" disabled>Em breve</button></div><div class="app-card"><strong>🧰 Utilidades</strong><p>Ferramentas básicas para moderadores.</p><button class="home-mini-btn" type="button" disabled>Em breve</button></div><div class="app-card"><strong>🔐 Códigos secretos</strong><p>Uma área escondida para experiências do app.</p><button class="home-mini-btn" id="secretCodesApp" type="button">Abrir</button></div></div>`);
    $('pointsApps')?.addEventListener('click',openAzurePoints);
    $('createPollApp')?.addEventListener('click',()=>{closeModal();openCreatePoll();});
    $('secretCodesApp')?.addEventListener('click',openSecretCodes);
    $('lolaAiSetup')?.addEventListener('click',openLolaAiSetup);
  }
  async function openAzurePoints(){
    if(!pointsCloudReady()){showModal('AzurePoints',`<div class="app-card"><strong>🪙 Sua carteira</strong><p>Entre na sua conta Cloud para carregar sua carteira AzurePoints.</p></div>`);return;}
    showModal('AzurePoints 🪙',`<div class="app-card">Carregando carteira Cloud...</div>`);
    try{
      const [result,shop,history,redemptions]=await Promise.all([
        cloudRequest('/api/points/wallet'),cloudRequest('/api/points/shop'),cloudRequest('/api/points/history'),cloudRequest('/api/points/redemptions')]);
      const w=result.wallet;
      const money=(cents)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
      const available=w.available,rate=result.pointsPerBRL;
      const shopContent=shop.items?.length ? shop.items.map(i=>`<li>${esc(i.name)}</li>`).join(''):'<div class="app-card"><strong>🏪 Loja vazia por enquanto</strong><p>Nenhum produto disponível nesta versão.</p></div>';
      const requested=redemptions.redemptions||[];
      showModal('AzurePoints 🪙',`<div class="points-panel"><div class="points-top"><small>SALDO CLOUD</small><h2 id="pointsWalletBalance">${available.toLocaleString('pt-BR')} AP</h2><p>Acumulados: ${w.earned.toLocaleString('pt-BR')} • Reservados: ${w.reserved.toLocaleString('pt-BR')}</p></div><h3>🏪 Loja</h3>${shopContent}
        <h3>💸 Resgate de pontos</h3><div class="app-card"><p>Resgates em dinheiro continuam desativados nesta versão. O saldo e o histórico ficam salvos no D1 Cloud.</p></div>
        <h3>📋 Histórico</h3><div class="points-scroll">${history.entries?.length?history.entries.slice(0,12).map(e=>`<div class="setting-row"><span>${esc(e.reason)}<small> ${new Date(e.createdAt).toLocaleDateString('pt-BR')}</small></span><strong>${e.delta>0?'+':''}${e.delta} AP</strong></div>`).join(''):'<p>Sem movimentações.</p>'}</div>
        <h3>📨 Solicitações anteriores</h3><div>${requested.length?requested.slice(0,10).map(r=>`<div class="setting-row"><span>${r.points} AP → ${money(r.amountCentavos)}<small> ${new Date(r.createdAt).toLocaleDateString('pt-BR')}</small></span><strong>${{pending:'Pendente',paid:'Pago',rejected:'Recusado'}[r.status]||esc(r.status)}</strong></div>`).join(''):'<p>Nenhuma solicitação.</p>'}</div></div>`);
    }catch(err){showModal('AzurePoints 🪙',`<div class="app-card"><p>Não foi possível buscar sua carteira Cloud: ${esc(err.message)}</p></div>`);}
  }
  function openLolaAiSetup(){
    const aiBound=!!cloudInfo?.capabilities?.lolaWorkersAI;
    const logged=!!(cloudToken&&cloudVerifiedAccountId===state.currentAccountId);
    const status=aiBound&&logged?'Conectada ao Workers AI ✅':aiBound?'Workers AI disponível; entre na conta Cloud.':'Binding AI não detectado no Worker.';
    showModal('Lola IA',`<div class="app-card"><strong>🧠 Lola no Cloudflare Workers AI</strong><p>${esc(status)}</p><p>A Lola agora usa o mesmo login Cloud do Azurecord. Não existe API key dentro do aplicativo e o backend Node local não é necessário para conversar com ela.</p><div class="setting-row"><span>Modelo</span><strong><code>@cf/meta/llama-4-scout-17b-16e-instruct</code></strong></div><div class="setting-row"><span>Worker</span><strong>${esc(cloudInfo?.version||'offline')}</strong></div><div class="setting-row"><span>Histórico</span><strong>${cloudInfo?.capabilities?.lolaCloudHistory?'D1 Cloud ✅':'indisponível'}</strong></div><p class="tiny-note">Se aparecer “Binding AI não detectado”, confirme no Cloudflare que existe <code>AI → Workers AI</code> e publique o <code>worker-v0.8.1.js</code>.</p><div class="onboarding-actions"><button class="btn btn-primary" id="aiSetupClose">Fechar</button></div></div>`);
    $('aiSetupClose').onclick=closeModal;
  }
  function openCreatePoll(){if(view.mode!=='server'){showToast('Abra um canal de servidor para criar uma enquete.');return;}showModal('Nova enquete',`<label>Pergunta<input id="pollQuestion" placeholder="O que vamos fazer hoje?"></label><label>Opção 1<input id="pollA" placeholder="Opção A"></label><label>Opção 2<input id="pollB" placeholder="Opção B"></label><div class="onboarding-actions"><button class="btn btn-ghost" id="pollCancel">Cancelar</button><button class="btn btn-primary" id="pollSend">Publicar</button></div>`);$('pollCancel').onclick=closeModal;$('pollSend').onclick=()=>{const q=$('pollQuestion').value.trim();const a=$('pollA').value.trim()||'Opção A';const b=$('pollB').value.trim()||'Opção B';if(!q){showToast('Digite uma pergunta.');return;}const arr=getMessages();arr.push({id:uid('poll'),author:state.currentAccountId,text:`📊 ${q}`,time:now(),poll:{question:q,options:[a,b],votes:[0,0]}});setMessages(arr);save();closeModal();renderMessages();showToast('Enquete publicada.');};}


  function showModal(title,body){
    const layer=$('modalLayer');
    if(!layer)return;
    layer.classList.remove('settings-layer');
    layer.hidden=false;
    layer.innerHTML=`<div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h3>${esc(title)}</h3><button type="button" class="icon-btn" id="modalClose" aria-label="Fechar">×</button></div><div class="modal-body">${body}</div></div>`;
    const closeBtn=$('modalClose');
    if(closeBtn)closeBtn.onclick=closeModal;
    layer.onclick=e=>{if(e.target===layer)closeModal();};
    requestAnimationFrame(()=>{
      const first=layer.querySelector('input,select,button,textarea');
      first?.focus?.();
    });
  }
  function closeModal(){
    const layer=$('modalLayer');
    if(!layer)return;
    layer.hidden=true;
    layer.classList.remove('settings-layer');
    layer.innerHTML='';
  }

  function renderServerChannels(){
    const text=$('textChannels');
    const voice=$('voiceChannels');
    if(!text||!voice)return;
    const s=getServer(view.serverId);
    if(view.mode!=='server'||!s){text.innerHTML='';voice.innerHTML='';return;}

    ensureServerChannels(s);
    const channels=Array.isArray(s.channels)?s.channels:[];
    const textChannels=channels.filter(c=>c&&c.type==='text');
    const voiceChannels=channels.filter(c=>c&&c.type==='voice');
    if(!view.channelId || !channels.some(c=>c.id===view.channelId && c.type==='text')){
      view.channelId=textChannels[0]?.id||channels[0]?.id||null;
    }
    text.innerHTML=textChannels.map(c=>`<button type="button" class="channel-item ${c.id===view.channelId?'active':''}" data-channel="${esc(c.id)}"><span>#</span>${esc(c.name||'canal')}<small>${state.unread?.[`${s.id}|${c.id}`]?'●':''}</small></button>`).join('')||'<div class="dm-empty">Nenhum canal de texto.</div>';
    voice.innerHTML=voiceChannels.map(c=>`<button type="button" class="channel-item ${c.id===view.channelId?'active':''}" data-voice-channel="${esc(c.id)}"><span>◉</span>${esc(c.name||'voz')}</button>`).join('')||'<div class="dm-empty">Nenhum canal de voz.</div>';
    text.querySelectorAll('[data-channel]').forEach(b=>{b.addEventListener('click',()=>openChannel(b.dataset.channel));b.addEventListener('contextmenu',e=>openChannelContextMenu(e,b.dataset.channel));});
    voice.querySelectorAll('[data-voice-channel]').forEach(b=>b.addEventListener('click',()=>showToast('Canal de voz disponível na interface. Chamadas de membros estão pausadas nesta versão.')));
  }

  function setAvatar(el,p,fallback){if(!el)return;el.classList.add('avatar-img');el.style.backgroundImage=p?.avatar?`url('${safeUrl(p.avatar)}')`:'';el.textContent=p?.avatar?'':((p?.username||fallback||'?')[0]||'?').toUpperCase();}
  function statusLabel(s){return ({online:'online',idle:'ausente',dnd:'não perturbe',offline:'offline'})[s]||'online';}
  function formatTime(t){return new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit'}).format(new Date(t));}
  let lolaCodeBuffer='';
  let lolaCodeTimer=null;
  function globalKeys(e){
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openGlobalSearch();}
    if(e.key==='Escape'){hideContext();closeModal();}
    const active=document.activeElement;
    const editable=active&&(active.tagName==='INPUT'||active.tagName==='TEXTAREA'||active.tagName==='SELECT'||active.isContentEditable);
    if(view.mode==='home'&&currentUser()&&!editable&&e.key.length===1&&/[a-z0-9]/i.test(e.key)){
      lolaCodeBuffer=(lolaCodeBuffer+e.key.toLowerCase()).slice(-8);
      clearTimeout(lolaCodeTimer);
      lolaCodeTimer=setTimeout(()=>{lolaCodeBuffer='';},1800);
      if(lolaCodeBuffer==='lola'){
        lolaCodeBuffer='';
        clearTimeout(lolaCodeTimer);
        unlockLolaSecret('home');
      }
    }
  }

  boot();
})();
