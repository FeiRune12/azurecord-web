'use strict';

// Extensões V52: canais compartilhados, convites, feedback e controle da memória.
// Nenhuma dependência externa. Os dados vivem no mesmo azurecord.json da V51.
const crypto = require('node:crypto');
const {grant} = require('./azure-points');
const MAX_TEXT = 6000;
const MAX_FILE_DATA_URL = 2 * 1024 * 1024;

function uid(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`; }
function cleanFiles(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 3) throw Object.assign(new Error('Envie no máximo três anexos.'), { status: 400, code: 'too_many_files' });
  return value.map(file => {
    const dataUrl = String(file?.dataUrl || '');
    if (dataUrl && (dataUrl.length > MAX_FILE_DATA_URL || !/^data:(image\/(png|jpeg|gif|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/i.test(dataUrl))) {
      throw Object.assign(new Error('Anexo inválido ou maior que 1,5 MB. Use PNG, JPG, GIF, WEBP ou PDF.'), { status: 413, code: 'invalid_attachment' });
    }
    return { name: String(file?.name || 'arquivo').slice(0, 120), type: String(file?.type || '').slice(0, 80), size: Number(file?.size) || 0, dataUrl };
  });
}
function channelMessage(m, author) {
  return { id: m.id, clientId: m.clientId || null, channelId: m.channelId, serverId: m.serverId,
    senderId: m.senderId, author: author || null, text: m.text, time: m.time,
    createdAt: m.createdAt, files: m.files || [], file: (m.files || [])[0] || null,
    replyTo: m.replyTo || null, edited: !!m.edited, deleted: !!m.deleted };
}
function membership(db, server, user) {
  return !!(server && (server.owner === user.id || db.memberships.some(m => m.serverId === server.id && m.userId === user.id)));
}
function error(res, json, status, code, message) { json(res, status, { error: code, message }); return true; }
async function handleV52({ backend, req, res, url, parts, user, json, readJson, publicUser }) {
  const db = backend.store.db;
  const route = parts.join('/');

  if (route === 'api/beta/status' && req.method === 'GET') {
    return json(res, 200, { version: '52.0.0-beta', online: true, feedback: true, channelSync: true, invites: true,
      aiConfigured: !!process.env.AZURECORD_OPENAI_API_KEY });
  }
  if (route === 'api/beta/feedback') {
    if (req.method === 'POST') {
      const body = await readJson(req, 20000);
      const category = String(body.category || '').trim();
      const description = String(body.description || '').trim();
      if (!['bug', 'suggestion', 'design', 'performance', 'other'].includes(category) || description.length < 10 || description.length > 4000) {
        return error(res, json, 400, 'validation', 'Selecione uma categoria e descreva em 10 a 4.000 caracteres.');
      }
      db.betaFeedback = Array.isArray(db.betaFeedback) ? db.betaFeedback : [];
      const feedback = { id: uid('fb'), userId: user.id, category, description,
        steps: String(body.steps || '').slice(0, 2000), appVersion: String(body.appVersion || '52').slice(0, 30),
        createdAt: new Date().toISOString(), status: 'new' };
      db.betaFeedback.push(feedback); backend.store.saveNow();
      // Recompensa limitada a um feedback elegível por dia UTC, mesmo se o usuário
      // enviar vários relatórios. Evita emissão ilimitada via endpoint público.
      const day=feedback.createdAt.slice(0,10);
      const reward=grant(backend,user.id,15,'feedback-beta',`feedback:${day}`,{feedbackId:feedback.id});
      return json(res, 201, { ok: true, feedback: { id: feedback.id, category, createdAt: feedback.createdAt }, azurePointsAwarded:reward.awarded?15:0 });
    }
    if (req.method === 'GET') {
      const admin = String(process.env.AZURECORD_BETA_ADMIN_EMAIL || '').trim().toLowerCase();
      if (!admin || user.email.toLowerCase() !== admin) return error(res, json, 403, 'forbidden', 'Área reservada ao administrador do beta.');
      return json(res, 200, { feedback: Array.isArray(db.betaFeedback) ? db.betaFeedback : [] });
    }
  }
  if (route === 'api/ai/memory') {
    if (req.method === 'GET') {
      const memory = db.aiMemories?.[user.id] || null;
      return json(res, 200, { memory });
    }
    if (req.method === 'DELETE') {
      if (db.aiMemories) delete db.aiMemories[user.id];
      backend.store.saveNow();
      return json(res, 200, { ok: true, cleared: true });
    }
  }
  if (route === 'api/servers/join' && req.method === 'POST') {
    const body = await readJson(req, 10000);
    const code = String(body.code || '').trim().toUpperCase();
    if (!code || code.length > 100) return error(res, json, 400, 'invalid_invite', 'Insira um código de convite válido.');
    const srv = db.servers.find(s => String(s.invite || '').trim().toUpperCase() === code);
    if (!srv) return error(res, json, 404, 'invite_not_found', 'Convite inexistente ou expirado.');
    const existed = membership(db, srv, user);
    if (!existed) { db.memberships.push({ serverId: srv.id, userId: user.id, role: 'Membro', createdAt: new Date().toISOString() }); backend.store.saveNow(); }
    const channels = db.channels.filter(c => c.serverId === srv.id);
    const server = { ...srv, myRole: srv.owner === user.id ? 'Admin' : db.memberships.find(m => m.serverId === srv.id && m.userId === user.id)?.role || 'Membro' };
    backend.emit(user.id, 'server.joined', { server, channels });
    for (const m of db.memberships.filter(m => m.serverId === srv.id && m.userId !== user.id)) backend.emit(m.userId, 'server.member_joined', { serverId: srv.id, user: publicUser(user) });
    return json(res, existed ? 200 : 201, { server, channels, alreadyMember: existed });
  }
  if (parts[1] === 'servers' && parts[2] && parts[3] === 'members' && req.method === 'GET') {
    const srv = db.servers.find(s => s.id === parts[2]);
    if (!srv) return error(res, json, 404, 'server_not_found', 'Servidor não encontrado.');
    if (!membership(db, srv, user)) return error(res, json, 403, 'forbidden', 'Você não participa deste servidor.');
    const members = db.memberships.filter(m => m.serverId === srv.id).map(m => {
      const u = db.users.find(u => u.id === m.userId);
      return u ? { ...publicUser(u), serverRole: u.id === srv.owner ? 'Admin' : m.role } : null;
    }).filter(Boolean);
    return json(res, 200, { members });
  }
  if (parts[1] === 'servers' && parts[2] && parts[3] === 'channels' && parts[4] && parts[5] === 'messages') {
    const srv = db.servers.find(s => s.id === parts[2]);
    const ch = db.channels.find(c => c.id === parts[4] && c.serverId === parts[2]);
    if (!srv || !ch) return error(res, json, 404, 'channel_not_found', 'Canal não encontrado.');
    if (!membership(db, srv, user)) return error(res, json, 403, 'forbidden', 'Entre no servidor para acessar o canal.');
    if (ch.type !== 'text') return error(res, json, 400, 'not_text_channel', 'Este canal não aceita mensagens de texto.');
    db.channelMessages = Array.isArray(db.channelMessages) ? db.channelMessages : [];
    const belongs = m => m.serverId === srv.id && m.channelId === ch.id && !m.deleted;
    if (req.method === 'GET') {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 100));
      const before = Number(url.searchParams.get('before')) || Infinity;
      const selected = db.channelMessages.filter(m => belongs(m) && m.time < before).slice(-limit);
      return json(res, 200, { messages: selected.map(m => channelMessage(m, publicUser(db.users.find(u => u.id === m.senderId)))) });
    }
    if (req.method === 'POST') {
      const body = await readJson(req, 8 * 1024 * 1024);
      const text = String(body.text || '').trim();
      const files = cleanFiles(body.files || (body.file ? [body.file] : []));
      if ((!text && !files.length) || text.length > MAX_TEXT) return error(res, json, 400, 'invalid_message', 'Mensagem vazia ou acima de 6.000 caracteres.');
      const clientId = String(body.clientId || '').trim().slice(0, 100);
      if (clientId) {
        const existing = db.channelMessages.find(m => m.channelId === ch.id && m.senderId === user.id && m.clientId === clientId);
        if (existing) return json(res, 200, { message: channelMessage(existing, publicUser(user)), duplicate: true });
      }
      const message = { id: uid('chmsg'), clientId, channelId: ch.id, serverId: srv.id, senderId: user.id,
        text, files, time: Date.now(), createdAt: new Date().toISOString(), replyTo: body.replyTo || null, edited: false, deleted: false };
      db.channelMessages.push(message); backend.store.saveNow();
      const publicMsg = channelMessage(message, publicUser(user));
      for (const m of db.memberships.filter(m => m.serverId === srv.id && m.userId !== user.id)) backend.emit(m.userId, 'channel.message', { message: publicMsg });
      return json(res, 201, { message: publicMsg });
    }
  }
  return false;
}
module.exports = { handleV52, channelMessage, cleanFiles };
