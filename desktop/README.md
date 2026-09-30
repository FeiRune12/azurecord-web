# Azurecord V52 Beta 8.3 — Web + Settings

Esta build reúne o cliente desktop Electron e um cliente web pronto para Vercel usando a mesma conta Cloud.

## Backend Cloud

Publique `cloud/worker-v0.8.js` no Worker `azurecord-api`.

Bindings esperados:

```text
DB → D1 → azurecord-prod
AI → Workers AI
```

O `/health` deve mostrar `version: 0.8.0` e, entre outras capacidades:

```text
settingsCloud: true
serverSettingsCloud: true
webClient: true
lolaWorkersAI: true
azurePointsCloud: true
userControls: true
```

## O que entrou na Beta 8.3

- modal grande de configurações do aplicativo, com navegação lateral e layout responsivo;
- modal de configurações do servidor no mesmo estilo;
- edição Cloud de nome, descrição, cor, ícone e faixa do servidor;
- gerenciamento Cloud de membros, cargos e convites;
- sessões conectadas e encerramento de outras sessões;
- preferências Cloud de privacidade, Lola, notificações e aparência;
- cliente Web com login, perfis, amigos, DMs, servidores, Lola Workers AI, AzurePoints e controles Bloquear/Ignorar;
- projeto `web-vercel` pronto para deploy.

## Desktop

```bash
npm install
npm start
```

## Web/Vercel

Leia `VERCEL-DEPLOY.md` ou `web-vercel/README.md`.

## Observações

Chamadas ainda são apenas interface/roadmap. A implementação futura deve usar WebRTC. Anexos grandes continuam limitados pela arquitetura atual até a migração para R2.
