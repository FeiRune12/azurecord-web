# Azurecord V52 Beta 8.4

Este repositório pode hospedar ao mesmo tempo o Azurecord Web/PWA e o código do app Windows.

- `docs/`: site estático e PWA. No Vercel, use `docs` como Root Directory.
- `desktop/`: Electron para Windows.
- `.github/workflows/windows-release.yml`: gera e publica automaticamente um instalador `.exe` em GitHub Releases quando `docs/` ou `desktop/` muda na branch `main`.

## Web / celular

O site inclui `manifest.webmanifest`, Service Worker e ícones 192/512/maskable. Em navegadores compatíveis ele pode ser instalado como PWA e abre em modo standalone.

## Windows

O instalador NSIS usa o ícone do Azurecord no executável e nos atalhos. O app verifica GitHub Releases ao iniciar e a cada 15 minutos; uma atualização nova é baixada em segundo plano e instalada ao fechar o Azurecord.

### Importante sobre atualizações

O app não consegue detectar um arquivo que só foi alterado no seu PC. A automação começa depois que a alteração é enviada (`push`) para `main`. O GitHub Actions cria uma nova Release e os Azurecords instalados detectam essa Release.

Para clientes sem autenticação do GitHub conseguirem atualizar, mantenha as Releases acessíveis publicamente.
