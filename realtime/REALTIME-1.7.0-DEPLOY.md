# Azurecord Realtime 1.7.0

Esta versão acompanha o Azurecord 2.0.8.

O evento `presence.commit` agora transporta também a mensagem de status personalizada e publica `customStatus`, `lastSeenAt` e `updatedAt` em `presence.changed`.

Publique `realtime/worker.js` no Worker realtime já usado pelo Azurecord.

Depois do deploy, `/health` deve mostrar versão `1.7.0`.

O cliente continua funcional sem este deploy, usando snapshots/heartbeat da API como fallback, mas o status personalizado passa a atualizar entre dispositivos quase instantaneamente quando o Realtime 1.7.0 está no ar.
