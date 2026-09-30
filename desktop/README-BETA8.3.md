# Azurecord V52 Beta 8.3

## Configurações do app

A engrenagem abre um workspace responsivo com Minha conta, Perfil, Senha e segurança, Privacidade, Notificações, Aparência, Idioma, Lola/IA, AzurePoints, Arquivos e mídia, Chamadas, Avançado e ações da conta.

Preferências compatíveis são salvas em `/api/settings`. Sessões conectadas usam `/auth/sessions`.

## Configurações de servidor

O menu do servidor abre Perfil do servidor, Canais, Membros, Cargos, Convites, Acesso, Moderação, Integrações, Auditoria e Exclusão.

Nome, descrição, ícone, banner/faixa, cor, convites, membros e cargos possuem rotas Cloud no Worker 0.8.

## Cliente web

`web-vercel` contém um cliente estático construído a partir da mesma interface do desktop. O build escreve a URL da API em `dist/config.js` e não inclui chaves privadas.
