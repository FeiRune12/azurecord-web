'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(root, 'cloud', 'worker-v0.4.js'), 'utf8');

class D1Statement {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new D1Statement(this.db, this.sql, args);
  }
  async run() {
    const stmt = this.db.prepare(this.sql);
    return stmt.run(...this.args);
  }
  async first() {
    const stmt = this.db.prepare(this.sql);
    return stmt.get(...this.args) || null;
  }
  async all() {
    const stmt = this.db.prepare(this.sql);
    return { results: stmt.all(...this.args) };
  }
}

class D1Database {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON;');
  }
  prepare(sql) {
    return new D1Statement(this.db, sql);
  }
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      this.db.exec('COMMIT');
      return out;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function createSchema(db) {
  db.db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_normalized TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      email_normalized TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      account_status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_used_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE friend_requests (
      id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, receiver_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE friendships (
      id TEXT PRIMARY KEY, user_a TEXT NOT NULL, user_b TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(user_a) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(user_b) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE blocks (
      blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(blocker_id, blocked_id),
      FOREIGN KEY(blocker_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(blocked_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE dm_conversations (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE dm_members (
      conversation_id TEXT NOT NULL, user_id TEXT NOT NULL, joined_at TEXT NOT NULL,
      PRIMARY KEY(conversation_id, user_id),
      FOREIGN KEY(conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL, content TEXT NOT NULL,
      created_at TEXT NOT NULL, edited_at TEXT, deleted_at TEXT,
      FOREIGN KEY(conversation_id) REFERENCES dm_conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE servers (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, icon_url TEXT, description TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE server_members (
      server_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', nickname TEXT, joined_at TEXT NOT NULL,
      PRIMARY KEY(server_id, user_id),
      FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE channels (
      id TEXT PRIMARY KEY, server_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'text',
      position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
    );
    CREATE TABLE channel_messages (
      id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, sender_id TEXT NOT NULL, content TEXT NOT NULL,
      created_at TEXT NOT NULL, edited_at TEXT, deleted_at TEXT,
      FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE server_invites (
      id TEXT PRIMARY KEY, server_id TEXT NOT NULL, created_by TEXT NOT NULL, code TEXT NOT NULL UNIQUE,
      max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0, expires_at TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE,
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE azurepoints_wallets (
      user_id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0, lifetime_earned INTEGER NOT NULL DEFAULT 0,
      lifetime_spent INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE azurepoints_transactions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL, type TEXT NOT NULL,
      description TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE azurepoints_redemptions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, points_amount INTEGER NOT NULL, requested_value_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, reviewed_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE lola_memories (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, memory TEXT NOT NULL, category TEXT,
      importance INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE lola_conversations (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE lola_messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES lola_conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE beta_feedback (
      id TEXT PRIMARY KEY, user_id TEXT, category TEXT NOT NULL DEFAULT 'general', message TEXT NOT NULL,
      app_version TEXT, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE user_settings (
      user_id TEXT PRIMARY KEY, theme TEXT NOT NULL DEFAULT 'dark', language TEXT NOT NULL DEFAULT 'pt-BR',
      allow_friend_requests INTEGER NOT NULL DEFAULT 1, allow_dms_from_friends INTEGER NOT NULL DEFAULT 1,
      lola_enabled INTEGER NOT NULL DEFAULT 1, lola_memory_enabled INTEGER NOT NULL DEFAULT 1,
      notifications_enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE user_presence (
      user_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'offline', custom_status TEXT,
      last_seen_at TEXT, updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

async function loadWorker() {
  const encoded = Buffer.from(workerSource, 'utf8').toString('base64');
  const module = await import(`data:text/javascript;base64,${encoded}`);
  return module.default;
}

async function call(worker, env, method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const request = new Request(`https://azurecord.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await worker.fetch(request, env);
  let data = {};
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}

test('Beta7: renderer sincroniza perfil cloud e preserva perfil personalizado', () => {
  assert.match(appSource, /cloudRequest\('\/auth\/profile'/);
  assert.match(appSource, /localProfileLooksCustomized/);
  assert.match(appSource, /profile\.profileComplete!==true && localWasCustomized/);
  assert.match(appSource, /a\.profileComplete=true/);
  assert.match(appSource, /await syncCloudProfile\(a,\{profileComplete:true\}\)/);
  assert.match(appSource, /await syncCloudProfile\(p,\{profileComplete:true\}\)/);
});

test('Beta7: exclusão limpa a sessão segura e tem mensagem para Worker desatualizado', () => {
  assert.match(appSource, /deleteSecureSession/);
  assert.match(appSource, /worker-v0\.4\.js/);
  assert.match(appSource, /cloudRequest\('\/auth\/delete'/);
  assert.match(appSource, /cloudRequest\('\/auth\/me',\{method:'DELETE'/);
});

test('Beta7: Worker 0.4 anuncia capacidades necessárias', async () => {
  const db = new D1Database();
  createSchema(db);
  const worker = await loadWorker();
  const result = await call(worker, { DB: db }, 'GET', '/health');
  assert.equal(result.status, 200);
  assert.equal(result.data.version, '0.4.0');
  assert.equal(result.data.capabilities.profileSync, true);
  assert.equal(result.data.capabilities.accountDelete, true);
});

test('Beta7: cadastro, perfil persistente, login e exclusão funcionam ponta a ponta no Worker', async () => {
  const db = new D1Database();
  createSchema(db);
  const worker = await loadWorker();
  const env = { DB: db };

  const signup = await call(worker, env, 'POST', '/auth/register', {
    username: 'ContaTeste',
    email: 'conta@azurecord.test',
    password: 'SenhaSegura123!',
  });
  assert.equal(signup.status, 201);
  assert.equal(signup.data.user.accountType, 'cloud');
  assert.equal(signup.data.user.profileComplete, false);
  const token = signup.data.session.token;
  const id = signup.data.user.id;

  const avatar = 'data:image/webp;base64,AAAA';
  const updated = await call(worker, env, 'PATCH', '/auth/profile', {
    username: 'AzurePersonalizada',
    bio: 'Perfil que não pode voltar ao padrão.',
    accent: '#123456',
    status: 'idle',
    avatar,
    banner: '',
    personality: 'Criativa',
    profileComplete: true,
  }, token);
  assert.equal(updated.status, 200);
  assert.equal(updated.data.user.username, 'AzurePersonalizada');
  assert.equal(updated.data.user.bio, 'Perfil que não pode voltar ao padrão.');
  assert.equal(updated.data.user.profileComplete, true);
  assert.equal(updated.data.user.avatarUrl, avatar);

  const login = await call(worker, env, 'POST', '/auth/login', {
    login: 'conta@azurecord.test',
    password: 'SenhaSegura123!',
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.username, 'AzurePersonalizada');
  assert.equal(login.data.user.bio, 'Perfil que não pode voltar ao padrão.');
  assert.equal(login.data.user.profileComplete, true);

  const second = await call(worker, env, 'POST', '/auth/register', {
    username: 'OutraConta',
    email: 'outra@azurecord.test',
    password: 'OutraSenha123!',
  });
  assert.equal(second.status, 201);
  const otherId = second.data.user.id;
  const stamp = new Date().toISOString();

  db.db.prepare(`INSERT INTO friend_requests VALUES (?, ?, ?, 'pending', ?, ?)`).run('fr1', id, otherId, stamp, stamp);
  db.db.prepare(`INSERT INTO friendships VALUES (?, ?, ?, ?)`).run('f1', id, otherId, stamp);
  db.db.prepare(`INSERT INTO blocks VALUES (?, ?, ?)`).run(id, otherId, stamp);
  db.db.prepare(`INSERT INTO dm_conversations VALUES (?, ?, ?)`).run('dm1', stamp, stamp);
  db.db.prepare(`INSERT INTO dm_members VALUES (?, ?, ?)`).run('dm1', id, stamp);
  db.db.prepare(`INSERT INTO dm_members VALUES (?, ?, ?)`).run('dm1', otherId, stamp);
  db.db.prepare(`INSERT INTO messages VALUES (?, ?, ?, ?, ?, NULL, NULL)`).run('m1', 'dm1', id, 'apagar', stamp);
  db.db.prepare(`INSERT INTO messages VALUES (?, ?, ?, ?, ?, NULL, NULL)`).run('m2', 'dm1', otherId, 'também some com a DM', stamp);
  db.db.prepare(`INSERT INTO servers VALUES (?, ?, ?, NULL, NULL, ?, ?)`).run('srv1', id, 'Servidor', stamp, stamp);
  db.db.prepare(`INSERT INTO server_members VALUES (?, ?, 'member', NULL, ?)`).run('srv1', id, stamp);
  db.db.prepare(`INSERT INTO server_members VALUES (?, ?, 'member', NULL, ?)`).run('srv1', otherId, stamp);
  db.db.prepare(`INSERT INTO channels VALUES (?, ?, ?, 'text', 0, ?, ?)`).run('ch1', 'srv1', 'geral', stamp, stamp);
  db.db.prepare(`INSERT INTO channel_messages VALUES (?, ?, ?, ?, ?, NULL, NULL)`).run('cm1', 'ch1', id, 'apagar', stamp);
  db.db.prepare(`INSERT INTO server_invites VALUES (?, ?, ?, ?, NULL, 0, NULL, ?)`).run('inv1', 'srv1', id, 'CODIGO', stamp);
  db.db.prepare(`INSERT INTO azurepoints_transactions VALUES (?, ?, 10, 'bonus', 'teste', ?)`).run('ap1', id, stamp);
  db.db.prepare(`INSERT INTO azurepoints_redemptions VALUES (?, ?, 5, 5, 'pending', ?, NULL)`).run('red1', id, stamp);
  db.db.prepare(`INSERT INTO lola_memories VALUES (?, ?, ?, NULL, 1, ?, ?)`).run('mem1', id, 'lembrança', stamp, stamp);
  db.db.prepare(`INSERT INTO lola_conversations VALUES (?, ?, NULL, ?, ?)`).run('lc1', id, stamp, stamp);
  db.db.prepare(`INSERT INTO lola_messages VALUES (?, ?, 'user', 'oi', ?)`).run('lm1', 'lc1', stamp);
  db.db.prepare(`INSERT INTO beta_feedback VALUES (?, ?, 'bug', 'feedback', 'beta7', 'open', ?)`).run('bf1', id, stamp);

  const wrongDelete = await call(worker, env, 'POST', '/auth/delete', {
    currentPassword: 'errada',
    confirmation: 'EXCLUIR CONTA',
  }, token);
  assert.equal(wrongDelete.status, 401);

  const deleted = await call(worker, env, 'DELETE', '/auth/me', {
    currentPassword: 'SenhaSegura123!',
    confirmation: 'EXCLUIR CONTA',
  }, token);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.deleted, true);

  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(id).n, 0);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(otherId).n, 1, 'outra conta é preservada');
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(id).n, 0);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM user_profiles WHERE user_id = ?').get(id).n, 0);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM dm_conversations WHERE id = ?').get('dm1').n, 0);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM servers WHERE id = ?').get('srv1').n, 0);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM azurepoints_transactions WHERE user_id = ?').get(id).n, 0);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM azurepoints_redemptions WHERE user_id = ?').get(id).n, 0);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM lola_memories WHERE user_id = ?').get(id).n, 0);
  assert.equal(db.db.prepare('SELECT user_id FROM beta_feedback WHERE id = ?').get('bf1').user_id, null, 'feedback vira anônimo');

  const otherLogin = await call(worker, env, 'POST', '/auth/login', {
    login: 'outra@azurecord.test',
    password: 'OutraSenha123!',
  });
  assert.equal(otherLogin.status, 200, 'outra conta continua entrando');

  const after = await call(worker, env, 'POST', '/auth/login', {
    login: 'conta@azurecord.test',
    password: 'SenhaSegura123!',
  });
  assert.equal(after.status, 401);
});
