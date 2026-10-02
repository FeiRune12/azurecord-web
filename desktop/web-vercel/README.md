# Azurecord Web — espelho Vercel

O Vercel funciona como espelho do cliente web do Azurecord. O build copia diretamente a pasta `/docs` do repositório, portanto toda função web já comitada e toda função futura que entrar em `/docs` passa a fazer parte do próximo deploy sem manter uma segunda cópia manual.

## Estratégia

- GitHub Pages continua como frontend principal enquanto estiver saudável.
- Vercel fica pronto como frontend alternativo.
- Cloudflare Worker continua sendo a API principal, com D1, R2, Workers AI, TURN e realtime.
- O Vercel não substitui D1/Workers AI automaticamente. Uma migração de backend só deve ser ativada quando houver necessidade real de capacidade/limite, para não criar dois backends divergentes.

## Build

```bash
npm run build
```

A saída fica em `dist/` e é gerada diretamente de `../../docs`.

Variáveis opcionais:

```text
AZURECORD_API_URL=https://azurecord-api.giovannisilvaalves604.workers.dev
AZURECORD_REALTIME_URL=https://azurecord-realtime.giovannisilvaalves604.workers.dev
AZURECORD_WEB_URL=https://feirune12.github.io/azurecord-web/
```

Assim, novas telas e funções do cliente não precisam ser copiadas manualmente para o Vercel.
