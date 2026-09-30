# Azurecord Web — V52 Beta 8.3

Cliente web estático do Azurecord. Ele usa o mesmo Cloudflare Worker do app desktop.

## Arquitetura

- Vercel: frontend web
- Cloudflare Worker: API
- Cloudflare D1: banco
- Workers AI: Lola
- R2: reservado para anexos grandes em versão futura

## Deploy rápido no Vercel

1. Envie o projeto para um repositório Git.
2. No Vercel, importe o repositório.
3. Em **Root Directory**, escolha `web-vercel`.
4. Framework Preset: **Other**.
5. Build Command: `npm run build`.
6. Output Directory: `dist`.
7. Crie a variável de ambiente `AZURECORD_API_URL` com a URL HTTPS do Worker.
8. Faça o deploy.

A build grava essa URL em `dist/config.js`. Nenhuma chave de Workers AI fica no navegador.

## Local

```bash
cd web-vercel
npm run build
```

Sirva a pasta `dist` com qualquer servidor HTTP estático.
