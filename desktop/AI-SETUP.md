# Lola IA — Beta 8.3

A Lola usa Cloudflare Workers AI pelo binding `AI` do Worker.

Bindings:

```text
DB → D1 → azurecord-prod
AI → Workers AI
```

Publique `cloud/worker-v0.8.js`. Nenhuma API key de IA deve ser colocada no cliente desktop ou no site.

O `/health` deve mostrar:

```text
version: 0.8.0
lolaWorkersAI: true
lolaCloudHistory: true
```
