'use strict';

// AzurePoints: servidor é a fonte de verdade. Saldo e resgates nunca são
// aceitos do cliente. Esta beta NÃO efetua pagamentos: somente registra
// solicitações para conferência e pagamento externo pelo administrador.
const crypto = require('node:crypto');

const int = (value, fallback, min, max) => Number.isSafeInteger(Number(value))
  && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;
const time = () => new Date().toISOString();
const uid = prefix => `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
const truthy = value => /^(true|1|on|yes)$/i.test(String(value || ''));
function settings() {
  const pointsPerBRL = int(process.env.AZURECORD_POINTS_PER_BRL, 100, 1, 1000000);
  const minRedeemPoints = int(process.env.AZURECORD_POINTS_MIN_REDEEM, 500, 1, 1000000);
  const adminEmail = String(process.env.AZURECORD_POINTS_ADMIN_EMAIL || process.env.AZURECORD_BETA_ADMIN_EMAIL || '').trim().toLowerCase();
  const adminKey = String(process.env.AZURECORD_POINTS_ADMIN_KEY || '').trim();
  const cashoutEnabled = truthy(process.env.AZURECORD_POINTS_CASHOUT_ENABLED) && Boolean(adminEmail && adminKey);
  return { pointsPerBRL, minRedeemPoints, adminEmail, adminKey, cashoutEnabled };
}
function init(db) {
  if (!Array.isArray(db.pointsLedger)) db.pointsLedger = [];
  if (!Array.isArray(db.pointsRedemptions)) db.pointsRedemptions = [];
}
function grant(backend, userId, points, reason, uniqueKey, metadata = {}) {
  const db = backend.store.db;
  init(db);
  if (!Number.isSafeInteger(points) || points <= 0 || points > 100000) throw new Error('Crédito inválido.');
  const already = db.pointsLedger.find(e => e.userId === userId && e.key === uniqueKey);
  if (already) return { entry: already, awarded: false };
  const entry = { id: uid('apt'), userId, delta: points, reason, key: uniqueKey,
    createdAt: time(), metadata: { ...metadata } };
  db.pointsLedger.push(entry);
  backend.store.saveNow();
  backend.emit(userId, 'points.updated', { reason, points });
  return { entry, awarded: true };
}
function ensureWelcome(backend, user) {
  if (user.isDemo || user.id === 'user-lola') return;
  grant(backend, user.id, 100, 'boas-vindas', 'welcome-v1');
}
function wallet(db, userId) {
  init(db);
  const earned = db.pointsLedger.filter(e => e.userId === userId).reduce((sum, e) => sum + e.delta, 0);
  const reserved = db.pointsRedemptions.filter(r => r.userId === userId && r.status === 'pending')
    .reduce((sum, r) => sum + r.points, 0);
  return { earned, reserved, available: earned - reserved };
}
function publicRedemption(record) {
  return { id: record.id, points: record.points, amountCentavos: record.amountCentavos,
    currency: 'BRL', status: record.status, createdAt: record.createdAt,
    updatedAt: record.updatedAt, paidAt: record.paidAt || null, note: record.note || null };
}
function fail(res, json, status, code, message) { return json(res, status, { error: code, message }); }
function adminAuthorized(user, req, s) {
  if (!s.adminEmail || !s.adminKey || String(user.email || '').toLowerCase() !== s.adminEmail) return false;
  const supplied = String(req.headers['x-azurecord-admin-key'] || '');
  const a = Buffer.from(supplied, 'utf8'), b = Buffer.from(s.adminKey, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function handlePoints({ backend, req, res, parts, user, json, readJson }) {
  const route = parts.join('/');
  if (!route.startsWith('api/points') && !route.startsWith('api/admin/points')) return false;
  const db = backend.store.db;
  init(db);
  const cfg = settings();
  if (route.startsWith('api/admin/points')) {
    if (!adminAuthorized(user, req, cfg)) return fail(res,json,403,'admin_only','Acesso de administrador não autorizado.');
    if (route === 'api/admin/points/credits' && req.method === 'POST') {
      const body = await readJson(req,4096);
      const target = db.users.find(u=>u.id===String(body.userId||'') && !u.isDemo);
      const points = Number(body.points);
      const reason = String(body.reason||'').trim();
      const idempotency = String(body.clientRequestId||'').trim();
      if(!target || !Number.isSafeInteger(points) || points<1 || points>10000 || reason.length<5 || reason.length>200 || !/^[a-zA-Z0-9_-]{8,100}$/.test(idempotency))
        return fail(res,json,400,'validation','Informe usuário válido, 1 a 10.000 AP, motivo (5-200 caracteres) e identificador único.');
      const awarded=grant(backend,target.id,points,'credito-administrativo',`admin:${idempotency}`,{reason,by:user.id});
      return json(res,awarded.awarded?201:200,{entry:awarded.entry,duplicate:!awarded.awarded});
    }
    if (route === 'api/admin/points/redemptions' && req.method === 'GET') {
      const status = String(new URL(req.url, 'http://localhost').searchParams.get('status') || 'pending');
      return json(res,200,{ redemptions: db.pointsRedemptions.filter(r => status === 'all' || r.status === status).map(r => ({ ...publicRedemption(r), userId:r.userId })) });
    }
    const match = route.match(/^api\/admin\/points\/redemptions\/([\w-]+)\/(paid|reject)$/);
    if (match && req.method === 'POST') {
      const record = db.pointsRedemptions.find(r => r.id === match[1]);
      if (!record) return fail(res,json,404,'not_found','Solicitação não encontrada.');
      if (record.status !== 'pending') return fail(res,json,409,'already_processed','Solicitação já processada.');
      const body = await readJson(req, 4096);
      const action = match[2];
      if (action === 'paid') {
        const receipt = String(body.receipt || '').trim();
        if (receipt.length < 6 || receipt.length > 200) return fail(res,json,400,'receipt_required','Informe o comprovante/referência de um pagamento já realizado fora do Azurecord.');
        const current = wallet(db, record.userId);
        if (current.earned < record.points) return fail(res,json,409,'insufficient_points','Saldo mudou: pagamento bloqueado.');
        record.status='paid';record.paidAt=time();record.updatedAt=time();record.receipt=receipt;
        db.pointsLedger.push({ id:uid('apt'), userId:record.userId, delta:-record.points, reason:'resgate-pago', key:`redeem:${record.id}`, createdAt:time(), metadata:{redemptionId:record.id} });
      } else {
        record.status='rejected';record.updatedAt=time();record.note=String(body.reason || 'Solicitação recusada.').slice(0,300);
      }
      backend.store.saveNow(); backend.emit(record.userId,'points.updated',{reason:'redemption',status:record.status});
      return json(res,200,{redemption:publicRedemption(record)});
    }
    return fail(res,json,404,'not_found','Rota de administrador não encontrada.');
  }
  if (user.isDemo || user.id === 'user-lola') return fail(res,json,403,'real_account_required','Use uma conta cadastrada para acessar AzurePoints.');
  ensureWelcome(backend,user);
  if (route === 'api/points/wallet' && req.method === 'GET') {
    return json(res,200,{wallet:wallet(db,user.id),cashoutEnabled:cfg.cashoutEnabled,
      pointsPerBRL:cfg.pointsPerBRL,minRedeemPoints:cfg.minRedeemPoints,
      moneyIsRealOnlyAfterExternalPayment:true});
  }
  if (route === 'api/points/history' && req.method === 'GET') {
    return json(res,200,{entries:db.pointsLedger.filter(e => e.userId===user.id).slice(-100).reverse().map(({id,delta,reason,createdAt})=>({id,delta,reason,createdAt}))});
  }
  if (route === 'api/points/shop' && req.method === 'GET') return json(res,200,{items:[],message:'Loja em preparação. Nenhum item à venda nesta versão.'});
  if (route === 'api/points/redemptions' && req.method === 'GET') {
    return json(res,200,{redemptions:db.pointsRedemptions.filter(r=>r.userId===user.id).slice(-50).reverse().map(publicRedemption)});
  }
  if (route === 'api/points/redemptions' && req.method === 'POST') {
    if (!cfg.cashoutEnabled) return fail(res,json,503,'cashout_unavailable','Resgates para dinheiro não estão habilitados. É necessário configurar um processo de pagamento e revisão administrativa.');
    if (backend.rateLimit(req,res,`points:redeem:${user.id}`,3,3600000)) return;
    const body = await readJson(req,4096);
    const points = Number(body.points);
    const clientRequestId = String(body.clientRequestId || '').trim();
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(clientRequestId)) return fail(res,json,400,'invalid_idempotency','Identificador de resgate inválido.');
    const previous = db.pointsRedemptions.find(r=>r.userId===user.id&&r.clientRequestId===clientRequestId);
    if(previous) return json(res,200,{redemption:publicRedemption(previous),duplicate:true,wallet:wallet(db,user.id)});
    if (!Number.isSafeInteger(points) || points < cfg.minRedeemPoints || points > 100000000 || points % cfg.pointsPerBRL !== 0) {
      return fail(res,json,400,'invalid_points',`Solicite pelo menos ${cfg.minRedeemPoints} pontos, em múltiplos de ${cfg.pointsPerBRL}.`);
    }
    if (wallet(db,user.id).available < points) return fail(res,json,409,'insufficient_points','Pontos disponíveis insuficientes.');
    const record={id:uid('red'),userId:user.id,clientRequestId,points,
      amountCentavos:points/cfg.pointsPerBRL*100,status:'pending',createdAt:time(),updatedAt:time()};
    db.pointsRedemptions.push(record); backend.store.saveNow();
    return json(res,201,{redemption:publicRedemption(record),wallet:wallet(db,user.id),
      note:'Solicitação registrada. Não representa pagamento: o administrador ainda precisa conferir e efetuar a transferência fora do Azurecord.'});
  }
  return fail(res,json,404,'not_found','Rota AzurePoints não encontrada.');
}
module.exports={handlePoints,init,grant,ensureWelcome,wallet,settings};
