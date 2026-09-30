# Azurecord V52 Beta 8.4 — FriendSync + GitHub Pages

Correções principais:
- Social Cloud passa a usar a sessão Cloud validada como fonte de verdade.
- Ao abrir Amigos, Solicitações ou Adicionar amigo, o cliente busca um snapshot novo imediatamente.
- Ao voltar o foco para o app/site, solicitações e amizades são atualizadas.
- Busca de usuários consulta o Azurecord Cloud já no primeiro caractere e não depende do cache local.
- Depois de enviar um pedido, o cliente atualiza o Social Cloud em vez de consultar o backend local legado.
- Pedidos recebidos novos geram notificação e badge.
- Removido o botão inicial “Conversar com Lola”. Lola continua disponível pelas DMs.
- Removido o servidor Azurecord Hub de demonstração, inclusive de estados locais antigos.
- Cliente web inclui saída estática em `docs/` pronta para GitHub Pages.

Backend:
- Continua usando o Worker 0.8.0. Nenhuma alteração de Worker é necessária para este hotfix.
