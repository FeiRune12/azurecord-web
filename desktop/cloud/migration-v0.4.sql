-- Azurecord Cloud v0.4
-- O Worker cria esta tabela automaticamente, mas este arquivo serve como migração manual opcional.

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
);
