# Azurecord V52 Beta 8.4

## Windows

A versão Windows agora é preparada para ser distribuída como instalador `.exe` NSIS pelo Electron Builder.
O executável recebe o ícone `azurecord.ico`, o AppUserModelID é `com.azurecord.app` e os atalhos usam o nome Azurecord.
Isso evita o comportamento antigo em que o Windows podia fixar o `electron.exe` e mostrar o ícone do Electron.

O updater usa `electron-updater` e GitHub Releases (`FeiRune12/azurecord-web`).
Quando uma release mais nova é publicada, o Azurecord verifica no início e a cada 15 minutos, baixa a atualização em segundo plano e instala ao fechar o app.

### Build local no Windows

```bash
npm install
npm run dist:win
```

O instalador é criado em `release/`.

### Publicar uma atualização manualmente

Defina `GH_TOKEN` com permissão de release no repositório e rode:

```bash
npm run release:win
```

O fluxo recomendado é usar o GitHub Actions incluído no pacote de repositório combinado, que publica as releases automaticamente após push.

> Para que PCs de usuários consigam baixar atualizações sem credenciais privadas, as Releases usadas pelo updater precisam estar publicamente acessíveis.
