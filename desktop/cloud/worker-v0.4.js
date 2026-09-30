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
          version: "0.4.0",
        });
      }

      if (request.method === "GET" && path === "/health") {
        await ensureSchema(env);
        return json({
          ok: true,
          service: "azurecord-api",
          database: Boolean(env.DB),
          version: "0.4.0",
          capabilities: {
            cloudAuth: true,
            profileSync: true,
            accountDelete: true,
            passwordChange: true,
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
