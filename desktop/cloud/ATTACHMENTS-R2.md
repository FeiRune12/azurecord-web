# Azurecord attachments via Cloudflare R2

A API 0.8.2 move anexos para R2 em vez de colocar blobs grandes dentro do JSON/D1. O cliente divide o arquivo em partes de 8 MiB e usa multipart upload, então o Azurecord não impõe um limite artificial de MB.

## Configuração necessária

1. No Cloudflare Dashboard, crie um bucket R2, por exemplo `azurecord-attachments`.
2. Abra o Worker da API do Azurecord.
3. Em **Bindings**, adicione um **R2 bucket binding**.
4. Nome da variável: `ATTACHMENTS`.
5. Selecione o bucket criado e publique o Worker usando `desktop/cloud/worker-v0.8.1.js` (o arquivo agora reporta API 0.8.2).
6. Abra `/health` e confirme `largeAttachments: true`.

Os arquivos são enviados em chunks; D1 guarda apenas nome, tipo, tamanho, key e URL.

Não existe mais o limite de 1,5 MB do cliente. O armazenamento/plataforma ainda possui limites físicos máximos próprios.
