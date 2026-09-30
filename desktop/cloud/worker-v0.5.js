const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

const PASSWORD_ITERATIONS = 100000;
const MAX_AVATAR_CHARS = 450000;
const MAX_BANNER_CHARS = 750000;
const schemaReadyFor = new WeakSet();

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  let base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256Base64Url(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToBase64Url(new Uint8Array(digest));
}

async function hashPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PASSWORD_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );

  return [
    "pbkdf2-sha256",
    PASSWORD_ITERATIONS,
    bytesToBase64Url(salt),
    bytesToBase64Url(new Uint8Array(derived)),
  ].join("$");
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifyPassword(password, storedHash) {
  try {
    const parts = String(storedHash || "").split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;

    const iterations = Number(parts[1]);
    const salt = base64UrlToBytes(parts[2]);
    const expected = base64UrlToBytes(parts[3]);

    if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 500000) return false;

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const derived = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      keyMaterial,
      expected.length * 8
    );

    return constantTimeEqual(new Uint8Array(derived), expected);
  } catch {
    return false;
  }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}


async function tableColumns(env, table) {
  try {
    const result = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    return new Set((result.results || []).map(row => String(row.name)));
  } catch {
    return new Set();
  }
}

async function addColumnIfMissing(env, table, column, definition) {
  const columns = await tableColumns(env, table);
  if (!columns.has(column)) {
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

async function ensureSocialSchema(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS dm_hidden (
      user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      hidden_at TEXT NOT NULL,
      PRIMARY KEY (user_id, conversation_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE
    )
  `).run();

  await addColumnIfMissing(env, "messages", "client_id", "TEXT");
  await addColumnIfMissing(env, "messages", "recipient_id", "TEXT");
  await addColumnIfMissing(env, "messages", "files_json", "TEXT");
  await addColumnIfMissing(env, "messages", "reply_json", "TEXT");
  await addColumnIfMissing(env, "channel_messages", "client_id", "TEXT");
  await addColumnIfMissing(env, "channel_messages", "files_json", "TEXT");
  await addColumnIfMissing(env, "channel_messages", "reply_json", "TEXT");
  await addColumnIfMissing(env, "channels", "topic", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(env, "servers", "icon", "TEXT");
}

function parseJsonValue(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function cleanText(value, max = 6000) {
  return String(value || "").trim().slice(0, max);
}

function cleanFiles(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map(file => ({
    name: String(file?.name || "arquivo").slice(0, 120),
    type: String(file?.type || "").slice(0, 80),
    size: Math.max(0, Number(file?.size) || 0),
    dataUrl: String(file?.dataUrl || "").slice(0, 750000),
  }));
}

function socialUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    handle: `@${String(user.username || "usuario").toLowerCase()}`,
    bio: user.bio || "",
    accent: user.accent || "#0066ff",
    status: user.status || "offline",
    avatar: user.avatarUrl || "",
    avatarUrl: user.avatarUrl || "",
    banner: user.bannerUrl || "",
    bannerUrl: user.bannerUrl || "",
    personality: user.personality || "Usuário do Azurecord.",
    profileComplete: !!user.profileComplete,
    memberSince: new Date(user.createdAt || Date.now()).toLocaleDateString("pt-BR"),
    role: "Membro",
    badge: "",
    accountType: "cloud",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function socialUserById(env, id) {
  return socialUser(await readUserById(env, id));
}

async function requireSocialAuth(request, env) {
  const auth = await getAuthenticatedUser(request, env);
  if (!auth) return { response: json({ ok: false, error: "Sessão ausente, inválida ou expirada." }, 401) };
  return { auth };
}

async function friendshipExists(env, a, b) {
  return !!(await env.DB.prepare(`
    SELECT id FROM friendships
    WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)
    LIMIT 1
  `).bind(a, b, b, a).first());
}

async function blockedBetween(env, a, b) {
  return !!(await env.DB.prepare(`
    SELECT 1 AS yes FROM blocks
    WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
    LIMIT 1
  `).bind(a, b, b, a).first());
}

async function getDmConversation(env, a, b) {
  return await env.DB.prepare(`
    SELECT c.id, c.created_at, c.updated_at
    FROM dm_conversations c
    JOIN dm_members a_member ON a_member.conversation_id = c.id AND a_member.user_id = ?
    JOIN dm_members b_member ON b_member.conversation_id = c.id AND b_member.user_id = ?
    LIMIT 1
  `).bind(a, b).first();
}

async function getOrCreateDmConversation(env, a, b) {
  let conversation = await getDmConversation(env, a, b);
  if (conversation) return conversation;
  const stamp = nowIso();
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO dm_conversations (id, created_at, updated_at) VALUES (?, ?, ?)`).bind(id, stamp, stamp),
    env.DB.prepare(`INSERT INTO dm_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)`).bind(id, a, stamp),
    env.DB.prepare(`INSERT INTO dm_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)`).bind(id, b, stamp),
  ]);
  return { id, created_at: stamp, updated_at: stamp };
}

function publicDmMessage(row, otherId = null) {
  if (!row) return null;
  const created = row.created_at || nowIso();
  return {
    id: row.id,
    clientId: row.client_id || null,
    senderId: row.sender_id,
    recipientId: row.recipient_id || otherId || null,
    text: row.content || "",
    time: Date.parse(created) || Date.now(),
    createdAt: created,
    files: parseJsonValue(row.files_json, []),
    file: parseJsonValue(row.files_json, [])[0] || null,
    replyTo: parseJsonValue(row.reply_json, null),
    edited: !!row.edited_at,
    deleted: !!row.deleted_at,
  };
}

async function listFriends(env, userId) {
  const result = await env.DB.prepare(`
    SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS friend_id
    FROM friendships
    WHERE user_a = ? OR user_b = ?
    ORDER BY created_at DESC
  `).bind(userId, userId, userId).all();
  const friends = [];
  for (const row of result.results || []) {
    const user = await socialUserById(env, row.friend_id);
    if (user) friends.push(user);
  }
  return friends;
}

async function listFriendRequests(env, userId) {
  const result = await env.DB.prepare(`
    SELECT * FROM friend_requests
    WHERE sender_id = ? OR receiver_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).bind(userId, userId).all();
  const requests = [];
  for (const row of result.results || []) {
    const otherId = row.sender_id === userId ? row.receiver_id : row.sender_id;
    requests.push({
      id: row.id,
      from: row.sender_id,
      to: row.receiver_id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      user: await socialUserById(env, otherId),
    });
  }
  return requests;
}

async function listDms(env, userId) {
  const convs = await env.DB.prepare(`
    SELECT c.id, c.updated_at
    FROM dm_conversations c
    JOIN dm_members m ON m.conversation_id = c.id
    LEFT JOIN dm_hidden h ON h.conversation_id = c.id AND h.user_id = ?
    WHERE m.user_id = ? AND h.user_id IS NULL
    ORDER BY c.updated_at DESC
    LIMIT 100
  `).bind(userId, userId).all();
  const dms = [];
  for (const conv of convs.results || []) {
    const other = await env.DB.prepare(`
      SELECT user_id FROM dm_members WHERE conversation_id = ? AND user_id <> ? LIMIT 1
    `).bind(conv.id, userId).first();
    if (!other) continue;
    const last = await env.DB.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 1
    `).bind(conv.id).first();
    const user = await socialUserById(env, other.user_id);
    if (user) dms.push({ user, lastMessage: publicDmMessage(last, other.user_id) });
  }
  return dms;
}

async function serverPublic(env, row, userId) {
  if (!row) return null;
  const membership = await env.DB.prepare(`SELECT role FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1`).bind(row.id, userId).first();
  const invite = await env.DB.prepare(`SELECT code FROM server_invites WHERE server_id = ? ORDER BY created_at DESC LIMIT 1`).bind(row.id).first();
  const channels = await env.DB.prepare(`SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, created_at ASC`).bind(row.id).all();
  return {
    id: row.id,
    name: row.name,
    icon: row.icon || String(row.name || "S")[0] || "S",
    iconUrl: row.icon_url || "",
    owner: row.owner_id,
    invite: invite?.code || "",
    description: row.description || "Comunidade do Azurecord.",
    createdAt: row.created_at,
    myRole: row.owner_id === userId ? "Admin" : (membership?.role || "Membro"),
    channels: (channels.results || []).map(c => ({
      id: c.id,
      serverId: c.server_id,
      name: c.name,
      type: c.type,
      topic: c.topic || "",
      position: c.position || 0,
    })),
  };
}

async function serverMembership(env, serverId, userId) {
  const server = await env.DB.prepare(`SELECT * FROM servers WHERE id = ? LIMIT 1`).bind(serverId).first();
  if (!server) return { server: null, member: false, role: null };
  if (server.owner_id === userId) return { server, member: true, role: "Admin" };
  const membership = await env.DB.prepare(`SELECT role FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1`).bind(serverId, userId).first();
  return { server, member: !!membership, role: membership?.role || null };
}

async function listServers(env, userId) {
  const result = await env.DB.prepare(`
    SELECT DISTINCT s.*
    FROM servers s
    LEFT JOIN server_members m ON m.server_id = s.id
    WHERE s.owner_id = ? OR m.user_id = ?
    ORDER BY s.created_at ASC
  `).bind(userId, userId).all();
  const servers = [];
  for (const row of result.results || []) servers.push(await serverPublic(env, row, userId));
  return servers;
}

async function handleSocial(request, env, url, path) {
  await ensureSocialSchema(env);
  const authResult = await requireSocialAuth(request, env);
  if (authResult.response) return authResult.response;
  const userId = authResult.auth.user.id;
  const method = request.method;
  const parts = path.split("/").filter(Boolean);

  if (method === "GET" && path === "/api/social/snapshot") {
    const [friends, requests, dms, servers] = await Promise.all([
      listFriends(env, userId), listFriendRequests(env, userId), listDms(env, userId), listServers(env, userId),
    ]);
    return json({ ok: true, friends, requests, dms, servers, serverTime: nowIso() });
  }

  if (method === "GET" && path === "/api/users") {
    const q = normalizeUsername(url.searchParams.get("search") || "");
    if (!q) return json({ users: [] });
    const rows = await env.DB.prepare(`
      SELECT id FROM users
      WHERE id <> ? AND account_status = 'active' AND username_normalized LIKE ?
      ORDER BY username_normalized ASC LIMIT 25
    `).bind(userId, `%${q}%`).all();
    const users = [];
    for (const row of rows.results || []) {
      const user = await socialUserById(env, row.id);
      if (user) users.push(user);
    }
    return json({ users });
  }

  if (method === "GET" && path === "/api/friends") return json({ friends: await listFriends(env, userId) });
  if (method === "GET" && path === "/api/friends/requests") return json({ requests: await listFriendRequests(env, userId) });

  if (method === "POST" && path === "/api/friends/requests") {
    const body = await readJson(request);
    const targetId = String(body?.toUserId || "");
    if (!targetId || targetId === userId) return json({ error: "user_not_found", message: "Usuário não encontrado." }, 404);
    if (!(await socialUserById(env, targetId))) return json({ error: "user_not_found", message: "Usuário não encontrado." }, 404);
    if (await blockedBetween(env, userId, targetId)) return json({ error: "blocked", message: "Não é possível enviar solicitação para este usuário." }, 403);
    if (await friendshipExists(env, userId, targetId)) return json({ alreadyFriends: true, accepted: true });

    const pending = await env.DB.prepare(`
      SELECT * FROM friend_requests
      WHERE status = 'pending' AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
      LIMIT 1
    `).bind(userId, targetId, targetId, userId).first();

    if (pending) {
      if (pending.sender_id === targetId && pending.receiver_id === userId) {
        const stamp = nowIso();
        await env.DB.batch([
          env.DB.prepare(`UPDATE friend_requests SET status = 'accepted', updated_at = ? WHERE id = ?`).bind(stamp, pending.id),
          env.DB.prepare(`INSERT INTO friendships (id, user_a, user_b, created_at) VALUES (?, ?, ?, ?)`).bind(crypto.randomUUID(), targetId, userId, stamp),
        ]);
        return json({ request: { id: pending.id, from: targetId, to: userId, status: "accepted", createdAt: pending.created_at, updatedAt: stamp }, accepted: true }, 200);
      }
      return json({ error: "request_exists", message: "Já existe uma solicitação pendente." }, 409);
    }

    const stamp = nowIso();
    const id = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO friend_requests (id, sender_id, receiver_id, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).bind(id, userId, targetId, stamp, stamp).run();
    return json({ request: { id, from: userId, to: targetId, status: "pending", createdAt: stamp, updatedAt: stamp }, accepted: false }, 201);
  }

  if (parts[0] === "api" && parts[1] === "friends" && parts[2] === "requests" && parts[3]) {
    const requestId = parts[3];
    const row = await env.DB.prepare(`SELECT * FROM friend_requests WHERE id = ? LIMIT 1`).bind(requestId).first();
    if (!row) return json({ error: "request_not_found", message: "Solicitação não encontrada." }, 404);
    const action = parts[4];
    const stamp = nowIso();
    if (method === "POST" && action === "accept" && row.receiver_id === userId) {
      if (!(await friendshipExists(env, row.sender_id, row.receiver_id))) {
        await env.DB.prepare(`INSERT INTO friendships (id, user_a, user_b, created_at) VALUES (?, ?, ?, ?)`).bind(crypto.randomUUID(), row.sender_id, row.receiver_id, stamp).run();
      }
      await env.DB.prepare(`UPDATE friend_requests SET status = 'accepted', updated_at = ? WHERE id = ?`).bind(stamp, requestId).run();
      return json({ ok: true });
    }
    if (method === "POST" && action === "decline" && row.receiver_id === userId) {
      await env.DB.prepare(`UPDATE friend_requests SET status = 'declined', updated_at = ? WHERE id = ?`).bind(stamp, requestId).run();
      return json({ ok: true });
    }
    if (method === "POST" && action === "cancel" && row.sender_id === userId) {
      await env.DB.prepare(`UPDATE friend_requests SET status = 'cancelled', updated_at = ? WHERE id = ?`).bind(stamp, requestId).run();
      return json({ ok: true });
    }
  }

  if (method === "DELETE" && parts[0] === "api" && parts[1] === "friends" && parts[2]) {
    const other = parts[2];
    const result = await env.DB.prepare(`
      DELETE FROM friendships WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)
    `).bind(userId, other, other, userId).run();
    return json({ removed: Number(result?.meta?.changes || result?.changes || 0) > 0 });
  }

  if (method === "GET" && path === "/api/dms") return json({ dms: await listDms(env, userId) });

  if (parts[0] === "api" && parts[1] === "dms" && parts[2]) {
    const otherId = parts[2];
    if (otherId === userId) return json({ error: "self_dm", message: "Não é possível mandar DM para a própria conta." }, 400);
    const other = await socialUserById(env, otherId);
    if (!other) return json({ error: "user_not_found", message: "Usuário não encontrado." }, 404);

    if (method === "GET" && parts.length === 3) {
      const conversation = await getDmConversation(env, userId, otherId);
      if (!conversation) return json({ user: other, messages: [] });
      await env.DB.prepare(`DELETE FROM dm_hidden WHERE user_id = ? AND conversation_id = ?`).bind(userId, conversation.id).run();
      const rows = await env.DB.prepare(`
        SELECT * FROM messages WHERE conversation_id = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 250
      `).bind(conversation.id).all();
      return json({ user: other, messages: (rows.results || []).map(row => publicDmMessage(row, row.sender_id === userId ? otherId : userId)) });
    }

    if (method === "POST" && parts[3] === "messages") {
      if (await blockedBetween(env, userId, otherId)) return json({ error: "blocked", message: "Esta conversa está bloqueada." }, 403);
      if (!(await friendshipExists(env, userId, otherId))) return json({ error: "friends_only", message: "Adicione este usuário como amigo antes de enviar uma DM." }, 403);
      const body = await readJson(request);
      const text = cleanText(body?.text, 6000);
      const files = cleanFiles(body?.files || []);
      if (!text && !files.length) return json({ error: "invalid_message", message: "Mensagem vazia." }, 400);
      const clientId = String(body?.clientId || "").slice(0, 120);
      if (clientId) {
        const duplicate = await env.DB.prepare(`SELECT * FROM messages WHERE sender_id = ? AND client_id = ? LIMIT 1`).bind(userId, clientId).first();
        if (duplicate) return json({ message: publicDmMessage(duplicate, otherId), duplicate: true });
      }
      const conversation = await getOrCreateDmConversation(env, userId, otherId);
      const stamp = nowIso();
      const id = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO messages (id, conversation_id, sender_id, content, created_at, edited_at, deleted_at, client_id, recipient_id, files_json, reply_json)
          VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
        `).bind(id, conversation.id, userId, text, stamp, clientId || null, otherId, JSON.stringify(files), body?.replyTo ? JSON.stringify(body.replyTo) : null),
        env.DB.prepare(`UPDATE dm_conversations SET updated_at = ? WHERE id = ?`).bind(stamp, conversation.id),
        env.DB.prepare(`DELETE FROM dm_hidden WHERE conversation_id = ?`).bind(conversation.id),
      ]);
      const row = await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(id).first();
      return json({ message: publicDmMessage(row, otherId) }, 201);
    }

    if (method === "DELETE" && parts.length === 3) {
      const conversation = await getDmConversation(env, userId, otherId);
      if (!conversation) return json({ removed: 0 });
      await env.DB.prepare(`INSERT OR REPLACE INTO dm_hidden (user_id, conversation_id, hidden_at) VALUES (?, ?, ?)`).bind(userId, conversation.id, nowIso()).run();
      return json({ removed: 1 });
    }
  }

  if (method === "GET" && path === "/api/servers") return json({ servers: await listServers(env, userId) });

  if (method === "POST" && path === "/api/servers") {
    const body = await readJson(request);
    const name = cleanText(body?.name || "Novo servidor", 80) || "Novo servidor";
    const icon = cleanText(body?.icon || name[0] || "S", 2) || "S";
    const iconUrl = String(body?.iconUrl || "").slice(0, 600000);
    const description = cleanText(body?.description || "Comunidade do Azurecord.", 240);
    const id = crypto.randomUUID();
    const stamp = nowIso();
    const invite = randomToken(7).slice(0, 10).toUpperCase();
    const textId = crypto.randomUUID();
    const voiceId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO servers (id, owner_id, name, icon_url, description, created_at, updated_at, icon) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, userId, name, iconUrl, description, stamp, stamp, icon),
      env.DB.prepare(`INSERT INTO server_members (server_id, user_id, role, nickname, joined_at) VALUES (?, ?, 'Admin', NULL, ?)`).bind(id, userId, stamp),
      env.DB.prepare(`INSERT INTO channels (id, server_id, name, type, position, created_at, updated_at, topic) VALUES (?, ?, 'geral', 'text', 0, ?, ?, 'Canal principal.')`).bind(textId, id, stamp, stamp),
      env.DB.prepare(`INSERT INTO channels (id, server_id, name, type, position, created_at, updated_at, topic) VALUES (?, ?, 'Lounge', 'voice', 1, ?, ?, 'Sala de voz.')`).bind(voiceId, id, stamp, stamp),
      env.DB.prepare(`INSERT INTO server_invites (id, server_id, created_by, code, max_uses, uses, expires_at, created_at) VALUES (?, ?, ?, ?, NULL, 0, NULL, ?)`).bind(crypto.randomUUID(), id, userId, invite, stamp),
    ]);
    const server = await env.DB.prepare(`SELECT * FROM servers WHERE id = ?`).bind(id).first();
    const output = await serverPublic(env, server, userId);
    return json({ server: output, channels: output.channels }, 201);
  }

  if (method === "POST" && path === "/api/servers/join") {
    const body = await readJson(request);
    const code = String(body?.code || "").trim().toUpperCase();
    const invite = await env.DB.prepare(`SELECT * FROM server_invites WHERE UPPER(code) = ? LIMIT 1`).bind(code).first();
    if (!invite) return json({ error: "invite_not_found", message: "Convite inexistente ou expirado." }, 404);
    if (invite.expires_at && Date.parse(invite.expires_at) < Date.now()) return json({ error: "invite_expired", message: "Este convite expirou." }, 410);
    if (invite.max_uses != null && Number(invite.uses) >= Number(invite.max_uses)) return json({ error: "invite_full", message: "Este convite atingiu o limite de usos." }, 410);
    const server = await env.DB.prepare(`SELECT * FROM servers WHERE id = ? LIMIT 1`).bind(invite.server_id).first();
    if (!server) return json({ error: "server_not_found", message: "Servidor não encontrado." }, 404);
    const existing = await env.DB.prepare(`SELECT role FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1`).bind(server.id, userId).first();
    if (!existing) {
      const stamp = nowIso();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO server_members (server_id, user_id, role, nickname, joined_at) VALUES (?, ?, 'Membro', NULL, ?)`).bind(server.id, userId, stamp),
        env.DB.prepare(`UPDATE server_invites SET uses = uses + 1 WHERE id = ?`).bind(invite.id),
      ]);
    }
    const output = await serverPublic(env, server, userId);
    return json({ server: output, channels: output.channels, alreadyMember: !!existing }, existing ? 200 : 201);
  }

  if (parts[0] === "api" && parts[1] === "servers" && parts[2]) {
    const serverId = parts[2];
    const membership = await serverMembership(env, serverId, userId);
    if (!membership.server) return json({ error: "server_not_found", message: "Servidor não encontrado." }, 404);

    if (method === "GET" && parts.length === 3) {
      if (!membership.member) return json({ error: "forbidden", message: "Você não participa deste servidor." }, 403);
      const server = await serverPublic(env, membership.server, userId);
      return json({ server, channels: server.channels });
    }

    if (method === "DELETE" && parts.length === 3) {
      if (membership.server.owner_id !== userId) return json({ error: "forbidden", message: "Apenas o dono pode excluir o servidor." }, 403);
      await env.DB.prepare(`DELETE FROM servers WHERE id = ?`).bind(serverId).run();
      return json({ removed: true });
    }

    if (method === "GET" && parts[3] === "members") {
      if (!membership.member) return json({ error: "forbidden", message: "Você não participa deste servidor." }, 403);
      const rows = await env.DB.prepare(`SELECT user_id, role FROM server_members WHERE server_id = ? ORDER BY joined_at ASC`).bind(serverId).all();
      const members = [];
      for (const row of rows.results || []) {
        const user = await socialUserById(env, row.user_id);
        if (user) members.push({ ...user, serverRole: row.user_id === membership.server.owner_id ? "Admin" : (row.role || "Membro") });
      }
      return json({ members });
    }

    if (parts[3] === "channels" && parts.length === 4 && method === "GET") {
      if (!membership.member) return json({ error: "forbidden", message: "Você não participa deste servidor." }, 403);
      const server = await serverPublic(env, membership.server, userId);
      return json({ channels: server.channels });
    }

    if (parts[3] === "channels" && parts.length === 4 && method === "POST") {
      if (membership.server.owner_id !== userId && membership.role !== "Admin") return json({ error: "forbidden", message: "Sem permissão para criar canais." }, 403);
      const body = await readJson(request);
      const name = normalizeUsername(body?.name || "novo-canal").replace(/[^a-z0-9_-]/g, "-").slice(0, 80) || "novo-canal";
      const type = body?.type === "voice" ? "voice" : "text";
      const topic = cleanText(body?.topic || "", 240);
      const positionRow = await env.DB.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM channels WHERE server_id = ?`).bind(serverId).first();
      const id = crypto.randomUUID();
      const stamp = nowIso();
      await env.DB.prepare(`INSERT INTO channels (id, server_id, name, type, position, created_at, updated_at, topic) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, serverId, name, type, Number(positionRow?.next_position || 0), stamp, stamp, topic).run();
      return json({ channel: { id, serverId, name, type, topic, position: Number(positionRow?.next_position || 0) } }, 201);
    }

    if (parts[3] === "channels" && parts[4] === "reorder" && method === "PATCH") {
      if (membership.server.owner_id !== userId && membership.role !== "Admin") return json({ error: "forbidden", message: "Sem permissão para ordenar canais." }, 403);
      const body = await readJson(request);
      const order = Array.isArray(body?.order) ? body.order.map(String) : [];
      for (let i = 0; i < order.length; i++) {
        await env.DB.prepare(`UPDATE channels SET position = ?, updated_at = ? WHERE id = ? AND server_id = ?`).bind(i, nowIso(), order[i], serverId).run();
      }
      const server = await serverPublic(env, membership.server, userId);
      return json({ channels: server.channels });
    }

    if (parts[3] === "channels" && parts[4] && parts.length === 5 && method === "DELETE") {
      if (membership.server.owner_id !== userId && membership.role !== "Admin") return json({ error: "forbidden", message: "Sem permissão para excluir canais." }, 403);
      const channelId = parts[4];
      const channel = await env.DB.prepare(`SELECT * FROM channels WHERE id = ? AND server_id = ? LIMIT 1`).bind(channelId, serverId).first();
      if (!channel) return json({ error: "channel_not_found", message: "Canal não encontrado." }, 404);
      if (channel.type === "text") {
        const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM channels WHERE server_id = ? AND type = 'text'`).bind(serverId).first();
        if (Number(count?.n || 0) <= 1) return json({ error: "last_text_channel", message: "O servidor precisa manter pelo menos um canal de texto." }, 400);
      }
      await env.DB.prepare(`DELETE FROM channels WHERE id = ?`).bind(channelId).run();
      return json({ removed: true });
    }

    if (parts[3] === "channels" && parts[4] && parts[5] === "messages") {
      const channelId = parts[4];
      if (!membership.member) return json({ error: "forbidden", message: "Entre no servidor para acessar o canal." }, 403);
      const channel = await env.DB.prepare(`SELECT * FROM channels WHERE id = ? AND server_id = ? LIMIT 1`).bind(channelId, serverId).first();
      if (!channel) return json({ error: "channel_not_found", message: "Canal não encontrado." }, 404);
      if (channel.type !== "text") return json({ error: "not_text_channel", message: "Este canal não aceita mensagens de texto." }, 400);

      if (method === "GET") {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
        const rows = await env.DB.prepare(`SELECT * FROM channel_messages WHERE channel_id = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT ?`).bind(channelId, limit).all();
        const messages = [];
        for (const row of rows.results || []) {
          const author = await socialUserById(env, row.sender_id);
          messages.push({
            id: row.id,
            clientId: row.client_id || null,
            channelId,
            serverId,
            senderId: row.sender_id,
            author,
            text: row.content || "",
            time: Date.parse(row.created_at) || Date.now(),
            createdAt: row.created_at,
            files: parseJsonValue(row.files_json, []),
            file: parseJsonValue(row.files_json, [])[0] || null,
            replyTo: parseJsonValue(row.reply_json, null),
            edited: !!row.edited_at,
            deleted: !!row.deleted_at,
          });
        }
        return json({ messages });
      }

      if (method === "POST") {
        const body = await readJson(request);
        const text = cleanText(body?.text, 6000);
        const files = cleanFiles(body?.files || []);
        if (!text && !files.length) return json({ error: "invalid_message", message: "Mensagem vazia." }, 400);
        const clientId = String(body?.clientId || "").slice(0, 120);
        if (clientId) {
          const duplicate = await env.DB.prepare(`SELECT * FROM channel_messages WHERE sender_id = ? AND client_id = ? LIMIT 1`).bind(userId, clientId).first();
          if (duplicate) return json({ message: { id: duplicate.id, senderId: duplicate.sender_id, text: duplicate.content, clientId, time: Date.parse(duplicate.created_at) || Date.now() }, duplicate: true });
        }
        const stamp = nowIso();
        const id = crypto.randomUUID();
        await env.DB.prepare(`
          INSERT INTO channel_messages (id, channel_id, sender_id, content, created_at, edited_at, deleted_at, client_id, files_json, reply_json)
          VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
        `).bind(id, channelId, userId, text, stamp, clientId || null, JSON.stringify(files), body?.replyTo ? JSON.stringify(body.replyTo) : null).run();
        return json({ message: { id, clientId: clientId || null, channelId, serverId, senderId: userId, author: socialUser(authResult.auth.user), text, time: Date.parse(stamp), createdAt: stamp, files, file: files[0] || null, replyTo: body?.replyTo || null, edited: false, deleted: false } }, 201);
      }
    }
  }

  return null;
}

async function ensureSchema(env) {
  if (env?.DB && schemaReadyFor.has(env.DB)) return;
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      bio TEXT NOT NULL DEFAULT '',
      accent TEXT NOT NULL DEFAULT '#0066ff',
      status TEXT NOT NULL DEFAULT 'online',
      banner_url TEXT,
      personality TEXT NOT NULL DEFAULT 'Usuário do Azurecord.',
      profile_complete INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
  await ensureSocialSchema(env);
  if (env?.DB) schemaReadyFor.add(env.DB);
}

function validProfileImage(value, maxChars) {
  const text = String(value || "");
  if (!text) return true;
  if (text.length > maxChars) return false;
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(text) || /^https:\/\//i.test(text);
}

function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name || row.username,
    avatarUrl: row.avatar_url || "",
    bio: row.bio || "",
    accent: row.accent || "#0066ff",
    status: row.profile_status || "online",
    bannerUrl: row.banner_url || "",
    personality: row.personality || "Usuário do Azurecord.",
    profileComplete: Number(row.profile_complete || 0) === 1,
    accountStatus: row.account_status,
    accountType: "cloud",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readUserById(env, userId) {
  await ensureSchema(env);
  const row = await env.DB.prepare(`
    SELECT
      u.id,
      u.username,
      u.email,
      u.display_name,
      u.avatar_url,
      u.account_status,
      u.created_at,
      u.updated_at,
      p.bio,
      p.accent,
      p.status AS profile_status,
      p.banner_url,
      p.personality,
      p.profile_complete
    FROM users u
    LEFT JOIN user_profiles p ON p.user_id = u.id
    WHERE u.id = ?
    LIMIT 1
  `).bind(userId).first();

  if (!row) return null;

  if (row.profile_complete === null || row.profile_complete === undefined) {
    const stamp = nowIso();
    await env.DB.prepare(`
      INSERT OR IGNORE INTO user_profiles (
        user_id, bio, accent, status, banner_url, personality, profile_complete, updated_at
      ) VALUES (?, '', '#0066ff', 'online', '', 'Usuário do Azurecord.', 0, ?)
    `).bind(userId, stamp).run();
    row.bio = "";
    row.accent = "#0066ff";
    row.profile_status = "online";
    row.banner_url = "";
    row.personality = "Usuário do Azurecord.";
    row.profile_complete = 0;
  }

  return toPublicUser(row);
}

async function createSession(env, userId) {
  const token = randomToken(32);
  const tokenHash = await sha256Base64Url(token);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(`
    INSERT INTO sessions (
      id, user_id, token_hash, created_at, expires_at, last_used_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    userId,
    tokenHash,
    createdAt,
    expiresAt,
    createdAt
  ).run();

  return { token, expiresAt };
}

function getBearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  return token || null;
}

async function getAuthenticatedUser(request, env) {
  await ensureSchema(env);
  const token = getBearerToken(request);
  if (!token) return null;

  const tokenHash = await sha256Base64Url(token);
  const stamp = nowIso();

  const session = await env.DB.prepare(`
    SELECT s.id AS session_id, s.user_id
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
      AND s.expires_at > ?
      AND u.account_status = 'active'
    LIMIT 1
  `).bind(tokenHash, stamp).first();

  if (!session) return null;

  await env.DB.prepare(`
    UPDATE sessions SET last_used_at = ? WHERE id = ?
  `).bind(stamp, session.session_id).run();

  const user = await readUserById(env, session.user_id);
  if (!user || user.accountStatus !== "active") return null;

  return {
    token,
    tokenHash,
    sessionId: session.session_id,
    user,
  };
}

async function register(request, env) {
  await ensureSchema(env);
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON inválido." }, 400);

  const username = String(body.username || "").trim();
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const usernameNormalized = normalizeUsername(username);

  if (username.length < 3 || username.length > 32) {
    return json({ ok: false, error: "O nome de usuário precisa ter entre 3 e 32 caracteres." }, 400);
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return json({ ok: false, error: "Use apenas letras, números, ponto, underline ou hífen no nome de usuário." }, 400);
  }
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "Informe um email válido." }, 400);
  }
  if (password.length < 8 || password.length > 128) {
    return json({ ok: false, error: "A senha precisa ter entre 8 e 128 caracteres." }, 400);
  }

  const existing = await env.DB.prepare(`
    SELECT id, username_normalized, email_normalized
    FROM users
    WHERE username_normalized = ? OR email_normalized = ?
    LIMIT 1
  `).bind(usernameNormalized, email).first();

  if (existing) {
    return json({
      ok: false,
      error: existing.email_normalized === email
        ? "Já existe uma conta com esse email."
        : "Esse nome de usuário já está em uso.",
    }, 409);
  }

  const userId = crypto.randomUUID();
  const createdAt = nowIso();
  const passwordHash = await hashPassword(password);

  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (
          id, username, username_normalized, email, email_normalized,
          password_hash, display_name, avatar_url, account_status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'active', ?, ?)
      `).bind(
        userId, username, usernameNormalized, email, email,
        passwordHash, username, createdAt, createdAt
      ),

      env.DB.prepare(`
        INSERT INTO user_profiles (
          user_id, bio, accent, status, banner_url, personality, profile_complete, updated_at
        ) VALUES (?, '', '#0066ff', 'online', '', 'Usuário do Azurecord.', 0, ?)
      `).bind(userId, createdAt),

      env.DB.prepare(`
        INSERT INTO azurepoints_wallets (
          user_id, balance, lifetime_earned, lifetime_spent, created_at, updated_at
        ) VALUES (?, 0, 0, 0, ?, ?)
      `).bind(userId, createdAt, createdAt),

      env.DB.prepare(`
        INSERT INTO user_settings (
          user_id, theme, language, allow_friend_requests,
          allow_dms_from_friends, lola_enabled, lola_memory_enabled,
          notifications_enabled, updated_at
        ) VALUES (?, 'dark', 'pt-BR', 1, 1, 1, 1, 1, ?)
      `).bind(userId, createdAt),

      env.DB.prepare(`
        INSERT INTO user_presence (
          user_id, status, custom_status, last_seen_at, updated_at
        ) VALUES (?, 'offline', NULL, ?, ?)
      `).bind(userId, createdAt, createdAt),
    ]);
  } catch (error) {
    console.error("register failed:", error);
    return json({ ok: false, error: "Não foi possível criar a conta." }, 500);
  }

  const session = await createSession(env, userId);
  const user = await readUserById(env, userId);
  return json({ ok: true, user, session }, 201);
}

async function login(request, env) {
  await ensureSchema(env);
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON inválido." }, 400);

  const loginValue = String(body.email || body.login || body.username || "").trim();
  const password = String(body.password || "");
  if (!loginValue || !password) {
    return json({ ok: false, error: "Informe email/nome de usuário e senha." }, 400);
  }

  const normalized = loginValue.toLowerCase();
  const user = await env.DB.prepare(`
    SELECT id, password_hash, account_status
    FROM users
    WHERE email_normalized = ? OR username_normalized = ?
    LIMIT 1
  `).bind(normalized, normalized).first();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return json({ ok: false, error: "Email/nome de usuário ou senha incorretos." }, 401);
  }
  if (user.account_status !== "active") {
    return json({ ok: false, error: "Esta conta não está ativa." }, 403);
  }

  const session = await createSession(env, user.id);
  const publicUser = await readUserById(env, user.id);
  return json({ ok: true, user: publicUser, session });
}

async function me(request, env) {
  const auth = await getAuthenticatedUser(request, env);
  if (!auth) return json({ ok: false, error: "Sessão ausente, inválida ou expirada." }, 401);
  return json({ ok: true, user: auth.user });
}

async function logout(request, env) {
  const token = getBearerToken(request);
  if (!token) return json({ ok: true });

  const tokenHash = await sha256Base64Url(token);
  await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
  return json({ ok: true });
}

async function updateProfile(request, env) {
  const auth = await getAuthenticatedUser(request, env);
  if (!auth) return json({ ok: false, error: "Sessão ausente, inválida ou expirada." }, 401);

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON inválido." }, 400);

  const current = auth.user;
  const username = String(body.username ?? current.username).trim().replace(/\s+/g, "");
  const usernameNormalized = normalizeUsername(username);
  const bio = String(body.bio ?? current.bio ?? "").trim();
  const accent = String(body.accent ?? current.accent ?? "#0066ff").trim();
  const status = String(body.status ?? current.status ?? "online").trim();
  const avatar = String(body.avatar ?? body.avatarUrl ?? current.avatarUrl ?? "");
  const banner = String(body.banner ?? body.bannerUrl ?? current.bannerUrl ?? "");
  const personality = String(body.personality ?? current.personality ?? "Usuário do Azurecord.").trim();
  const profileComplete = body.profileComplete === true || (body.profileComplete === undefined && current.profileComplete === true);

  if (username.length < 3 || username.length > 32 || !/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return json({ ok: false, error: "Nome de usuário inválido." }, 400);
  }
  if (bio.length > 160) return json({ ok: false, error: "A bio pode ter no máximo 160 caracteres." }, 400);
  if (!/^#[0-9a-f]{6}$/i.test(accent)) return json({ ok: false, error: "Cor de destaque inválida." }, 400);
  if (!["online", "idle", "dnd", "offline"].includes(status)) return json({ ok: false, error: "Status inválido." }, 400);
  if (personality.length > 240) return json({ ok: false, error: "Personalidade muito longa." }, 400);
  if (!validProfileImage(avatar, MAX_AVATAR_CHARS)) return json({ ok: false, error: "Avatar inválido ou grande demais." }, 400);
  if (!validProfileImage(banner, MAX_BANNER_CHARS)) return json({ ok: false, error: "Banner inválido ou grande demais." }, 400);

  const usernameOwner = await env.DB.prepare(`
    SELECT id FROM users WHERE username_normalized = ? AND id <> ? LIMIT 1
  `).bind(usernameNormalized, auth.user.id).first();
  if (usernameOwner) return json({ ok: false, error: "Esse nome de usuário já está em uso." }, 409);

  const stamp = nowIso();
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE users
      SET username = ?, username_normalized = ?, display_name = ?, avatar_url = ?, updated_at = ?
      WHERE id = ?
    `).bind(username, usernameNormalized, username, avatar, stamp, auth.user.id),

    env.DB.prepare(`
      INSERT INTO user_profiles (
        user_id, bio, accent, status, banner_url, personality, profile_complete, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        bio = excluded.bio,
        accent = excluded.accent,
        status = excluded.status,
        banner_url = excluded.banner_url,
        personality = excluded.personality,
        profile_complete = excluded.profile_complete,
        updated_at = excluded.updated_at
    `).bind(
      auth.user.id, bio, accent, status, banner, personality,
      profileComplete ? 1 : 0, stamp
    ),
  ]);

  return json({ ok: true, user: await readUserById(env, auth.user.id) });
}

async function changePassword(request, env) {
  const auth = await getAuthenticatedUser(request, env);
  if (!auth) return json({ ok: false, error: "Sessão ausente, inválida ou expirada." }, 401);

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON inválido." }, 400);

  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  if (newPassword.length < 8 || newPassword.length > 128) {
    return json({ ok: false, error: "A nova senha precisa ter entre 8 e 128 caracteres." }, 400);
  }

  const row = await env.DB.prepare(`
    SELECT password_hash FROM users WHERE id = ? LIMIT 1
  `).bind(auth.user.id).first();

  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
    return json({ ok: false, error: "Senha atual incorreta." }, 401);
  }

  const passwordHash = await hashPassword(newPassword);
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?
    `).bind(passwordHash, nowIso(), auth.user.id),
    env.DB.prepare(`
      DELETE FROM sessions WHERE user_id = ? AND id <> ?
    `).bind(auth.user.id, auth.sessionId),
  ]);

  return json({ ok: true });
}

async function deleteAccount(request, env) {
  const auth = await getAuthenticatedUser(request, env);
  if (!auth) return json({ ok: false, error: "Sessão ausente, inválida ou expirada." }, 401);

  const body = await readJson(request);
  if (!body) return json({ ok: false, error: "JSON inválido." }, 400);

  const currentPassword = String(body.currentPassword || "");
  const confirmation = String(body.confirmation || "").trim().toUpperCase();
  if (confirmation !== "EXCLUIR CONTA") {
    return json({ ok: false, error: "Digite EXCLUIR CONTA para confirmar." }, 400);
  }

  const row = await env.DB.prepare(`
    SELECT password_hash FROM users WHERE id = ? LIMIT 1
  `).bind(auth.user.id).first();

  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
    return json({ ok: false, error: "Senha atual incorreta." }, 401);
  }

  const id = auth.user.id;

  // Limpeza explícita. Não depende apenas de ON DELETE CASCADE e também remove
  // conversas/servidores órfãos que poderiam sobreviver ao usuário.
  await env.DB.batch([
    env.DB.prepare(`UPDATE beta_feedback SET user_id = NULL WHERE user_id = ?`).bind(id),

    env.DB.prepare(`
      DELETE FROM dm_conversations
      WHERE id IN (SELECT conversation_id FROM dm_members WHERE user_id = ?)
    `).bind(id),
    env.DB.prepare(`DELETE FROM messages WHERE sender_id = ?`).bind(id),

    env.DB.prepare(`DELETE FROM servers WHERE owner_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM channel_messages WHERE sender_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM server_invites WHERE created_by = ?`).bind(id),
    env.DB.prepare(`DELETE FROM server_members WHERE user_id = ?`).bind(id),

    env.DB.prepare(`DELETE FROM friend_requests WHERE sender_id = ? OR receiver_id = ?`).bind(id, id),
    env.DB.prepare(`DELETE FROM friendships WHERE user_a = ? OR user_b = ?`).bind(id, id),
    env.DB.prepare(`DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?`).bind(id, id),

    env.DB.prepare(`DELETE FROM azurepoints_transactions WHERE user_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM azurepoints_redemptions WHERE user_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM azurepoints_wallets WHERE user_id = ?`).bind(id),

    env.DB.prepare(`
      DELETE FROM lola_messages
      WHERE conversation_id IN (SELECT id FROM lola_conversations WHERE user_id = ?)
    `).bind(id),
    env.DB.prepare(`DELETE FROM lola_conversations WHERE user_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM lola_memories WHERE user_id = ?`).bind(id),

    env.DB.prepare(`DELETE FROM user_presence WHERE user_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM user_settings WHERE user_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM user_profiles WHERE user_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(id),
  ]);

  return json({ ok: true, deleted: true, emailReusable: true });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (request.method === "GET" && path === "/") {
        return json({
          name: "Azurecord API",
          status: "online",
          version: "0.5.0",
        });
      }

      if (request.method === "GET" && path === "/health") {
        await ensureSchema(env);
        return json({
          ok: true,
          service: "azurecord-api",
          database: Boolean(env.DB),
          version: "0.5.0",
          capabilities: {
            cloudAuth: true,
            profileSync: true,
            accountDelete: true,
            passwordChange: true,
            socialCloud: true,
            cloudDMs: true,
            cloudServers: true,
            socialPolling: true,
          },
        });
      }

      if (request.method === "POST" && path === "/auth/register") return await register(request, env);
      if (request.method === "POST" && path === "/auth/login") return await login(request, env);
      if (request.method === "GET" && path === "/auth/me") return await me(request, env);
      if (request.method === "POST" && path === "/auth/logout") return await logout(request, env);
      if (request.method === "PATCH" && (path === "/auth/profile" || path === "/auth/me")) return await updateProfile(request, env);
      if (request.method === "POST" && path === "/auth/password") return await changePassword(request, env);
      if (request.method === "POST" && path === "/auth/delete") return await deleteAccount(request, env);
      if (request.method === "DELETE" && path === "/auth/me") return await deleteAccount(request, env);

      if (path.startsWith("/api/")) {
        const socialResponse = await handleSocial(request, env, url, path);
        if (socialResponse) return socialResponse;
      }

      return json({ ok: false, error: "Rota não encontrada." }, 404);
    } catch (error) {
      console.error("AZURECORD CLOUD ERROR", error);
      return json({
        ok: false,
        error: "Erro interno do Azurecord.",
        debug: String(error?.message || error),
      }, 500);
    }
  },
};
