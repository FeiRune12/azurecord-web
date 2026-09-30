# Azurecord Backend V1

Servidor HTTP local e independente, sem dependências npm externas.

## O que já existe
- Cadastro e login com email + senha
- Hash de senha com `crypto.scrypt`
- Sessões com bearer token
- Migração de contas antigas do protótipo
- Perfis e atualização de perfil
- Busca de usuários por nome
- Amigos e solicitações
- DMs persistentes
- Eventos em tempo real via Server-Sent Events
- Servidores e canais básicos
- Banco persistente em JSON, com escrita atômica

## Executar separado
```bat
set AZURECORD_HOST=0.0.0.0
set AZURECORD_PORT=4317
node server.js
```

Para produção, substitua o armazenamento JSON por PostgreSQL/SQLite e coloque o servidor atrás de HTTPS. O armazenamento local é deliberado nesta etapa para manter a V1 sem dependências externas.
