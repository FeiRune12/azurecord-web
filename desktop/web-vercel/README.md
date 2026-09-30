# Azurecord Web — V52 Beta 8.3.1

Cliente web estático do Azurecord, usando o mesmo Cloudflare Worker e D1 do app desktop.

## GitHub Pages
A build gera arquivos estáticos e também pode ser publicada diretamente pela pasta `docs` incluída no pacote principal.

No GitHub:
Settings > Pages > Deploy from a branch > main > /docs.

## Build local
```bash
npm run build
```

A saída fica em `dist/`.

A API Cloud padrão é:
`https://azurecord-api.giovannisilvaalves604.workers.dev`

Nenhuma chave do Workers AI fica no navegador.
