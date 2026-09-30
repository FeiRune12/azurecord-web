# Azurecord Realtime

Serviço WebSocket do Azurecord baseado em Cloudflare Durable Objects.

## Deploy

Na raiz do repositório:

```bash
cd realtime
npx wrangler login
npx wrangler deploy
```

O Worker esperado é:

```
https://azurecord-realtime.<seu-subdominio>.workers.dev
```

O frontend já mantém polling HTTP como fallback se o WebSocket estiver indisponível.

## Arquitetura

- O navegador/Electron conecta em `/ws` usando o protocolo `azurecord-v1`.
- A sessão Cloud do Azurecord é validada contra `azurecord-api`.
- Cada usuário é roteado para um Durable Object próprio.
- Depois que a API confirma uma mensagem, o cliente envia apenas um evento de commit.
- O Durable Object avisa os outros dispositivos/usuários instantaneamente.
- O conteúdo real continua sendo lido da API/D1, então o WebSocket funciona como gatilho em tempo real e não substitui a fonte de verdade.
