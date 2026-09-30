# Azurecord V17

Protótipo web do Azurecord, com contas locais persistentes, DMs, membros de demonstração e AzureCall.

## Membro de demonstração
O app preserva o comportamento da V13: mantém somente **Lola** como membro de demonstração. Contas reais criadas no navegador continuam podendo aparecer como pessoas quando houver mais de uma conta local.

## Voz da Lola
O servidor de voz não usa `SpeechSynthesis` do navegador como fallback. A fala da Lola em chamadas é gerada no servidor local pelo pacote `@travisvn/edge-tts`, usando a voz brasileira `pt-BR-ThalitaMultilingualNeural`, com ritmo e pitch ajustados para uma interpretação mais leve/jovem. A lista oficial da Microsoft documenta ThalitaMultilingual como uma voz feminina em pt-BR; o serviço é online e pode mudar ao longo do tempo. 

A primeira execução de `start-localhost.bat` instala a dependência do TTS com npm. É necessária conexão com a internet para gerar o áudio.

## Teste
1. Execute `start-localhost.bat`.
2. Aguarde o servidor abrir em `http://localhost:5500`.
3. Entre/crie sua conta.
4. Abra o perfil da Lola.
5. Inicie a chamada de demonstração.

Mensagens e DMs continuam mudas. A voz é usada somente durante a chamada.

- V15: chamadas entre membros temporariamente desativadas; lista de membros restaurada; DM e perfis preservados.


## V17
- Mensagens no formato *ação* são reconhecidas como ações.
- Lola reage contextualmente à ação e também pode responder usando *descrição da reação*.
- Ações aparecem com tratamento visual próprio na conversa.
