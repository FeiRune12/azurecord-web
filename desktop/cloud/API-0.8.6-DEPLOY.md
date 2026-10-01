# Azurecord API 0.8.6

Esta versão acompanha o Azurecord 2.0.7 e corrige o bootstrap de contas novas, a sessão inicial da Lola, recuperação de mensagens e sinalização de chamadas.

## Arquivo para publicar

Publique `desktop/cloud/worker-v0.8.6.js` no Worker Cloudflare que atende:

`https://azurecord-api.giovannisilvaalves604.workers.dev`

O arquivo `worker-v0.8.1.js` também foi mantido sincronizado com o mesmo código para não quebrar automações antigas.

## Bindings que devem continuar configurados

- D1: `DB`
- Workers AI: `AI`
- R2 opcional: `ATTACHMENTS`
- Secrets TURN opcionais: `TURN_KEY_ID` e `TURN_KEY_API_TOKEN`

Opcionalmente, `LOLA_MODEL` pode ser definido como variável de texto para trocar o modelo sem editar o Worker. Se não estiver definido, o modelo padrão continua sendo usado.

## Verificação depois do deploy

Abra `/health`. A resposta deve mostrar versão `0.8.6` e estas capabilities:

- `bootstrapV1: true`
- `lolaAutoProvision: true`
- `reliableMessagingV2: true`
- `callSignalsV3: true`

Contas novas recebem uma conversa da Lola durante o cadastro. O cliente também usa `GET /api/bootstrap` depois da autenticação para recuperar a sessão da Lola, preferências e peers de realtime.

## Compatibilidade

O cliente 2.0.7 ainda possui fallback para a API 0.8.5. Assim, o Web/Desktop/Android não deixam de abrir enquanto o Worker 0.8.6 ainda não foi publicado, mas os fixes completos de bootstrap da Lola dependem do deploy da 0.8.6.
