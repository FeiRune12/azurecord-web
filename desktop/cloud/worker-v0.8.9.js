const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

const PASSWORD_ITERATIONS = 100000;
const MAX_AVATAR_CHARS = 450000;
const MAX_BANNER_CHARS = 750000;
const LOLA_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const LOLA_MAX_CONTEXT_MESSAGES = 36;
const LOLA_MAX_OUTPUT_TOKENS = 900;
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

function publicSearchKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[\s._-]+/g, "");
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

async function insertCompatible(env, table, values) {
  const columns = await tableColumns(env, table);
  const entries = Object.entries(values).filter(([key, value]) => columns.has(key) && value !== undefined);
  if (!entries.length) throw new Error(`Nenhuma coluna compatível para ${table}.`);
  const names = entries.map(([key]) => key);
  const placeholders = names.map(() => "?").join(", ");
  const sql = `INSERT INTO ${table} (${names.join(", ")}) VALUES (${placeholders})`;
  await env.DB.prepare(sql).bind(...entries.map(([, value]) => value)).run();
}


const LOLA_PUBLIC_USER = Object.freeze({
  id: "user-lola",
  username: "Lola",
  displayName: "Lola",
  handle: "@lola",
  bio: "Assistente do Azurecord, agora conectada ao Workers AI.",
  accent: "#35b6ff",
  status: "online",
  avatar: "https://gunvolt.com/en/X/system/img/system02_03Pic02.jpg",
  avatarUrl: "https://gunvolt.com/en/X/system/img/system02_03Pic02.jpg",
  banner: "https://gunvolt.com/GRC/en/special/img/grc_wallpaper_00_1920x1080en.jpg",
  bannerUrl: "https://gunvolt.com/GRC/en/special/img/grc_wallpaper_00_1920x1080en.jpg",
  personality: "Criativa, calorosa, curiosa e bem-humorada.",
  profileComplete: true,
  memberSince: "27 de set. de 2026",
  role: "Membro",
  badge: "✦",
  accountType: "system",
});

function lolaMessagePublic(row, userId, sessionId) {
  if (!row) return null;
  const createdAt = row.created_at || nowIso();
  const isAssistant = row.role === "assistant";
  const files = parseJsonValue(row.files_json, []);
  return {
    id: row.id,
    clientId: row.client_id || null,
    senderId: isAssistant ? "user-lola" : userId,
    recipientId: isAssistant ? userId : "user-lola",
    text: row.content || "",
    time: Date.parse(createdAt) || Date.now(),
    createdAt,
    files,
    file: files[0] || null,
    replyTo: parseJsonValue(row.reply_json, null),
    edited: false,
    deleted: false,
    lolaSessionId: sessionId,
    aiGenerated: isAssistant,
    proactive: Number(row.proactive || 0) === 1,
  };
}

async function ensureLolaSchema(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS lola_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS lola_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES lola_conversations(id) ON DELETE CASCADE
    )
  `).run();

  await addColumnIfMissing(env, "lola_messages", "client_id", "TEXT");
  await addColumnIfMissing(env, "lola_messages", "files_json", "TEXT");
  await addColumnIfMissing(env, "lola_messages", "reply_json", "TEXT");
  await addColumnIfMissing(env, "lola_messages", "proactive", "INTEGER NOT NULL DEFAULT 0");
}

async function activeLolaConversation(env, userId, createIfMissing = true) {
  await ensureLolaSchema(env);
  let row = await env.DB.prepare(`
    SELECT id, user_id, title, created_at, updated_at
    FROM lola_conversations
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(userId).first();

  if (!row && createIfMissing) {
    const stamp = nowIso();
    const id = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO lola_conversations (id, user_id, title, created_at, updated_at)
      VALUES (?, ?, 'Conversa com Lola', ?, ?)
    `).bind(id, userId, stamp, stamp).run();
    row = { id, user_id: userId, title: "Conversa com Lola", created_at: stamp, updated_at: stamp };
  }
  return row || null;
}

async function newLolaConversation(env, userId) {
  const previous = await activeLolaConversation(env, userId, false);
  const stamp = nowIso();
  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO lola_conversations (id, user_id, title, created_at, updated_at)
    VALUES (?, ?, 'Conversa com Lola', ?, ?)
  `).bind(id, userId, stamp, stamp).run();
  return { id, previousSessionId: previous?.id || null, startedAt: stamp };
}

function sanitizeLolaMemory(value) {
  if (!value || typeof value !== "object") return {};
  const cleanList = (v, max = 12) => Array.isArray(v)
    ? v.map(x => String(x || "").slice(0, 180)).filter(Boolean).slice(-max)
    : [];
  return {
    preferredName: String(value.preferredName || "").slice(0, 80),
    likes: cleanList(value.likes),
    dislikes: cleanList(value.dislikes),
    projects: cleanList(value.projects),
    goals: cleanList(value.goals),
    facts: cleanList(value.facts),
    topics: cleanList(value.topics, 8),
    recentSubjects: cleanList(value.recentSubjects, 8),
    lastIntent: String(value.lastIntent || "").slice(0, 60),
    lastTopic: String(value.lastTopic || "").slice(0, 120),
  };
}

function lolaSystemPrompt(user, memory, recentReplies = []) {
  const memoryJson = JSON.stringify(sanitizeLolaMemory(memory));
  const avoid = JSON.stringify(recentReplies.slice(-4));
  return `Você é Lola, a assistente do Azurecord. Responda em português brasileiro natural.

PERSONALIDADE:
- Espontânea, criativa, calorosa, curiosa e bem-humorada.
- Pode usar emojis de forma natural, especialmente 💙 😈 👀 🔥 💀, mas não em toda frase.
- Nunca finja ter visto ou sabido algo que não recebeu no contexto.
- Não repita bordões, saudações ou a mesma estrutura em respostas consecutivas.

COMPORTAMENTO:
1. Responda diretamente à última mensagem. Se for pergunta, responda a pergunta.
2. Use o histórico atual para entender pronomes, correções e continuações.
3. Para código, dê soluções concretas e úteis. Para design, explique os detalhes que realmente consegue observar.
4. Se não tiver informação suficiente, diga exatamente o que falta sem inventar.
5. Não sexualize menores e não produza conteúdo sexual explícito.
6. Não incentive atividades perigosas ou ilegais.
7. Evite terminar toda resposta com uma pergunta.
8. Você está dentro do Azurecord e o usuário atual é ${String(user?.displayName || user?.username || "Usuário").slice(0, 80)}.

MEMÓRIA FORNECIDA PELO CLIENTE, USE SOMENTE SE FOR RELEVANTE:
${memoryJson}

RESPOSTAS RECENTES SUAS PARA EVITAR REPETIR:
${avoid}`;
}

function lolaContentFromTextAndImages(text, attachments) {
  const images = (Array.isArray(attachments) ? attachments : [])
    .filter(x => String(x?.type || "").startsWith("image/") && (
      /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(x?.dataUrl || "")) ||
      /^https:\/\//i.test(String(x?.url || ""))
    ))
    .slice(0, 2);
  if (!images.length) return text || "Analise o contexto e responda naturalmente.";
  const parts = [];
  if (text) parts.push({ type: "text", text });
  else parts.push({ type: "text", text: "Analise a imagem enviada e responda ao usuário." });
  for (const image of images) {
    parts.push({ type: "image_url", image_url: { url: String(image.dataUrl || image.url) } });
  }
  return parts;
}

async function handleLola(request, env, url, path) {
  if (!path.startsWith("/api/ai/") && !path.startsWith("/api/dms/user-lola")) return null;

  const authResult = await requireSocialAuth(request, env);
  if (authResult.response) return authResult.response;
  const userId = authResult.auth.user.id;
  const method = request.method;

  if (method === "GET" && path === "/api/ai/conversations") {
    const conversation = await activeLolaConversation(env, userId, true);
    return json({ ok: true, sessionId: conversation.id });
  }

  if (method === "POST" && path === "/api/ai/conversations/new") {
    const conversation = await newLolaConversation(env, userId);
    return json({ ok: true, sessionId: conversation.id, previousSessionId: conversation.previousSessionId }, 201);
  }

  if (method === "GET" && path === "/api/dms/user-lola") {
    const conversation = await activeLolaConversation(env, userId, true);
    const rows = await env.DB.prepare(`
      SELECT *
      FROM lola_messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
      LIMIT 250
    `).bind(conversation.id).all();
    return json({
      ok: true,
      user: LOLA_PUBLIC_USER,
      sessionId: conversation.id,
      messages: (rows.results || []).map(row => lolaMessagePublic(row, userId, conversation.id)),
    });
  }

  if (method === "POST" && path === "/api/dms/user-lola/messages") {
    const body = await readJson(request);
    if (!body) return json({ ok: false, error: "JSON inválido." }, 400);
    const conversation = await activeLolaConversation(env, userId, true);
    const rawSession = String(body.sessionId || "").trim();
    const requestedSession = (!rawSession || rawSession === "legacy") ? conversation.id : rawSession;
    if (requestedSession !== conversation.id) {
      return json({ ok: false, error: "conversation_changed", message: "A conversa mudou. O cliente deve reenviar na conversa atual.", sessionId: conversation.id }, 409);
    }

    const text = cleanText(body.text, 7000);
    const files = cleanFiles(body.files || []);
    if (!text && !files.length) return json({ ok: false, error: "empty_message", message: "Mensagem vazia." }, 400);
    const clientId = String(body.clientId || "").slice(0, 120);

    if (clientId) {
      const duplicate = await env.DB.prepare(`
        SELECT * FROM lola_messages
        WHERE conversation_id = ? AND client_id = ?
        LIMIT 1
      `).bind(conversation.id, clientId).first();
      if (duplicate) return json({ message: lolaMessagePublic(duplicate, userId, conversation.id), duplicate: true });
    }

    const stamp = nowIso();
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO lola_messages (
          id, conversation_id, role, content, created_at, client_id, files_json, reply_json, proactive
        ) VALUES (?, ?, 'user', ?, ?, ?, ?, ?, 0)
      `).bind(
        id,
        conversation.id,
        text,
        stamp,
        clientId || null,
        JSON.stringify(files),
        body.replyTo ? JSON.stringify(body.replyTo) : null
      ),
      env.DB.prepare(`UPDATE lola_conversations SET updated_at = ? WHERE id = ?`).bind(stamp, conversation.id),
    ]);
    const row = await env.DB.prepare(`SELECT * FROM lola_messages WHERE id = ?`).bind(id).first();
    return json({ message: lolaMessagePublic(row, userId, conversation.id) }, 201);
  }

  if (method === "POST" && path === "/api/ai/chat") {
    if (!env.AI || typeof env.AI.run !== "function") {
      return json({ ok: false, error: "AI_NOT_CONFIGURED", message: "O binding Workers AI chamado AI não está configurado." }, 503);
    }

    const body = await readJson(request);
    if (!body) return json({ ok: false, error: "JSON inválido." }, 400);
    const proactive = Boolean(body.proactive);
    const conversation = await activeLolaConversation(env, userId, true);
    const rawSession = String(body.sessionId || "").trim();
    const requestedSession = (!rawSession || rawSession === "legacy") ? conversation.id : rawSession;
    if (requestedSession !== conversation.id) {
      return json({ ok: false, error: "conversation_changed", message: "A conversa mudou. O cliente deve reenviar na conversa atual.", sessionId: conversation.id }, 409);
    }

    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const rate = await env.DB.prepare(`
      SELECT COUNT(*) AS n
      FROM lola_messages lm
      JOIN lola_conversations lc ON lc.id = lm.conversation_id
      WHERE lc.user_id = ? AND lm.role = 'user' AND lm.created_at >= ?
    `).bind(userId, oneMinuteAgo).first();
    if (Number(rate?.n || 0) > 14) {
      return json({ ok: false, error: "AI_RATE_LIMIT", message: "Muitas mensagens em pouco tempo. Aguarde alguns segundos." }, 429);
    }

    const userText = String(body.userText || "").trim().slice(0, 7000);
    const attachments = cleanFiles(body.attachments || []);
    if (!proactive && !userText && !attachments.length) {
      return json({ ok: false, error: "empty_message", message: "Envie texto ou imagem para conversar com a Lola." }, 400);
    }

    const rows = await env.DB.prepare(`
      SELECT *
      FROM lola_messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(conversation.id, LOLA_MAX_CONTEXT_MESSAGES).all();
    const historyRows = (rows.results || []).slice().reverse();
    const recentReplies = historyRows.filter(x => x.role === "assistant").slice(-6).map(x => String(x.content || ""));
    const messages = [{ role: "system", content: lolaSystemPrompt(authResult.auth.user, body.memory, recentReplies) }];

    for (const row of historyRows) {
      const role = row.role === "assistant" ? "assistant" : "user";
      messages.push({ role, content: String(row.content || "").slice(0, 7000) || (role === "user" ? "[anexo enviado]" : "") });
    }

    // Se a mensagem ainda não foi persistida por algum motivo, inclua-a no contexto.
    const lastUser = [...historyRows].reverse().find(x => x.role === "user");
    const currentAlreadyPersisted = !!lastUser && String(lastUser.content || "").trim() === userText.trim();
    if (!proactive && !currentAlreadyPersisted) {
      messages.push({ role: "user", content: lolaContentFromTextAndImages(userText, attachments) });
    } else if (!proactive && attachments.length) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          messages[i] = { role: "user", content: lolaContentFromTextAndImages(userText || String(lastUser?.content || ""), attachments) };
          break;
        }
      }
    }

    if (proactive) {
      messages.push({ role: "user", content: "Inicie esta conversa com uma saudação curta, natural e variada. Não faça uma apresentação longa." });
    }

    const lolaModel = String(env.LOLA_MODEL || LOLA_MODEL).trim() || LOLA_MODEL;
    let result = null;
    let providerError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await env.AI.run(lolaModel, {
          messages,
          max_tokens: LOLA_MAX_OUTPUT_TOKENS,
          temperature: 0.75,
          top_k: 40,
          repetition_penalty: 1.08,
          frequency_penalty: 0.25,
          presence_penalty: 0.15,
        });
        providerError = null;
        break;
      } catch (error) {
        providerError = error;
        if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    if (providerError) {
      console.error("LOLA WORKERS AI ERROR", providerError);
      return json({ ok: false, error: "AI_PROVIDER_ERROR", message: "O Workers AI não conseguiu gerar a resposta agora. Tente novamente em instantes." }, 502);
    }

    const reply = String(result?.response ?? result?.result ?? result?.text ?? "").trim();
    if (!reply) {
      return json({ ok: false, error: "AI_EMPTY_RESPONSE", message: "O modelo respondeu sem texto." }, 502);
    }

    const latest = await activeLolaConversation(env, userId, true);
    if (latest.id !== conversation.id) {
      return json({ ok: false, error: "conversation_changed", message: "A conversa foi reiniciada durante a resposta.", sessionId: latest.id }, 409);
    }

    const stamp = nowIso();
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO lola_messages (
          id, conversation_id, role, content, created_at, client_id, files_json, reply_json, proactive
        ) VALUES (?, ?, 'assistant', ?, ?, NULL, '[]', NULL, ?)
      `).bind(id, conversation.id, reply, stamp, proactive ? 1 : 0),
      env.DB.prepare(`UPDATE lola_conversations SET updated_at = ? WHERE id = ?`).bind(stamp, conversation.id),
    ]);

    const row = await env.DB.prepare(`SELECT * FROM lola_messages WHERE id = ?`).bind(id).first();
    return json({
      ok: true,
      reply,
      message: lolaMessagePublic(row, userId, conversation.id),
      sessionId: conversation.id,
      model: lolaModel,
      provider: "cloudflare-workers-ai",
      proactive,
      usage: result?.usage || null,
    });
  }

  return null;
}


async function ensureAzurePointsSchema(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS azurepoints_wallets (
      user_id TEXT PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0,
      lifetime_earned INTEGER NOT NULL DEFAULT 0,
      lifetime_spent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS azurepoints_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS azurepoints_redemptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      points_amount INTEGER NOT NULL,
      requested_value_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
}

async function ensureAzurePointsWallet(env, userId) {
  await ensureAzurePointsSchema(env);
  const stamp = nowIso();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO azurepoints_wallets
      (user_id, balance, lifetime_earned, lifetime_spent, created_at, updated_at)
    VALUES (?, 0, 0, 0, ?, ?)
  `).bind(userId, stamp, stamp).run();
  const welcome = await env.DB.prepare(`
    SELECT id FROM azurepoints_transactions
    WHERE user_id = ? AND type = 'welcome'
    LIMIT 1
  `).bind(userId).first();
  if (!welcome) {
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE azurepoints_wallets
        SET balance = balance + 100,
            lifetime_earned = lifetime_earned + 100,
            updated_at = ?
        WHERE user_id = ?
      `).bind(stamp, userId),
      env.DB.prepare(`
        INSERT INTO azurepoints_transactions
          (id, user_id, amount, type, description, created_at)
        VALUES (?, ?, 100, 'welcome', 'Bônus de boas-vindas do Azurecord', ?)
      `).bind(crypto.randomUUID(), userId, stamp),
    ]);
  }
}

async function azurePointsWallet(env, userId) {
  await ensureAzurePointsWallet(env, userId);
  const wallet = await env.DB.prepare(`
    SELECT balance, lifetime_earned, lifetime_spent
    FROM azurepoints_wallets WHERE user_id = ? LIMIT 1
  `).bind(userId).first();
  const pending = await env.DB.prepare(`
    SELECT COALESCE(SUM(points_amount), 0) AS reserved
    FROM azurepoints_redemptions
    WHERE user_id = ? AND status = 'pending'
  `).bind(userId).first();
  const reserved = Number(pending?.reserved || 0);
  const balance = Number(wallet?.balance || 0);
  return {
    balance,
    earned: Number(wallet?.lifetime_earned || 0),
    spent: Number(wallet?.lifetime_spent || 0),
    reserved,
    available: Math.max(0, balance - reserved),
  };
}

async function handleAzurePoints(request, env, path) {
  if (!path.startsWith('/api/points/')) return null;
  const authResult = await requireSocialAuth(request, env);
  if (authResult.response) return authResult.response;
  const userId = authResult.auth.user.id;

  if (request.method === 'GET' && path === '/api/points/wallet') {
    return json({
      ok: true,
      wallet: await azurePointsWallet(env, userId),
      cashoutEnabled: false,
      pointsPerBRL: 100,
      minRedeemPoints: 500,
      moneyIsRealOnlyAfterExternalPayment: true,
      cloud: true,
    });
  }
  if (request.method === 'GET' && path === '/api/points/history') {
    await ensureAzurePointsWallet(env, userId);
    const rows = await env.DB.prepare(`
      SELECT id, amount, type, description, created_at
      FROM azurepoints_transactions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).bind(userId).all();
    return json({ ok: true, entries: (rows.results || []).map(row => ({
      id: row.id,
      delta: Number(row.amount || 0),
      reason: row.description || row.type || 'movimentação',
      type: row.type,
      createdAt: row.created_at,
    })) });
  }
  if (request.method === 'GET' && path === '/api/points/shop') {
    return json({ ok: true, items: [], message: 'Loja em preparação. Nenhum item à venda nesta versão.' });
  }
  if (request.method === 'GET' && path === '/api/points/redemptions') {
    await ensureAzurePointsWallet(env, userId);
    const rows = await env.DB.prepare(`
      SELECT id, points_amount, requested_value_cents, status, created_at, reviewed_at
      FROM azurepoints_redemptions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).bind(userId).all();
    return json({ ok: true, redemptions: (rows.results || []).map(row => ({
      id: row.id,
      points: Number(row.points_amount || 0),
      amountCentavos: Number(row.requested_value_cents || 0),
      currency: 'BRL',
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.reviewed_at || row.created_at,
    })) });
  }
  if (request.method === 'POST' && path === '/api/points/redemptions') {
    return json({ ok: false, error: 'cashout_unavailable', message: 'Resgates em dinheiro ainda não estão habilitados no Azurecord Cloud.' }, 503);
  }
  return null;
}


async function ensureSettingsSchema(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      theme TEXT NOT NULL DEFAULT 'dark',
      language TEXT NOT NULL DEFAULT 'pt-BR',
      allow_friend_requests INTEGER NOT NULL DEFAULT 1,
      allow_dms_from_friends INTEGER NOT NULL DEFAULT 1,
      lola_enabled INTEGER NOT NULL DEFAULT 1,
      lola_memory_enabled INTEGER NOT NULL DEFAULT 1,
      notifications_enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
  await addColumnIfMissing(env, "user_settings", "native_notifications", "INTEGER NOT NULL DEFAULT 1");
  await addColumnIfMissing(env, "user_settings", "compact_mode", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(env, "user_settings", "reduced_motion", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(env, "user_settings", "media_autoplay", "INTEGER NOT NULL DEFAULT 1");
}

async function ensureUserSettings(env, userId) {
  await ensureSettingsSchema(env);
  const stamp = nowIso();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO user_settings (
      user_id, theme, language, allow_friend_requests, allow_dms_from_friends,
      lola_enabled, lola_memory_enabled, notifications_enabled, updated_at
    ) VALUES (?, 'dark', 'pt-BR', 1, 1, 1, 1, 1, ?)
  `).bind(userId, stamp).run();
}

async function readUserSettings(env, userId) {
  await ensureUserSettings(env, userId);
  const row = await env.DB.prepare(`SELECT * FROM user_settings WHERE user_id = ? LIMIT 1`).bind(userId).first();
  return {
    theme: row?.theme || 'dark',
    language: row?.language || 'pt-BR',
    allowFriendRequests: Number(row?.allow_friend_requests ?? 1) === 1,
    allowDmsFromFriends: Number(row?.allow_dms_from_friends ?? 1) === 1,
    lolaEnabled: Number(row?.lola_enabled ?? 1) === 1,
    lolaMemoryEnabled: Number(row?.lola_memory_enabled ?? 1) === 1,
    notificationsEnabled: Number(row?.notifications_enabled ?? 1) === 1,
    nativeNotifications: Number(row?.native_notifications ?? 1) === 1,
    compactMode: Number(row?.compact_mode ?? 0) === 1,
    reducedMotion: Number(row?.reduced_motion ?? 0) === 1,
    mediaAutoplay: Number(row?.media_autoplay ?? 1) === 1,
    updatedAt: row?.updated_at || null,
  };
}

async function updateUserSettings(request, env, userId) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'JSON inválido.' }, 400);
  const current = await readUserSettings(env, userId);
  const next = {
    theme: ['dark','light'].includes(body.theme) ? body.theme : current.theme,
    language: body.language === 'pt-BR' ? 'pt-BR' : current.language,
    allowFriendRequests: body.allowFriendRequests ?? current.allowFriendRequests,
    allowDmsFromFriends: body.allowDmsFromFriends ?? current.allowDmsFromFriends,
    lolaEnabled: body.lolaEnabled ?? current.lolaEnabled,
    lolaMemoryEnabled: body.lolaMemoryEnabled ?? current.lolaMemoryEnabled,
    notificationsEnabled: body.notificationsEnabled ?? current.notificationsEnabled,
    nativeNotifications: body.nativeNotifications ?? current.nativeNotifications,
    compactMode: body.compactMode ?? current.compactMode,
    reducedMotion: body.reducedMotion ?? current.reducedMotion,
    mediaAutoplay: body.mediaAutoplay ?? current.mediaAutoplay,
  };
  const stamp = nowIso();
  await env.DB.prepare(`
    UPDATE user_settings SET
      theme = ?, language = ?, allow_friend_requests = ?, allow_dms_from_friends = ?,
      lola_enabled = ?, lola_memory_enabled = ?, notifications_enabled = ?,
      native_notifications = ?, compact_mode = ?, reduced_motion = ?, media_autoplay = ?, updated_at = ?
    WHERE user_id = ?
  `).bind(
    next.theme, next.language,
    next.allowFriendRequests ? 1 : 0,
    next.allowDmsFromFriends ? 1 : 0,
    next.lolaEnabled ? 1 : 0,
    next.lolaMemoryEnabled ? 1 : 0,
    next.notificationsEnabled ? 1 : 0,
    next.nativeNotifications ? 1 : 0,
    next.compactMode ? 1 : 0,
    next.reducedMotion ? 1 : 0,
    next.mediaAutoplay ? 1 : 0,
    stamp, userId
  ).run();
  return json({ ok: true, settings: await readUserSettings(env, userId) });
}

async function ensureSocialSchema(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS ignored_users (
      user_id TEXT NOT NULL,
      ignored_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, ignored_user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (ignored_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();

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
  await addColumnIfMissing(env, "channel_messages", "poll_json", "TEXT");
  await addColumnIfMissing(env, "channel_messages", "system_json", "TEXT");
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS user_presence (
      user_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'offline',
      custom_status TEXT,
      last_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS poll_votes (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      option_index INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (message_id, user_id)
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS realtime_signals (
      id TEXT PRIMARY KEY,
      target_user_id TEXT NOT NULL,
      source_user_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_realtime_signals_target_created ON realtime_signals(target_user_id, created_at)`).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS call_share_state (
      call_id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      peer_user_id TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_call_share_peer ON call_share_state(peer_user_id, updated_at)`).run();
  await addColumnIfMissing(env, "channels", "topic", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(env, "servers", "icon", "TEXT");
  await addColumnIfMissing(env, "servers", "banner_url", "TEXT");
  await addColumnIfMissing(env, "servers", "accent", "TEXT NOT NULL DEFAULT '#5865f2'");
  await addColumnIfMissing(env, "servers", "features_json", "TEXT NOT NULL DEFAULT '[]'");
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
  return value.slice(0, 3).map(file => {
    const url = String(file?.url || "").slice(0, 1400);
    return {
      name: String(file?.name || "arquivo").slice(0, 180),
      type: String(file?.type || "").slice(0, 120),
      size: Math.max(0, Number(file?.size) || 0),
      dataUrl: String(file?.dataUrl || "").slice(0, 750000),
      url: /^https:\/\//i.test(url) ? url : "",
      key: String(file?.key || "").slice(0, 500),
    };
  });
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

function normalizedPresenceStatus(status) {
  return ["online","idle","dnd","offline"].includes(String(status)) ? String(status) : "offline";
}

async function presenceDetailsFor(env, userId, fallbackStatus="online") {
  const row = await env.DB.prepare(`
    SELECT status, custom_status, last_seen_at, updated_at
    FROM user_presence
    WHERE user_id = ?
    LIMIT 1
  `).bind(userId).first();

  if (!row) {
    return {
      status: "offline",
      customStatus: "",
      lastSeenAt: null,
      updatedAt: null,
    };
  }

  const seen = Date.parse(row.last_seen_at || row.updated_at || 0);
  const fresh = Number.isFinite(seen) && Date.now() - seen <= 65000;
  const live = fresh ? normalizedPresenceStatus(row.status) : "offline";
  const status = String(fallbackStatus) === "offline" ? "offline" : live;

  return {
    status,
    customStatus: cleanText(row.custom_status || "", 120),
    lastSeenAt: row.last_seen_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function livePresenceFor(env, userId, fallbackStatus="online") {
  return (await presenceDetailsFor(env, userId, fallbackStatus)).status;
}

async function socialUserById(env, id) {
  const base = await readUserById(env, id);
  const user = socialUser(base);
  if (!user) return null;
  const presence = await presenceDetailsFor(env, id, base?.status || "online");
  user.status = presence.status;
  user.customStatus = presence.customStatus;
  user.lastSeenAt = presence.lastSeenAt;
  user.statusUpdatedAt = presence.updatedAt;
  return user;
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

  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO dm_conversations (id, created_at, updated_at) VALUES (?, ?, ?)`).bind(id, stamp, stamp),
      env.DB.prepare(`INSERT INTO dm_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)`).bind(id, a, stamp),
      env.DB.prepare(`INSERT INTO dm_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)`).bind(id, b, stamp),
    ]);
    return { id, created_at: stamp, updated_at: stamp };
  } catch (error) {
    const raced = await getDmConversation(env, a, b);
    if (raced) return raced;
    try { await env.DB.prepare(`DELETE FROM dm_conversations WHERE id = ?`).bind(id).run(); } catch {}
    throw error;
  }
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
    if (await blockedBetween(env, userId, other.user_id)) continue;
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

async function listServerMembers(env, serverId) {
  const rows = await env.DB.prepare(`
    SELECT user_id, role, nickname, joined_at
    FROM server_members
    WHERE server_id = ?
    ORDER BY joined_at ASC
  `).bind(serverId).all();
  const members = [];
  for (const row of rows.results || []) {
    const user = await socialUserById(env, row.user_id);
    if (!user) continue;
    members.push({
      ...user,
      role: row.role || "Membro",
      nickname: row.nickname || "",
      joinedAt: row.joined_at || null,
    });
  }
  return members;
}

async function realtimePeerIds(env, userId) {
  const ids = new Set();
  const friends = await env.DB.prepare(`
    SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS peer_id
    FROM friendships WHERE user_a = ? OR user_b = ?
  `).bind(userId, userId, userId).all();
  for (const row of friends.results || []) if (row.peer_id && row.peer_id !== userId) ids.add(String(row.peer_id));

  const shared = await env.DB.prepare(`
    SELECT DISTINCT other.user_id AS peer_id
    FROM server_members mine
    JOIN server_members other ON other.server_id = mine.server_id
    WHERE mine.user_id = ? AND other.user_id <> ?
    LIMIT 500
  `).bind(userId, userId).all();
  for (const row of shared.results || []) if (row.peer_id) ids.add(String(row.peer_id));
  return [...ids];
}

async function presencePayloadForPeers(env, userId) {
  const ids = await realtimePeerIds(env, userId);
  const presence = [];
  for (const id of ids) {
    const details = await presenceDetailsFor(env, id, "online");
    presence.push({
      userId: id,
      status: details.status,
      customStatus: details.customStatus,
      lastSeenAt: details.lastSeenAt,
      updatedAt: details.updatedAt,
    });
  }
  return presence;
}

function cleanPoll(value) {
  if (!value || typeof value !== "object") return null;
  const question = cleanText(value.question || "", 240);
  const options = (Array.isArray(value.options) ? value.options : [])
    .map(x => cleanText(x, 120))
    .filter(Boolean)
    .slice(0, 6);
  if (!question || options.length < 2) return null;
  return { question, options };
}

async function pollPublic(env, row, userId) {
  const poll = cleanPoll(parseJsonValue(row?.poll_json, null));
  if (!poll || !row?.id) return null;
  const counts = Array(poll.options.length).fill(0);
  const grouped = await env.DB.prepare(`
    SELECT option_index, COUNT(*) AS n
    FROM poll_votes
    WHERE message_id = ?
    GROUP BY option_index
  `).bind(row.id).all();
  for (const vote of grouped.results || []) {
    const idx = Number(vote.option_index);
    if (Number.isInteger(idx) && idx >= 0 && idx < counts.length) counts[idx] = Number(vote.n || 0);
  }
  const mine = await env.DB.prepare(`SELECT option_index FROM poll_votes WHERE message_id = ? AND user_id = ? LIMIT 1`).bind(row.id, userId).first();
  return {
    ...poll,
    votes: counts,
    totalVotes: counts.reduce((a,b)=>a+b,0),
    myVote: Number.isInteger(Number(mine?.option_index)) ? Number(mine.option_index) : null,
  };
}

function cleanCallSignal(value) {
  if (!value || typeof value !== "object") return null;
  const kind = String(value.kind || "");
  const callId = String(value.callId || "").slice(0, 120);
  const callType = ["voice","video","screen","server-voice"].includes(String(value.callType)) ? String(value.callType) : "voice";
  const allowed = ["ring","offer","answer","ice","ice-restart","accepted","hangup","decline","busy","screen-share-start","screen-share-stop","screen-offer","screen-answer","native-screen-offer","native-screen-answer","native-screen-ice","native-screen-stop","native-screen-resync","server-voice-join","server-voice-ack","server-voice-offer","server-voice-answer","server-voice-ice","server-voice-leave"];
  if (!callId || !allowed.includes(kind)) return null;
  const signalId = String(value.signalId || "").slice(0, 120);
  const out = { kind, callId, callType, signalId };
  if (["offer","answer","screen-offer","screen-answer","native-screen-offer","native-screen-answer","server-voice-offer","server-voice-answer"].includes(kind) && value.description && typeof value.description === "object") out.description = value.description;
  if (Number.isFinite(Number(value.shareRevision))) out.shareRevision = Math.max(0, Math.floor(Number(value.shareRevision)));
  if (["ice","native-screen-ice","server-voice-ice"].includes(kind) && value.candidate && typeof value.candidate === "object") out.candidate = value.candidate;
  if (kind.startsWith("server-voice-")) {
    out.serverId = String(value.serverId || "").slice(0, 120);
    out.channelId = String(value.channelId || "").slice(0, 120);
    if (!out.serverId || !out.channelId) return null;
  }
  if (value.reason) out.reason = String(value.reason).slice(0, 80);
  return JSON.stringify(out).length <= 180000 ? out : null;
}


async function updateCallShareState(env, { callId, ownerUserId, peerUserId, active }) {
  const stamp = nowIso();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const existing = await env.DB.prepare(`SELECT revision FROM call_share_state WHERE call_id = ? LIMIT 1`).bind(callId).first();
  const revision = Math.max(1, Number(existing?.revision || 0) + 1);
  await env.DB.prepare(`
    INSERT INTO call_share_state (call_id, owner_user_id, peer_user_id, active, revision, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(call_id) DO UPDATE SET
      owner_user_id = excluded.owner_user_id,
      peer_user_id = excluded.peer_user_id,
      active = excluded.active,
      revision = excluded.revision,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
  `).bind(callId, ownerUserId, peerUserId, active ? 1 : 0, revision, stamp, expiresAt).run();
  return { callId, ownerUserId, peerUserId, active: !!active, revision, updatedAt: stamp, expiresAt };
}

async function readCallShareState(env, callId, userId) {
  const row = await env.DB.prepare(`
    SELECT call_id, owner_user_id, peer_user_id, active, revision, updated_at, expires_at
    FROM call_share_state WHERE call_id = ? LIMIT 1
  `).bind(callId).first();
  if (!row) return null;
  if (row.owner_user_id !== userId && row.peer_user_id !== userId) return null;
  if (Date.parse(row.expires_at || 0) < Date.now()) {
    await env.DB.prepare(`DELETE FROM call_share_state WHERE call_id = ?`).bind(callId).run();
    return null;
  }
  return {
    callId: row.call_id,
    ownerUserId: row.owner_user_id,
    peerUserId: row.peer_user_id,
    active: !!row.active,
    revision: Number(row.revision || 0),
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

async function serverPublic(env, row, userId) {
  if (!row) return null;
  const membership = await env.DB.prepare(`SELECT role FROM server_members WHERE server_id = ? AND user_id = ? LIMIT 1`).bind(row.id, userId).first();
  const invite = await env.DB.prepare(`SELECT code FROM server_invites WHERE server_id = ? ORDER BY created_at DESC LIMIT 1`).bind(row.id).first();
  const channels = await env.DB.prepare(`SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, created_at ASC`).bind(row.id).all();
  const members = await listServerMembers(env, row.id);
  return {
    id: row.id,
    name: row.name,
    icon: row.icon || String(row.name || "S")[0] || "S",
    iconUrl: row.icon_url || "",
    bannerUrl: row.banner_url || "",
    accent: row.accent || "#5865f2",
    features: parseJsonValue(row.features_json, []),
    owner: row.owner_id,
    invite: invite?.code || "",
    description: row.description || "Comunidade do Azurecord.",
    createdAt: row.created_at,
    myRole: row.owner_id === userId ? "Admin" : (membership?.role || "Membro"),
    memberCount: members.length,
    members,
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


async function listUserControlProfiles(env, userId, kind) {
  const table = kind === 'blocked' ? 'blocks' : 'ignored_users';
  const ownColumn = kind === 'blocked' ? 'blocker_id' : 'user_id';
  const otherColumn = kind === 'blocked' ? 'blocked_id' : 'ignored_user_id';
  const rows = await env.DB.prepare(`
    SELECT ${otherColumn} AS other_id
    FROM ${table}
    WHERE ${ownColumn} = ?
    ORDER BY created_at DESC
  `).bind(userId).all();
  const users = [];
  for (const row of rows.results || []) {
    const user = await socialUserById(env, row.other_id);
    if (user) users.push(user);
  }
  return users;
}

async function handleSocial(request, env, url, path) {
  await ensureSocialSchema(env);
  const authResult = await requireSocialAuth(request, env);
  if (authResult.response) return authResult.response;
  const userId = authResult.auth.user.id;
  const method = request.method;
  const parts = path.split("/").filter(Boolean);

  if (path === "/api/settings" && method === "GET") {
    return json({ ok: true, settings: await readUserSettings(env, userId) });
  }
  if (path === "/api/settings" && method === "PATCH") {
    return await updateUserSettings(request, env, userId);
  }

  if (path === "/api/presence/heartbeat" && method === "POST") {
    const body = await readJson(request) || {};
    const status = normalizedPresenceStatus(body.status || "online");
    const stamp = nowIso();
    await env.DB.prepare(`
      INSERT INTO user_presence (user_id, status, custom_status, last_seen_at, updated_at)
      VALUES (?, ?, '', ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        status = excluded.status,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
    `).bind(userId, status, stamp, stamp).run();
    const self = await presenceDetailsFor(env, userId, status);
    return json({
      ok: true,
      status: self.status,
      customStatus: self.customStatus,
      lastSeenAt: self.lastSeenAt,
      updatedAt: self.updatedAt,
      presence: await presencePayloadForPeers(env, userId),
      serverTime: stamp,
    });
  }

  if (path === "/api/presence" && method === "PATCH") {
    const body = await readJson(request) || {};
    const status = normalizedPresenceStatus(body.status || "online");
    const customStatus = cleanText(body.customStatus || "", 120);
    const stamp = nowIso();
    await env.DB.prepare(`
      INSERT INTO user_presence (user_id, status, custom_status, last_seen_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        status = excluded.status,
        custom_status = excluded.custom_status,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
    `).bind(userId, status, customStatus, stamp, stamp).run();
    const presence = await presenceDetailsFor(env, userId, status);
    return json({ ok: true, presence, serverTime: stamp });
  }

  if (path === "/api/realtime/peers" && method === "GET") {
    return json({ ok: true, peers: await realtimePeerIds(env, userId) });
  }

  if (parts[0] === "api" && parts[1] === "realtime" && parts[2] === "calls" && parts[3] && parts[4] === "share" && method === "GET") {
    const callId = String(parts[3] || "");
    const state = await readCallShareState(env, callId, userId);
    if (!state) return json({ ok: true, state: null });
    return json({ ok: true, state });
  }

  if (path === "/api/realtime/ice-servers" && method === "GET") {
    const fallback = [
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:stun.l.google.com:19302" },
    ];
    const keyId = String(env.TURN_KEY_ID || "").trim();
    const apiToken = String(env.TURN_KEY_API_TOKEN || "").trim();
    if (!keyId || !apiToken) {
      return json({ ok: true, iceServers: fallback, turn: false, ttl: 60 });
    }
    try {
      const ttl = 3600;
      const response = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ttl }),
        }
      );
      if (!response.ok) {
        console.error("AZURECALL TURN CREDENTIAL ERROR", { status: response.status });
        return json({ ok: true, iceServers: fallback, turn: false, ttl: 60 });
      }
      const data = await response.json().catch(() => ({}));
      const iceServers = Array.isArray(data?.iceServers) ? data.iceServers.filter(server => server && server.urls) : [];
      return json({ ok: true, iceServers: iceServers.length ? iceServers : fallback, turn: iceServers.some(server => String(server.urls).includes("turn:") || String(server.urls).includes("turns:")), ttl });
    } catch (error) {
      console.error("AZURECALL TURN CREDENTIAL ERROR", { message: String(error?.message || error) });
      return json({ ok: true, iceServers: fallback, turn: false, ttl: 60 });
    }
  }

  if (path === "/api/realtime/signals" && method === "POST") {
    const body = await readJson(request) || {};
    const targetUserId = String(body.targetUserId || "");
    const signal = cleanCallSignal(body.signal);
    if (!targetUserId || targetUserId === userId || !signal) return json({ error: "invalid_signal", message: "Sinal de chamada inválido." }, 400);
    const serverVoice = signal.kind.startsWith("server-voice-");
    if (serverVoice) {
      const [sourceMembership, targetMembership, voiceChannel] = await Promise.all([
        serverMembership(env, signal.serverId, userId),
        serverMembership(env, signal.serverId, targetUserId),
        env.DB.prepare(`SELECT id FROM channels WHERE id = ? AND server_id = ? AND type = 'voice' LIMIT 1`).bind(signal.channelId, signal.serverId).first(),
      ]);
      if (!sourceMembership.member || !targetMembership.member || !voiceChannel) {
        return json({ error: "forbidden", message: "Canal de voz indisponível para estes membros." }, 403);
      }
    } else if (!(await friendshipExists(env, userId, targetUserId))) {
      return json({ error: "forbidden", message: "Chamadas privadas são permitidas entre amigos." }, 403);
    }
    const stamp = nowIso();
    if (signal.kind === "screen-share-start" || signal.kind === "screen-offer") {
      const share = await updateCallShareState(env, { callId: signal.callId, ownerUserId: userId, peerUserId: targetUserId, active: true });
      signal.shareRevision = share.revision;
    } else if (signal.kind === "screen-share-stop") {
      const current = await readCallShareState(env, signal.callId, userId);
      const ownerUserId = current?.ownerUserId || userId;
      const peerUserId = current?.peerUserId || targetUserId;
      const share = await updateCallShareState(env, { callId: signal.callId, ownerUserId, peerUserId, active: false });
      signal.shareRevision = share.revision;
    } else if (signal.kind === "hangup") {
      const current = await readCallShareState(env, signal.callId, userId);
      if (current) await updateCallShareState(env, { callId: signal.callId, ownerUserId: current.ownerUserId, peerUserId: current.peerUserId, active: false });
    }
    const expiresAt = new Date(Date.now() + 90_000).toISOString();
    const id = crypto.randomUUID();
    await env.DB.prepare(`DELETE FROM realtime_signals WHERE expires_at < ?`).bind(stamp).run();
    await env.DB.prepare(`DELETE FROM call_share_state WHERE expires_at < ?`).bind(stamp).run();
    await env.DB.prepare(`
      INSERT INTO realtime_signals (id, target_user_id, source_user_id, payload_json, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, targetUserId, userId, JSON.stringify(signal), stamp, expiresAt).run();
    return json({ ok: true, eventId: id, createdAt: stamp }, 201);
  }

  if (path === "/api/realtime/signals" && method === "GET") {
    const sinceRaw = String(url.searchParams.get("since") || "");
    const sinceMs = Number(sinceRaw) || (Date.now() - 5000);
    const sinceIso = new Date(Math.max(Date.now() - 120_000, sinceMs - 2000)).toISOString();
    const stamp = nowIso();
    await env.DB.prepare(`DELETE FROM realtime_signals WHERE expires_at < ?`).bind(stamp).run();
    const rows = await env.DB.prepare(`
      SELECT id, source_user_id, payload_json, created_at
      FROM realtime_signals
      WHERE target_user_id = ? AND created_at >= ? AND expires_at >= ?
      ORDER BY created_at ASC
      LIMIT 100
    `).bind(userId, sinceIso, stamp).all();
    return json({
      ok: true,
      signals: (rows.results || []).map(row => ({
        eventId: row.id,
        fromUserId: row.source_user_id,
        signal: parseJsonValue(row.payload_json, null),
        at: Date.parse(row.created_at) || Date.now(),
      })).filter(x => x.signal),
      serverTime: Date.now(),
    });
  }

  if (method === "GET" && path === "/api/social/snapshot") {
    const [friends, requests, dms, servers, blockedUsers, ignoredUsers] = await Promise.all([
      listFriends(env, userId),
      listFriendRequests(env, userId),
      listDms(env, userId),
      listServers(env, userId),
      listUserControlProfiles(env, userId, 'blocked'),
      listUserControlProfiles(env, userId, 'ignored'),
    ]);
    return json({ ok: true, friends, requests, dms, servers, blockedUsers, ignoredUsers, serverTime: nowIso() });
  }

  if (parts[0] === "api" && parts[1] === "users" && parts[2] && (parts[3] === "block" || parts[3] === "ignore")) {
    const targetId = parts[2];
    const action = parts[3];
    if (targetId === userId) return json({ error: "self_action", message: "Essa ação não pode ser aplicada à própria conta." }, 400);
    const target = await socialUserById(env, targetId);
    if (!target) return json({ error: "user_not_found", message: "Usuário não encontrado." }, 404);
    if (action === "block" && method === "POST") {
      const stamp = nowIso();
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM friendships WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)`).bind(userId, targetId, targetId, userId),
        env.DB.prepare(`DELETE FROM friend_requests WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)`).bind(userId, targetId, targetId, userId),
        env.DB.prepare(`DELETE FROM ignored_users WHERE user_id = ? AND ignored_user_id = ?`).bind(userId, targetId),
        env.DB.prepare(`INSERT OR REPLACE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`).bind(userId, targetId, stamp),
      ]);
      return json({ ok: true, blocked: true, friendshipRemoved: true, user: target });
    }
    if (action === "block" && method === "DELETE") {
      await env.DB.prepare(`DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?`).bind(userId, targetId).run();
      return json({ ok: true, blocked: false, friendshipRestored: false });
    }
    if (action === "ignore" && method === "POST") {
      if (await blockedBetween(env, userId, targetId)) return json({ error: "blocked", message: "Desbloqueie o usuário antes de usar Ignorar." }, 409);
      await env.DB.prepare(`INSERT OR REPLACE INTO ignored_users (user_id, ignored_user_id, created_at) VALUES (?, ?, ?)`).bind(userId, targetId, nowIso()).run();
      return json({ ok: true, ignored: true, user: target });
    }
    if (action === "ignore" && method === "DELETE") {
      await env.DB.prepare(`DELETE FROM ignored_users WHERE user_id = ? AND ignored_user_id = ?`).bind(userId, targetId).run();
      return json({ ok: true, ignored: false });
    }
  }

  if (method === "GET" && path === "/api/users") {
    const raw = String(url.searchParams.get("search") || "").trim();
    const q = publicSearchKey(raw);
    if (!q) return json({ users: [] });

    const like = `%${normalizeUsername(raw).replace(/^@/, "")}%`;
    const direct = await env.DB.prepare(`
      SELECT id, username, username_normalized, display_name
      FROM users
      WHERE
        id <> ?
        AND account_status = 'active'
        AND (
          username_normalized LIKE ?
          OR LOWER(username) LIKE ?
          OR LOWER(COALESCE(display_name, '')) LIKE ?
        )
      ORDER BY username_normalized ASC
      LIMIT 50
    `).bind(userId, like, like, like).all();

    let candidates = direct.results || [];

    if (!candidates.length) {
      const fallback = await env.DB.prepare(`
        SELECT id, username, username_normalized, display_name
        FROM users
        WHERE id <> ? AND account_status = 'active'
        ORDER BY updated_at DESC
        LIMIT 250
      `).bind(userId).all();

      candidates = (fallback.results || []).filter(row =>
        publicSearchKey(row.username).includes(q) ||
        publicSearchKey(row.username_normalized).includes(q) ||
        publicSearchKey(row.display_name).includes(q)
      );
    } else {
      candidates = candidates.filter(row =>
        publicSearchKey(row.username).includes(q) ||
        publicSearchKey(row.username_normalized).includes(q) ||
        publicSearchKey(row.display_name).includes(q)
      );
    }

    const users = [];
    const seen = new Set();
    for (const row of candidates.slice(0, 25)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const user = await socialUserById(env, row.id);
      if (user) users.push(user);
    }

    return json({ users, query: q });
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
    try {
      await env.DB.prepare(`
        INSERT INTO friend_requests (id, sender_id, receiver_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', ?, ?)
      `).bind(id, userId, targetId, stamp, stamp).run();
      return json({ request: { id, from: userId, to: targetId, status: "pending", createdAt: stamp, updatedAt: stamp }, accepted: false }, 201);
    } catch (error) {
      const raced = await env.DB.prepare(`
        SELECT * FROM friend_requests
        WHERE status = 'pending'
          AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
        LIMIT 1
      `).bind(userId, targetId, targetId, userId).first();
      if (raced) {
        return json({
          request: {
            id: raced.id,
            from: raced.sender_id,
            to: raced.receiver_id,
            status: raced.status,
            createdAt: raced.created_at,
            updatedAt: raced.updated_at,
          },
          accepted: false,
          duplicate: true,
        }, 200);
      }
      throw error;
    }
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

      try {
        await insertCompatible(env, "messages", {
          id,
          conversation_id: conversation.id,
          sender_id: userId,
          content: text,
          created_at: stamp,
          edited_at: null,
          deleted_at: null,
          client_id: clientId || null,
          recipient_id: otherId,
          files_json: JSON.stringify(files),
          reply_json: body?.replyTo ? JSON.stringify(body.replyTo) : null,
        });

        await env.DB.prepare(`UPDATE dm_conversations SET updated_at = ? WHERE id = ?`).bind(stamp, conversation.id).run();
        await env.DB.prepare(`DELETE FROM dm_hidden WHERE conversation_id = ?`).bind(conversation.id).run();
      } catch (error) {
        console.error("AZURECORD DM SEND ERROR", { message: String(error?.message || error), userId, otherId, conversationId: conversation.id });
        return json({
          ok: false,
          error: "DM_SEND_FAILED",
          message: "Não foi possível enviar esta mensagem agora. Tente novamente.",
        }, 500);
      }

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
    let welcomeMessage = null;
    let welcomeChannelId = null;
    if (!existing) {
      const stamp = nowIso();
      const general = await env.DB.prepare(`
        SELECT id FROM channels WHERE server_id = ? AND type = 'text'
        ORDER BY CASE WHEN LOWER(name) = 'geral' THEN 0 ELSE 1 END, position ASC, created_at ASC
        LIMIT 1
      `).bind(server.id).first();
      const welcomeId = general?.id ? crypto.randomUUID() : null;
      const username = authResult.auth.user.username || authResult.auth.user.displayName || "Novo membro";
      const welcomeText = `👋 ${username} entrou no servidor. Boas-vindas!`;
      const statements = [
        env.DB.prepare(`INSERT INTO server_members (server_id, user_id, role, nickname, joined_at) VALUES (?, ?, 'Membro', NULL, ?)`).bind(server.id, userId, stamp),
        env.DB.prepare(`UPDATE server_invites SET uses = uses + 1 WHERE id = ?`).bind(invite.id),
      ];
      if (general?.id && welcomeId) {
        statements.push(env.DB.prepare(`
          INSERT INTO channel_messages (id, channel_id, sender_id, content, created_at, edited_at, deleted_at, client_id, files_json, reply_json, system_json)
          VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, '[]', NULL, ?)
        `).bind(welcomeId, general.id, userId, welcomeText, stamp, JSON.stringify({ type: "member_join", userId, username })));
      }
      await env.DB.batch(statements);
      if (general?.id && welcomeId) {
        welcomeChannelId = general.id;
        welcomeMessage = {
          id: welcomeId, channelId: general.id, serverId: server.id, senderId: userId,
          author: await socialUserById(env, userId), text: welcomeText, time: Date.parse(stamp), createdAt: stamp,
          files: [], file: null, replyTo: null, edited: false, deleted: false,
          system: { type: "member_join", userId, username },
        };
      }
    }
    const output = await serverPublic(env, server, userId);
    return json({ server: output, channels: output.channels, alreadyMember: !!existing, welcomeMessage, welcomeChannelId }, existing ? 200 : 201);
  }

  if (parts[0] === "api" && parts[1] === "servers" && parts[2]) {
    const serverId = parts[2];
    const membership = await serverMembership(env, serverId, userId);
    if (!membership.server) return json({ error: "server_not_found", message: "Servidor não encontrado." }, 404);
    const manager = membership.server.owner_id === userId || membership.role === "Admin";

    if (method === "PATCH" && parts.length === 3) {
      if (!manager) return json({ error: "forbidden", message: "Sem permissão para editar o servidor." }, 403);
      const body = await readJson(request);
      if (!body) return json({ error: "invalid_json", message: "JSON inválido." }, 400);
      const name = cleanText(body.name ?? membership.server.name, 80) || membership.server.name;
      const description = cleanText(body.description ?? membership.server.description ?? '', 240);
      const icon = cleanText(body.icon ?? membership.server.icon ?? name[0] ?? 'S', 2) || 'S';
      const iconUrl = String(body.iconUrl ?? membership.server.icon_url ?? '').slice(0, 600000);
      const bannerUrl = String(body.bannerUrl ?? membership.server.banner_url ?? '').slice(0, 900000);
      const accent = /^#[0-9a-f]{6}$/i.test(String(body.accent || '')) ? String(body.accent) : (membership.server.accent || '#5865f2');
      const features = Array.isArray(body.features) ? body.features.map(x => cleanText(x, 40)).filter(Boolean).slice(0, 5) : parseJsonValue(membership.server.features_json, []);
      const stamp = nowIso();
      await env.DB.prepare(`
        UPDATE servers SET name = ?, description = ?, icon = ?, icon_url = ?, banner_url = ?, accent = ?, features_json = ?, updated_at = ?
        WHERE id = ?
      `).bind(name, description, icon, iconUrl, bannerUrl, accent, JSON.stringify(features), stamp, serverId).run();
      const updated = await env.DB.prepare(`SELECT * FROM servers WHERE id = ? LIMIT 1`).bind(serverId).first();
      return json({ ok: true, server: await serverPublic(env, updated, userId) });
    }

    if (parts[3] === "invites") {
      if (!membership.member) return json({ error: "forbidden", message: "Você não participa deste servidor." }, 403);
      if (method === "GET" && parts.length === 4) {
        const rows = await env.DB.prepare(`
          SELECT id, code, max_uses, uses, expires_at, created_at FROM server_invites
          WHERE server_id = ? ORDER BY created_at DESC LIMIT 100
        `).bind(serverId).all();
        return json({ ok: true, invites: (rows.results || []).map(row => ({
          id: row.id, code: row.code, maxUses: row.max_uses, uses: Number(row.uses || 0), expiresAt: row.expires_at, createdAt: row.created_at
        })) });
      }
      if (method === "POST" && parts.length === 4) {
        if (!manager) return json({ error: "forbidden", message: "Sem permissão para criar convites." }, 403);
        const body = await readJson(request) || {};
        const code = randomToken(7).slice(0, 10).toUpperCase();
        const id = crypto.randomUUID();
        const stamp = nowIso();
        const maxUses = body.maxUses == null ? null : Math.max(1, Math.min(100000, Number(body.maxUses) || 1));
        const expiresAt = body.expiresAt ? new Date(body.expiresAt).toISOString() : null;
        await env.DB.prepare(`
          INSERT INTO server_invites (id, server_id, created_by, code, max_uses, uses, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        `).bind(id, serverId, userId, code, maxUses, expiresAt, stamp).run();
        return json({ ok: true, invite: { id, code, maxUses, uses: 0, expiresAt, createdAt: stamp } }, 201);
      }
      if (method === "DELETE" && parts[4]) {
        if (!manager) return json({ error: "forbidden", message: "Sem permissão para revogar convites." }, 403);
        const result = await env.DB.prepare(`DELETE FROM server_invites WHERE id = ? AND server_id = ?`).bind(parts[4], serverId).run();
        return json({ ok: true, removed: Number(result?.meta?.changes || result?.changes || 0) > 0 });
      }
    }

    if (parts[3] === "members" && parts.length === 4 && method === "GET") {
      if (!membership.member) return json({ error: "forbidden", message: "Você não participa deste servidor." }, 403);
      const members = await listServerMembers(env, serverId);
      return json({ ok: true, members, memberCount: members.length });
    }

    if (parts[3] === "members" && parts[4]) {
      const targetId = parts[4];
      if (!manager) return json({ error: "forbidden", message: "Sem permissão para gerenciar membros." }, 403);
      if (targetId === membership.server.owner_id) return json({ error: "owner_protected", message: "O dono do servidor não pode ser removido ou rebaixado." }, 409);
      if (method === "PATCH") {
        const body = await readJson(request) || {};
        const role = ['Admin','Moderador','Membro'].includes(body.role) ? body.role : 'Membro';
        await env.DB.prepare(`UPDATE server_members SET role = ? WHERE server_id = ? AND user_id = ?`).bind(role, serverId, targetId).run();
        return json({ ok: true, userId: targetId, role });
      }
      if (method === "DELETE") {
        await env.DB.prepare(`DELETE FROM server_members WHERE server_id = ? AND user_id = ?`).bind(serverId, targetId).run();
        return json({ ok: true, removed: true });
      }
    }

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

      if (parts[6] && parts[7] === "poll-vote" && method === "POST") {
        const messageId = parts[6];
        const row = await env.DB.prepare(`SELECT * FROM channel_messages WHERE id = ? AND channel_id = ? AND deleted_at IS NULL LIMIT 1`).bind(messageId, channelId).first();
        if (!row) return json({ error: "message_not_found", message: "Mensagem não encontrada." }, 404);
        const poll = cleanPoll(parseJsonValue(row.poll_json, null));
        if (!poll) return json({ error: "not_poll", message: "Essa mensagem não é uma enquete." }, 400);
        const body = await readJson(request) || {};
        const optionIndex = Number(body.optionIndex);
        if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) {
          return json({ error: "invalid_option", message: "Opção inválida." }, 400);
        }
        await env.DB.prepare(`
          INSERT INTO poll_votes (message_id, user_id, option_index, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(message_id, user_id) DO UPDATE SET option_index = excluded.option_index, updated_at = excluded.updated_at
        `).bind(messageId, userId, optionIndex, nowIso()).run();
        return json({ ok: true, poll: await pollPublic(env, row, userId), messageId });
      }

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
            poll: await pollPublic(env, row, userId),
            system: parseJsonValue(row.system_json, null),
            edited: !!row.edited_at,
            deleted: !!row.deleted_at,
          });
        }
        return json({ messages });
      }

      if (method === "POST") {
        const body = await readJson(request);
        const poll = cleanPoll(body?.poll);
        const text = cleanText(body?.text || (poll ? `📊 ${poll.question}` : ""), 6000);
        const files = cleanFiles(body?.files || []);
        if (!text && !files.length && !poll) return json({ error: "invalid_message", message: "Mensagem vazia." }, 400);
        const clientId = String(body?.clientId || "").slice(0, 120);
        if (clientId) {
          const duplicate = await env.DB.prepare(`SELECT * FROM channel_messages WHERE sender_id = ? AND client_id = ? LIMIT 1`).bind(userId, clientId).first();
          if (duplicate) {
            return json({ message: {
              id: duplicate.id,
              senderId: duplicate.sender_id,
              author: await socialUserById(env, duplicate.sender_id),
              text: duplicate.content || "",
              clientId,
              channelId,
              serverId,
              time: Date.parse(duplicate.created_at) || Date.now(),
              createdAt: duplicate.created_at,
              files: parseJsonValue(duplicate.files_json, []),
              file: parseJsonValue(duplicate.files_json, [])[0] || null,
              replyTo: parseJsonValue(duplicate.reply_json, null),
              poll: await pollPublic(env, duplicate, userId),
              system: parseJsonValue(duplicate.system_json, null),
              edited: !!duplicate.edited_at,
              deleted: !!duplicate.deleted_at,
            }, duplicate: true });
          }
        }
        const stamp = nowIso();
        const id = crypto.randomUUID();

        try {
          await insertCompatible(env, "channel_messages", {
            id,
            channel_id: channelId,
            sender_id: userId,
            content: text,
            created_at: stamp,
            edited_at: null,
            deleted_at: null,
            client_id: clientId || null,
            files_json: JSON.stringify(files),
            reply_json: body?.replyTo ? JSON.stringify(body.replyTo) : null,
            poll_json: poll ? JSON.stringify(poll) : null,
            system_json: null,
          });
        } catch (error) {
          console.error("AZURECORD CHANNEL SEND ERROR", { message: String(error?.message || error), userId, serverId, channelId });
          return json({
            ok: false,
            error: "CHANNEL_SEND_FAILED",
            message: "Não foi possível enviar esta mensagem no canal agora. Tente novamente.",
          }, 500);
        }

        const inserted = await env.DB.prepare(`SELECT * FROM channel_messages WHERE id = ? LIMIT 1`).bind(id).first();
        return json({ message: { id, clientId: clientId || null, channelId, serverId, senderId: userId, author: await socialUserById(env, userId), text, time: Date.parse(stamp), createdAt: stamp, files, file: files[0] || null, replyTo: body?.replyTo || null, poll: await pollPublic(env, inserted, userId), system: null, edited: false, deleted: false } }, 201);
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
  await addColumnIfMissing(env, "user_profiles", "pronouns", "TEXT NOT NULL DEFAULT ''");
  await ensureSocialSchema(env);
  await ensureAzurePointsSchema(env);
  await ensureSettingsSchema(env);
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
    pronouns: row.pronouns || "",
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
      p.pronouns,
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
  const [user, lolaConversation] = await Promise.all([
    readUserById(env, userId),
    activeLolaConversation(env, userId, true),
  ]);
  return json({ ok: true, user, session, lolaSessionId: lolaConversation?.id || null }, 201);
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

async function bootstrapSession(request, env) {
  const auth = await getAuthenticatedUser(request, env);
  if (!auth) return json({ ok: false, error: "Sessão ausente, inválida ou expirada." }, 401);
  await ensureSocialSchema(env);
  const [conversation, settings, peers] = await Promise.all([
    activeLolaConversation(env, auth.user.id, true),
    readUserSettings(env, auth.user.id),
    realtimePeerIds(env, auth.user.id),
  ]);
  return json({
    ok: true,
    apiVersion: "0.8.9",
    user: auth.user,
    lolaSessionId: conversation?.id || null,
    settings,
    peers,
    presence: await presenceDetailsFor(env, auth.user.id, auth.user.status || "online"),
    serverTime: Date.now(),
  });
}

async function logout(request, env) {
  const token = getBearerToken(request);
  if (!token) return json({ ok: true });

  const tokenHash = await sha256Base64Url(token);
  await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
  return json({ ok: true });
}


async function listSessions(request, env) {
  const auth = await getAuthenticatedUser(request, env);
  if (!auth) return json({ ok: false, error: "Sessão ausente, inválida ou expirada." }, 401);
  const rows = await env.DB.prepare(`
    SELECT id, created_at, expires_at, last_used_at FROM sessions
    WHERE user_id = ? ORDER BY last_used_at DESC LIMIT 50
  `).bind(auth.user.id).all();
  return json({ ok: true, sessions: (rows.results || []).map(row => ({
    id: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    current: row.id === auth.sessionId,
  })) });
}

async function revokeSession(request, env, sessionId) {
  const auth = await getAuthenticatedUser(request, env);
  if (!auth) return json({ ok: false, error: "Sessão ausente, inválida ou expirada." }, 401);
  if (sessionId === auth.sessionId) return json({ ok: false, error: "current_session", message: "Use Sair para encerrar a sessão atual." }, 409);
  const result = await env.DB.prepare(`DELETE FROM sessions WHERE id = ? AND user_id = ?`).bind(sessionId, auth.user.id).run();
  return json({ ok: true, removed: Number(result?.meta?.changes || result?.changes || 0) > 0 });
}

async function revokeOtherSessions(request, env) {
  const auth = await getAuthenticatedUser(request, env);
  if (!auth) return json({ ok: false, error: "Sessão ausente, inválida ou expirada." }, 401);
  const result = await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND id <> ?`).bind(auth.user.id, auth.sessionId).run();
  return json({ ok: true, removed: Number(result?.meta?.changes || result?.changes || 0) });
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
  const pronouns = String(body.pronouns ?? current.pronouns ?? "").trim();
  const profileComplete = body.profileComplete === true || (body.profileComplete === undefined && current.profileComplete === true);

  if (username.length < 3 || username.length > 32 || !/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return json({ ok: false, error: "Nome de usuário inválido." }, 400);
  }
  if (bio.length > 160) return json({ ok: false, error: "A bio pode ter no máximo 160 caracteres." }, 400);
  if (!/^#[0-9a-f]{6}$/i.test(accent)) return json({ ok: false, error: "Cor de destaque inválida." }, 400);
  if (!["online", "idle", "dnd", "offline"].includes(status)) return json({ ok: false, error: "Status inválido." }, 400);
  if (personality.length > 240) return json({ ok: false, error: "Personalidade muito longa." }, 400);
  if (pronouns.length > 48) return json({ ok: false, error: "Pronomes muito longos." }, 400);
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
        user_id, bio, accent, status, banner_url, personality, pronouns, profile_complete, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        bio = excluded.bio,
        accent = excluded.accent,
        status = excluded.status,
        banner_url = excluded.banner_url,
        personality = excluded.personality,
        pronouns = excluded.pronouns,
        profile_complete = excluded.profile_complete,
        updated_at = excluded.updated_at
    `).bind(
      auth.user.id, bio, accent, status, banner, personality, pronouns,
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
    env.DB.prepare(`DELETE FROM ignored_users WHERE user_id = ? OR ignored_user_id = ?`).bind(id, id),

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

function sanitizeAttachmentName(value) {
  return String(value || "arquivo").replace(/[\\/\0\r\n]/g, "_").slice(0, 180) || "arquivo";
}

function attachmentKeyAllowed(key, userId) {
  return String(key || "").startsWith(`attachments/${userId}/`);
}

async function handleAttachmentUploads(request, env, url, path) {
  if (!path.startsWith("/api/uploads/")) return null;
  const authResult = await requireSocialAuth(request, env);
  if (authResult.response) return authResult.response;
  if (!env.ATTACHMENTS) {
    return json({ ok: false, error: "ATTACHMENTS_NOT_CONFIGURED", message: "O bucket R2 ATTACHMENTS ainda não está configurado no Worker." }, 503);
  }
  const userId = authResult.auth.user.id;

  if (request.method === "POST" && path === "/api/uploads/init") {
    const body = await readJson(request);
    if (!body) return json({ ok: false, error: "invalid_json" }, 400);
    const name = sanitizeAttachmentName(body.name);
    const type = String(body.type || "application/octet-stream").slice(0, 120);
    const size = Math.max(0, Number(body.size) || 0);
    const key = `attachments/${userId}/${crypto.randomUUID()}/${encodeURIComponent(name)}`;
    const multipart = await env.ATTACHMENTS.createMultipartUpload(key, {
      httpMetadata: { contentType: type },
      customMetadata: { name, owner: userId, size: String(size) },
    });
    return json({ ok: true, key, uploadId: multipart.uploadId, partSize: 8 * 1024 * 1024 });
  }

  if (request.method === "PUT" && path === "/api/uploads/part") {
    const key = String(url.searchParams.get("key") || "");
    const uploadId = String(url.searchParams.get("uploadId") || "");
    const partNumber = Number(url.searchParams.get("partNumber") || 0);
    if (!attachmentKeyAllowed(key, userId) || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
      return json({ ok: false, error: "invalid_upload_part" }, 400);
    }
    const multipart = env.ATTACHMENTS.resumeMultipartUpload(key, uploadId);
    const part = await multipart.uploadPart(partNumber, request.body);
    return json({ ok: true, partNumber: part.partNumber, etag: part.etag });
  }

  if (request.method === "POST" && path === "/api/uploads/complete") {
    const body = await readJson(request);
    const key = String(body?.key || "");
    const uploadId = String(body?.uploadId || "");
    if (!attachmentKeyAllowed(key, userId) || !uploadId) return json({ ok: false, error: "invalid_upload" }, 400);
    const parts = Array.isArray(body.parts) ? body.parts.map(x => ({
      partNumber: Number(x.partNumber),
      etag: String(x.etag || ""),
    })).filter(x => Number.isInteger(x.partNumber) && x.partNumber > 0 && x.etag) : [];
    if (!parts.length) return json({ ok: false, error: "missing_parts" }, 400);
    const multipart = env.ATTACHMENTS.resumeMultipartUpload(key, uploadId);
    await multipart.complete(parts);
    const name = sanitizeAttachmentName(body.name);
    const type = String(body.type || "application/octet-stream").slice(0, 120);
    const size = Math.max(0, Number(body.size) || 0);
    const fileUrl = new URL(`/files/${encodeURIComponent(key)}`, request.url).toString();
    return json({ ok: true, file: { name, type, size, key, url: fileUrl } }, 201);
  }

  if (request.method === "POST" && path === "/api/uploads/abort") {
    const body = await readJson(request);
    const key = String(body?.key || "");
    const uploadId = String(body?.uploadId || "");
    if (!attachmentKeyAllowed(key, userId) || !uploadId) return json({ ok: false, error: "invalid_upload" }, 400);
    try { await env.ATTACHMENTS.resumeMultipartUpload(key, uploadId).abort(); } catch {}
    return json({ ok: true });
  }

  return null;
}

async function serveAttachment(request, env, path) {
  if (request.method !== "GET" || !path.startsWith("/files/")) return null;
  if (!env.ATTACHMENTS) return new Response("Attachment storage unavailable", { status: 503 });
  let key = "";
  try { key = decodeURIComponent(path.slice("/files/".length)); } catch { return new Response("Bad attachment key", { status: 400 }); }
  if (!key.startsWith("attachments/")) return new Response("Not found", { status: 404 });
  const object = await env.ATTACHMENTS.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers(CORS_HEADERS);
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  const name = object.customMetadata?.name || "arquivo";
  headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
  return new Response(object.body, { headers });
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
          version: "0.9.0",
        });
      }

      if (request.method === "GET" && path === "/health") {
        await ensureSchema(env);
        return json({
          ok: true,
          service: "azurecord-api",
          database: Boolean(env.DB),
          version: "0.9.0",
          capabilities: {
            cloudAuth: true,
            profileSync: true,
            accountDelete: true,
            passwordChange: true,
            socialCloud: true,
            cloudDMs: true,
            cloudServers: true,
            socialPolling: true,
            lolaWorkersAI: Boolean(env.AI),
            lolaCloudHistory: true,
            azurePointsCloud: true,
            userControls: true,
            settingsCloud: true,
            serverSettingsCloud: true,
            webClient: true,
        friendSearchV2: true,
        reliableMessaging: true,
        reliableMessagingV2: true,
        bootstrapV1: true,
        lolaAutoProvision: true,
        callSignalsV3: true,
        realtimeHttpFallback: true,
        livePresence: true,
        customStatusV1: true,
        presenceTimestampsV1: true,
        serverMemberList: true,
        cloudPolls: true,
        azureCallV2: true,
        azureCallShareState: true,
        azureCallTurn: Boolean(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN),
        largeAttachments: Boolean(env.ATTACHMENTS),
        attachmentStorage: env.ATTACHMENTS ? "r2-multipart" : "disabled",
          },
        });
      }

      if (request.method === "POST" && path === "/auth/register") return await register(request, env);
      if (request.method === "POST" && path === "/auth/login") return await login(request, env);
      if (request.method === "GET" && path === "/auth/me") return await me(request, env);
      if (request.method === "GET" && path === "/api/bootstrap") return await bootstrapSession(request, env);
      if (request.method === "POST" && path === "/auth/logout") return await logout(request, env);
      if (request.method === "GET" && path === "/auth/sessions") return await listSessions(request, env);
      if (request.method === "POST" && path === "/auth/sessions/revoke-others") return await revokeOtherSessions(request, env);
      if (request.method === "DELETE" && path.startsWith("/auth/sessions/")) return await revokeSession(request, env, path.split("/").pop());
      if (request.method === "PATCH" && (path === "/auth/profile" || path === "/auth/me")) return await updateProfile(request, env);
      if (request.method === "POST" && path === "/auth/password") return await changePassword(request, env);
      if (request.method === "POST" && path === "/auth/delete") return await deleteAccount(request, env);
      if (request.method === "DELETE" && path === "/auth/me") return await deleteAccount(request, env);

      const attachmentResponse = await serveAttachment(request, env, path);
      if (attachmentResponse) return attachmentResponse;

      if (path.startsWith("/api/")) {
        const uploadResponse = await handleAttachmentUploads(request, env, url, path);
        if (uploadResponse) return uploadResponse;

        const lolaResponse = await handleLola(request, env, url, path);
        if (lolaResponse) return lolaResponse;

        const pointsResponse = await handleAzurePoints(request, env, path);
        if (pointsResponse) return pointsResponse;

        const socialResponse = await handleSocial(request, env, url, path);
        if (socialResponse) return socialResponse;
      }

      return json({ ok: false, error: "Rota não encontrada." }, 404);
    } catch (error) {
      console.error("AZURECORD CLOUD ERROR", error);
      return json({
        ok: false,
        error: "Erro interno do Azurecord.",
      }, 500);
    }
  },
};
