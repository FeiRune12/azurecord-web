'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const backend=require('../backend/lola-dialogue');
const client=require('../renderer/lola-client');

test('Intent de novo chat é entendido igualmente no cliente e servidor, sem falsos comandos',()=>{
  const yes=[
    'quero conversar num novo chat','Lola, quero conversar em um novo chat',
    'vamos começar uma nova conversa','novo chat','Lola, abre um novo chat',
    'quero fazer um chat novo','bora outro chat','pode começar uma nova conversa?',
    'podemos abrir outro chat','quero iniciar outro chat'
  ];
  const no=[
    'como começar um novo chat?','quero conversar normalmente',
    'quando eu disser quero um novo chat, o que acontece?',
    'quero conversar sobre um chat novo'
  ];
  for(const input of yes){assert.equal(backend.wantsNewConversation(input),true,`backend: ${input}`);assert.equal(client.wantsNewConversation(input),true,`renderer: ${input}`);}
  for(const input of no){assert.equal(backend.wantsNewConversation(input),false,`backend: ${input}`);assert.equal(client.wantsNewConversation(input),false,`renderer: ${input}`);}
});
test('Detecção de repetição ignora pontuação e emojis, preserva respostas factuais curtas não idênticas',()=>{
  assert.equal(backend.isRepeatedReply('Peguei! 😈 Bora conferir o código.', ['Peguei, bora conferir o código! 💙']),true);
  assert.equal(backend.isRepeatedReply('Brasília é a capital do Brasil.', ['O Brasil é um país localizado na América do Sul.']),false);
  assert.equal(backend.isRepeatedReply('Primeiro, abra o menu de configurações e salve o seu projeto antes de reiniciar o programa.',['Antes de reiniciar o programa, abra o menu de configurações e salve o seu projeto primeiro.']),true);
});
test('Fallback offline não finge conhecer respostas abertas e dá respostas determinísticas para perguntas simples',()=>{
  const replies=['Onde fica Atlântida?', 'Quem ganhou a competição de ontem?'].map(x=>client.offlineReply(x,[]));
  assert.ok(replies.every(x=>/IA|modelo|cérebro/i.test(x)));
  assert.match(client.offlineReply('quanto é 4 + 7?'),/11/);
  assert.match(client.offlineReply('quanto é 5/0'),/zero/i);
  const a=client.pickFresh(['Oi 💙','Salve 😈'],['Oi 💙'],0);
  assert.equal(a,'Salve 😈');
  // Até quando o pequeno repertório inteiro já foi utilizado.
  assert.equal(client.pickFresh(['Oi 😈','Salve 👹'],['Oi 😈','Salve 👹'],0),'Oi 😈');
});
