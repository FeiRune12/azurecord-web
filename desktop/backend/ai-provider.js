
'use strict';

const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

function getConfig() {
  const provider = String(process.env.AZURECORD_AI_PROVIDER || 'openai').trim().toLowerCase();
  const model = String(process.env.AZURECORD_AI_MODEL || 'gpt-5-mini').trim();
  const baseUrl = String(process.env.AZURECORD_AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const apiKey = String(process.env.AZURECORD_OPENAI_API_KEY || '').trim();
  const maxOutput = Math.max(500, Math.min(12000, Number(process.env.AZURECORD_AI_MAX_OUTPUT || 4500)));
  const reasoningEffort = String(process.env.AZURECORD_AI_REASONING || 'low').trim().toLowerCase();
  const maxContextMessages = Math.max(24, Math.min(120, Number(process.env.AZURECORD_AI_CONTEXT_MESSAGES || 84)));
  const enableMemoryRefresh = /^(1|true|yes|on)$/i.test(String(process.env.AZURECORD_AI_MEMORY_REFRESH || 'true'));
  const memoryModel = String(process.env.AZURECORD_AI_MEMORY_MODEL || model).trim();
  const webSearch = /^(1|true|yes|on)$/i.test(String(process.env.AZURECORD_AI_WEB_SEARCH || ''));
  return { provider, model, baseUrl, apiKey, maxOutput, reasoningEffort, maxContextMessages, enableMemoryRefresh, memoryModel, webSearch };
}

function requestJsonOnce(urlString, body, headers = {}, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const transport = url.protocol === 'http:' ? http : https;
    const payload = JSON.stringify(body);
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      method: 'POST',
      path: `${url.pathname}${url.search}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        Accept: 'application/json',
        ...headers
      },
      timeout: timeoutMs
    }, res => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = chunks.join('');
        let data = null;
        try { data = JSON.parse(raw); } catch {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = data?.error?.message || data?.message || `AI HTTP ${res.statusCode}`;
          const err = new Error(message);
          err.status = res.statusCode;
          err.providerBody = data;
          reject(err);
          return;
        }
        resolve(data || {});
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Tempo limite da IA excedido.'), { code: 'AI_TIMEOUT' })));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function requestJson(urlString, body, headers = {}, timeoutMs = 45000) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await requestJsonOnce(urlString, body, headers, timeoutMs);
    } catch (err) {
      lastError = err;
      const retryable = !err?.status || err.status === 408 || err.status === 409 || err.status === 429 || err.status >= 500 || err.code === 'AI_TIMEOUT';
      if (!retryable || attempt === 1) break;
      await new Promise(r => setTimeout(r, 650));
    }
  }
  throw lastError || new Error('Falha desconhecida na IA.');
}

function extractOutputText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) return response.output_text.trim();
  const chunks = [];
  for (const item of (Array.isArray(response?.output) ? response.output : [])) {
    for (const content of (Array.isArray(item?.content) ? item.content : [])) {
      if (typeof content?.text === 'string') chunks.push(content.text);
      else if (typeof content?.output_text === 'string') chunks.push(content.output_text);
    }
  }
  return chunks.join('\n').trim();
}

function buildResponsesInput(messages) {
  const safeMessages = Array.isArray(messages) ? messages.slice(-120) : [];
  const input = [];
  for (const message of safeMessages) {
    const role = message?.role === 'assistant' ? 'assistant' : 'user';
    const content = [];
    const text = String(message?.text || '').slice(0, 7000);
    if (text) content.push({ type: role === 'assistant' ? 'output_text' : 'input_text', text });
    const images = Array.isArray(message?.images) ? message.images.slice(0, 2) : [];
    for (const image of images) {
      const dataUrl = String(image?.dataUrl || '');
      if (/^data:image\//i.test(dataUrl) && dataUrl.length <= 12000000) {
        content.push({ type: 'input_image', image_url: dataUrl });
      }
    }
    if (content.length) input.push({ role, content });
  }
  return input;
}

async function generateLolaReply({ systemPrompt, messages }) {
  const config = getConfig();
  if (config.provider === 'none') throw Object.assign(new Error('IA desativada.'), { code: 'AI_DISABLED' });
  if (!config.apiKey) throw Object.assign(new Error('Nenhuma chave de IA configurada.'), { code: 'AI_NOT_CONFIGURED' });
  if (config.provider !== 'openai' && config.provider !== 'openai-compatible') {
    throw Object.assign(new Error(`Provider de IA não suportado: ${config.provider}`), { code: 'AI_PROVIDER_UNSUPPORTED' });
  }

  const body = {
    model: config.model,
    instructions: systemPrompt,
    input: buildResponsesInput(messages),
    max_output_tokens: config.maxOutput,
    store: false
  };
  if (['low','medium','high'].includes(config.reasoningEffort) && /^(?:gpt-[5-9]|o[1-9])/i.test(config.model)) {
    body.reasoning = { effort: config.reasoningEffort };
  }
  if (config.webSearch && config.provider === 'openai') body.tools = [{ type: 'web_search' }];

  let response;
  try {
    response = await requestJson(`${config.baseUrl}/responses`, body, { Authorization: `Bearer ${config.apiKey}` });
  } catch (err) {
    // Alguns modelos/provedores OpenAI-compatible não aceitam o campo reasoning.
    // Em vez de quebrar a Lola inteira, repete a mesma requisição sem ele.
    if (err?.status === 400 && body.reasoning) {
      const fallbackBody = { ...body }; delete fallbackBody.reasoning;
      response = await requestJson(`${config.baseUrl}/responses`, fallbackBody, { Authorization: `Bearer ${config.apiKey}` });
    } else if (config.provider === 'openai-compatible' && [404,405,501].includes(err?.status)) {
      // Muitos backends compatíveis (incluindo os locais) implementam somente
      // /chat/completions e não o Responses API.
      const history = (Array.isArray(messages) ? messages : []).slice(-120).map(message => {
        const role=message?.role === 'assistant' ? 'assistant' : 'user';
        const content=[];
        const text=String(message?.text || '').slice(0,7000);
        if(text)content.push({type:'text',text});
        for(const im of (Array.isArray(message?.images) ? message.images : []).slice(0,2)){
          if(/^data:image\//i.test(String(im?.dataUrl||'')) && im.dataUrl.length <= 12000000)content.push({type:'image_url',image_url:{url:im.dataUrl}});
        }
        if(!content.length)return null;
        return {role,content:content.length===1&&content[0].type==='text'?text:content};
      }).filter(Boolean);
      const completed=await requestJson(`${config.baseUrl}/chat/completions`,{
        model:config.model,messages:[{role:'system',content:systemPrompt},...history],max_tokens:config.maxOutput,stream:false
      },{Authorization:`Bearer ${config.apiKey}`});
      const text=typeof completed?.choices?.[0]?.message?.content==='string' ? completed.choices[0].message.content.trim() : '';
      if(!text)throw Object.assign(new Error('Modelo compatível retornou resposta vazia.'),{code:'AI_EMPTY'});
      return {text,model:config.model,provider:config.provider,responseId:completed.id||null};
    } else throw err;
  }
  const text = extractOutputText(response);
  if (!text) throw Object.assign(new Error('A IA retornou uma resposta vazia.'), { code: 'AI_EMPTY' });
  return { text, model: config.model, provider: config.provider, responseId: response.id || null };
}


function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(raw.slice(start, end + 1)); } catch {} }
  return null;
}

async function generateLolaMemoryUpdate({ currentMemory, turns }) {
  const config = getConfig();
  if (!config.apiKey || config.provider === 'none' || !config.enableMemoryRefresh) return null;
  const compactTurns = Array.isArray(turns) ? turns.slice(-100).map(t => ({
    role: t?.role === 'assistant' ? 'assistant' : 'user',
    text: String(t?.text || '').slice(0, 5000)
  })).filter(t => t.text) : [];
  const memory = currentMemory && typeof currentMemory === 'object' ? currentMemory : {};
  const prompt = `Atualize uma memória persistente para a personagem Lola com base numa conversa privada do Azurecord.\n\nRegras:\n- Preserve somente informações úteis para conversas futuras e claramente sustentadas pela conversa.\n- Não invente fatos.\n- Diferencie preferências, projetos, objetivos, fatos estáveis e assuntos recorrentes de coisas que foram ditas só uma vez.\n- Não transforme suposições em fatos.\n- O resumo deve explicar quem é o usuário no contexto da conversa e o que está sendo construído/assumido.\n- Mantenha no máximo 12 itens por lista.\n- Gere SOMENTE JSON válido.\n\nFormato:\n{\n  "summary":"resumo curto e útil",\n  "preferredName":"",\n  "likes":[],\n  "dislikes":[],\n  "projects":[],\n  "facts":[],\n  "goals":[],\n  "openLoops":[],\n  "entities":[],\n  "stylePreferences":[],\n  "relationshipNotes":[]\n}\n\nMemória anterior:\n${JSON.stringify(memory).slice(0, 16000)}\n\nConversa:\n${JSON.stringify(compactTurns).slice(0, 50000)}`;
  try {
    const result = await requestJson(`${config.baseUrl}/responses`, {
      model: config.memoryModel,
      instructions: 'Você é um sistema de consolidação de memória. Retorne somente JSON válido.',
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
      max_output_tokens: 2200,
      store: false
    }, { Authorization: `Bearer ${config.apiKey}` }, 60000);
    const data = extractOutputText(result);
    return extractJsonObject(data);
  } catch (err) {
    return null;
  }
}

function status() {
  const config = getConfig();
  return {
    configured: Boolean(config.apiKey) && config.provider !== 'none',
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    webSearch: config.webSearch,
    reasoningEffort: config.reasoningEffort,
    maxContextMessages: config.maxContextMessages,
    memoryRefresh: config.enableMemoryRefresh,
    memoryModel: config.memoryModel
  };
}

module.exports = { getConfig, generateLolaReply, generateLolaMemoryUpdate, status };
