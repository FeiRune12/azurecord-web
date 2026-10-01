# AzureCall TURN

O Azurecord 2.0.3 pode obter servidores ICE dinamicamente pelo endpoint autenticado:

`GET /api/realtime/ice-servers`

## Variáveis secretas do Worker

Configure no Worker da API:

```bash
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN
```

Esses valores pertencem somente ao backend.

O Worker usa a chave para gerar credenciais TURN curtas e devolve apenas `iceServers` temporários ao cliente. Se as secrets não estiverem configuradas ou o provedor TURN estiver indisponível, o endpoint devolve STUN de fallback em vez de quebrar a chamada.

## Segurança

Nunca coloque a chave TURN de longa duração em:

- `docs/config.js`
- `renderer/config.js`
- localStorage
- APK
- Electron
- repositório Git

## Verificação

Depois do deploy, `/health` deve expor:

```json
{
  "capabilities": {
    "azureCallTurn": true
  }
}
```

Se aparecer `false`, as chamadas continuam tentando P2P/STUN, mas não terão relay TURN.
