/* Recursos locais da Lola. Não simula conhecimento que exige um modelo externo. */
(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AzurecordLola = api;
})(typeof window !== 'undefined' ? window : null, function() {
  'use strict';
  function wantsNewConversation(value) {
    const s = String(value || '').normalize('NFKC').trim().toLowerCase()
      .replace(/^[\s,!.]+|[\s!.]+$/g, '').replace(/\s+/g, ' ')
      .replace(/^(?:(?:ei|lola|por favor)[,!]?\s+)+/g, '');
    if (!s || s.length > 180 || /^(?:como|por que|quando|onde|e se|se eu|o que acontece|me explica|me ensina)\b/.test(s)) return false;
    return /^(?:eu\s+)?(?:quero|queria|vamos|bora|podemos|pode)\s+(?:fazer|criar|abrir|ter)\s+(?:um|uma)\s+(?:chat|conversa)\s+(?:novo|nova|outro|outra)\??$/.test(s)
      || /^(?:novo chat|nova conversa|começar do zero|reiniciar conversa|zerar conversa)\??$/.test(s)
      || /^(?:(?:eu\s+)?(?:quero|queria|gostaria de|prefiro|vamos|bora|podemos|pode|poderia|inicia|iniciar|começa|começar|abre|abrir|cria|criar|reinicia|reiniciar|zera|zerar)\s+)(?:(?:de\s+)?(?:conversar|falar|começar|iniciar|abrir|criar|ter|ir|mudar|trocar)\s+(?:em|num|no|uma|um|de|do|pra|para|outro|outra)\s+)?(?:um\s+|uma\s+|no\s+|num\s+|de\s+|pra\s+|para\s+)?(?:novo|nova|outro|outra|do zero|zero|limpa|limpar|a conversa|o chat|chat|conversa)(?:\s+(?:chat|conversa|assunto|do zero|agora|com você|contigo|por favor|aqui|nova|novo|outro|outra))*\??$/.test(s)
      || /^(?:quero|queria|vamos|bora|pode|poderia)\s+(?:conversar|falar)\s+(?:num|em um|em outro|em uma|numa)\s+(?:novo|nova|outro|outra)\s+(?:chat|conversa)\??$/.test(s);
  }
  function normalize(s) { return String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[\p{P}\p{S}]/gu,' ').replace(/\s+/g,' ').trim(); }
  function pickFresh(choices, previous = [], seed = Math.random()) {
    const recent = (Array.isArray(previous)?previous:[]).slice(-8).map(normalize);
    const available = choices.filter(s => !recent.includes(normalize(s)));
    // Se todo o repertório foi usado, evita ao menos repetir a última fala.
    const pool = available.length ? available : (choices.length>1 ? choices.filter(s => normalize(s)!==recent.at(-1)) : choices);
    return pool[Math.floor(Math.abs(seed % 1) * pool.length)] || '';
  }
  function offlineReply(text, previous = [], attachmentCount = 0) {
    const raw = String(text||'').trim();
    const s = normalize(raw);
    if (attachmentCount) return pickFresh([
      'Recebi o anexo. 👀 Minha análise visual completa precisa da IA conectada; me diz o que quer verificar enquanto isso.',
      'O arquivo chegou. 🔎 Para examinar o conteúdo, preciso reconectar meu modelo de IA.'
    ],previous);
    if (/^(oi|ola|opa|e ai|bom dia|boa tarde|boa noite|eae|salve)[! ]*$/.test(s)) return pickFresh([
      'E aí! 😈 Qual vai ser o papo de hoje?', 'Opa, apareci! 👹 Me conta o que está pegando.',
      'Salve! 💙 Já cheguei, pode falar.'
    ],previous);
    if (/^(tudo bem|como voce esta|como vc ta|como voce ta|voce ta bem|e voce|e vc)\??$/.test(s)) return pickFresh([
      'Tudo certo por aqui! 😈 E contigo?', 'Tô na área, pronta pra conversar. 💙 Como anda o dia?',
      'Na paz! 👹 Só meu cérebro de IA que pode estar offline no momento.'
    ],previous);
    if (/^(quem e voce|quem e a lola|o que voce faz|qual seu nome)\??$/.test(s)) return 'Sou a Lola, assistente do Azurecord. 💙 Posso trocar ideia e, com o modelo conectado, responder perguntas, ajudar com projetos e analisar imagens.';
    const numeric = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
    const math = numeric.match(/^(?:quanto e |quanto da |calcule |resolve |qual e |quanto vale )?(-?\d+(?:[.,]\d+)?)\s*([+\-*x×/÷])\s*(-?\d+(?:[.,]\d+)?)\??$/);
    if (math) {
      const a=Number(math[1].replace(',','.')), b=Number(math[3].replace(',','.'));
      const op=math[2];
      if ((op==='/'||op==='÷') && b===0) return 'Dividir por zero não está definido. 🧮';
      const value=op==='+'?a+b:op==='-'?a-b:op==='*'||op==='x'||op==='×'?a*b:a/b;
      return `Dá ${Number(value.toFixed(8)).toLocaleString('pt-BR')}. 🧮`;
    }
    if (/^(obrigad[oa]|valeu|vlw|brigad[oa])[! ]*$/.test(s)) return pickFresh(['Tamo junto! 👹💙','Por nada! 😈','Disponha! 💙'],previous);
    if (/^(sim|nao|isso|certo|beleza|ok|bora|pode|claro)[! ]*$/.test(s)) return pickFresh([
      'Fechou! 💙', 'Perfeito, tô aqui. 👀', 'Combinado! 😈'
    ],previous);
    return pickFresh([
      'Minha conexão com o modelo de IA está indisponível agora. 🧠💤 Não quero te dar uma resposta inventada; quando ela voltar, respondo essa pergunta normalmente.',
      'Tô no modo local por enquanto. 👹 Para responder isso com precisão, preciso que a IA do backend esteja conectada.',
      'Parece que meu cérebro de IA tirou uma folga técnica. 💀 Não vou fingir que entendi uma pergunta que não consigo responder sem o modelo.'
    ],previous);
  }
  return { wantsNewConversation, normalize, pickFresh, offlineReply };
});
