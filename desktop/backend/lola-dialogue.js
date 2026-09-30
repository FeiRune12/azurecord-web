'use strict';

// Funções puras: também são verificadas nos testes, sem conexão com uma IA externa.
function wantsNewConversation(text) {
  const value = String(text || '').normalize('NFKC').toLowerCase().trim()
    .replace(/^[!,.\s]+|[!.\s]+$/g, '').replace(/\s+/g, ' ');
  if (!value || value.length > 180) return false;
  // Não execute comandos descritos como exemplos/perguntas sobre o recurso.
  if (/^(?:como|por que|quando|onde|e se|se eu|o que acontece|me explica|me ensina)\b/.test(value)) return false;
  const sentence = value.replace(/^(?:lola[,!]?\s+|ei[,!]?\s+|por favor[,!]?\s+)+/, '');
  return /^(?:eu\s+)?(?:quero|queria|vamos|bora|podemos|pode)\s+(?:fazer|criar|abrir|ter)\s+(?:um|uma)\s+(?:chat|conversa)\s+(?:novo|nova|outro|outra)\??$/.test(sentence)
    || /^(?:(?:eu\s+)?(?:quero|queria|gostaria de|prefiro|vamos|bora|podemos|pode|poderia|inicia|iniciar|começa|começar|abre|abrir|cria|criar|reinicia|reiniciar|zera|zerar)\s+)(?:(?:de\s+)?(?:conversar|falar|começar|iniciar|abrir|criar|ter|ir|mudar|trocar)\s+(?:em|num|no|uma|um|de|do|pra|para|outro|outra)\s+)?(?:um\s+|uma\s+|no\s+|num\s+|de\s+|pra\s+|para\s+)?(?:novo|nova|outro|outra|do zero|zero|limpa|limpar|a conversa|o chat|chat|conversa)(?:\s+(?:chat|conversa|assunto|do zero|agora|com você|contigo|por favor|aqui|nova|novo|outro|outra))*\??$/u.test(sentence)
    || /^(?:quero|queria|vamos|bora|pode|poderia)\s+(?:conversar|falar)\s+(?:num|em um|em outro|em uma|numa)\s+(?:novo|nova|outro|outra)\s+(?:chat|conversa)\??$/u.test(sentence)
    || /^(?:novo chat|nova conversa|começar do zero|recomeçar nossa conversa|reiniciar conversa|zerar conversa)\??$/u.test(sentence);
}

function normalizeReply(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ').replace(/\s+/g, ' ').trim();
}
function isRepeatedReply(candidate, recentReplies) {
  const text = normalizeReply(candidate);
  if (!text || !Array.isArray(recentReplies)) return false;
  const candidateWords = text.split(' ');
  return recentReplies.slice(-5).some(previous => {
    const other = normalizeReply(previous);
    if (!other) return false;
    if (other === text) return true;
    const otherWords = other.split(' ');
    if (Math.min(otherWords.length, candidateWords.length) < 12) return false;
    const a = new Set(candidateWords), b = new Set(otherWords);
    const intersection = [...a].filter(word => b.has(word)).length;
    return intersection / Math.max(a.size, b.size) >= 0.84;
  });
}
function recentAssistantMessages(messages, max = 5) {
  return (Array.isArray(messages) ? messages : []).filter(m => m.role === 'assistant' && m.text)
    .slice(-max).map(m => String(m.text).slice(0, 1200));
}
module.exports = { wantsNewConversation, normalizeReply, isRepeatedReply, recentAssistantMessages };
