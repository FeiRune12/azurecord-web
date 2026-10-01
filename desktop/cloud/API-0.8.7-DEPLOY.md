# Azurecord API 0.8.7

Esta versão acompanha o Azurecord 2.0.8.

## O que muda

- status personalizado persistente por usuário
- data/hora de última presença e de atualização do status
- `PATCH /api/presence` para editar presença + mensagem
- `/api/presence/heartbeat` continua mantendo o usuário online sem apagar o status personalizado
- snapshots sociais passam a trazer `customStatus`, `lastSeenAt` e `statusUpdatedAt`
- mantém as correções da API 0.8.6 para bootstrap, Lola, mensagens e AzureCall

## Arquivo para publicar

Publique `desktop/cloud/worker-v0.8.7.js` no Worker:

`https://azurecord-api.giovannisilvaalves604.workers.dev`

O arquivo `worker-v0.8.1.js` permanece sincronizado com o código mais novo para compatibilidade com automações antigas.

## Bindings

Mantenha os bindings já existentes:

- D1: `DB`
- Workers AI: `AI`
- R2 opcional: `ATTACHMENTS`
- TURN opcional: `TURN_KEY_ID` e `TURN_KEY_API_TOKEN`

## Verificação

Depois do deploy, `/health` deve retornar versão `0.8.7` e, entre outras, estas capabilities:

- `bootstrapV1: true`
- `lolaAutoProvision: true`
- `reliableMessagingV2: true`
- `callSignalsV3: true`
- `customStatusV1: true`
- `presenceTimestampsV1: true`
