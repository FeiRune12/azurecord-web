# Deploy do Azurecord Web no Vercel

O site e o app desktop usam o mesmo Cloudflare Worker.

## 1. Antes do Vercel

Confirme o Worker 0.8:

```text
https://azurecord-api.giovannisilvaalves604.workers.dev/health
```

## 2. Suba a pasta do projeto para GitHub

O projeto pode ficar inteiro no repositório. O cliente que o Vercel precisa está em `web-vercel`.

## 3. Crie o projeto no Vercel

- importe o repositório;
- Root Directory: `web-vercel`;
- Framework Preset: `Other`;
- Build Command: `npm run build`;
- Output Directory: `dist`.

## 4. Variável de ambiente

No projeto Vercel, crie:

```text
AZURECORD_API_URL=https://azurecord-api.giovannisilvaalves604.workers.dev
```

Marque Production, Preview e Development se quiser que todos os ambientes usem a mesma API.

Depois de alterar a variável, faça um novo deploy.

## 5. Resultado

O Vercel hospeda somente a interface web. O backend continua assim:

```text
Vercel → frontend
Cloudflare Worker → API
D1 → banco
Workers AI → Lola
R2 → futuro armazenamento de arquivos grandes
```
