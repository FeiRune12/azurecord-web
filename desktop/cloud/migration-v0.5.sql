-- O Worker 0.5 executa esta migração automaticamente.
CREATE TABLE IF NOT EXISTS dm_hidden (user_id TEXT NOT NULL, conversation_id TEXT NOT NULL, hidden_at TEXT NOT NULL, PRIMARY KEY(user_id, conversation_id));
-- Colunas adicionais em messages/channel_messages/channels/servers são adicionadas dinamicamente pelo Worker.
