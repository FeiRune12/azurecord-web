const AZURECORD_API_URL = "https://azurecord-api.giovannisilvaalves604.workers.dev";
const WS_PROTOCOL = "azurecord-v1";
const WS_PROTOCOL_PREFIX = "azurecord-v1.";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    },
  });
}

function parseProtocols(request) {
  return String(request.headers.get("Sec-WebSocket-Protocol") || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
}

function websocketAuth(request) {
  const protocols = parseProtocols(request);
  const packed = protocols.find(value => value.startsWith(WS_PROTOCOL_PREFIX) && value.length > WS_PROTOCOL_PREFIX.length);
  if (packed) return { token: packed.slice(WS_PROTOCOL_PREFIX.length), selectedProtocol: packed };
  if (protocols.includes(WS_PROTOCOL)) {
    const token = protocols.find(value => value !== WS_PROTOCOL) || "";
    return { token, selectedProtocol: WS_PROTOCOL };
  }
  return { token: "", selectedProtocol: "" };
}

async function validateToken(token) {
  if (!token) return null;
  try {
    const response = await fetch(`${AZURECORD_API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.user?.id ? data.user : null;
  } catch {
    return null;
  }
}

export class UserHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket upgrade required", { status: 426 });
      }

      const userId = String(request.headers.get("X-Azurecord-User-Id") || "");
      const token = String(request.headers.get("X-Azurecord-Session") || "");
      const selectedProtocol = String(request.headers.get("X-Azurecord-Protocol") || WS_PROTOCOL);
      if (!userId || !token) return new Response("Unauthorized", { status: 401 });

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      server.serializeAttachment({
        userId,
        token,
        verifiedAt: Date.now(),
      });
      this.ctx.acceptWebSocket(server);

      server.send(JSON.stringify({
        type: "ready",
        userId,
        transport: "websocket",
        at: Date.now(),
      }));

      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { "Sec-WebSocket-Protocol": selectedProtocol },
      });
    }

    if (url.pathname === "/notify" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body?.event) return new Response("Bad Request", { status: 400 });
      this.broadcast(body.event);
      return new Response(null, { status: 204 });
    }

    return new Response("Not Found", { status: 404 });
  }

  broadcast(event) {
    const payload = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {}
    }
  }

  async sessionFor(ws) {
    let session = ws.deserializeAttachment?.() || null;
    if (!session?.userId || !session?.token) return null;

    if (Date.now() - Number(session.verifiedAt || 0) > 60_000) {
      const user = await validateToken(session.token);
      if (!user || user.id !== session.userId) {
        try { ws.close(4401, "Session expired"); } catch {}
        return null;
      }
      session = { ...session, verifiedAt: Date.now() };
      ws.serializeAttachment(session);
    }
    return session;
  }

  async notifyUser(userId, event) {
    if (!userId) return;
    const stub = this.env.USER_HUB.get(this.env.USER_HUB.idFromName(String(userId)));
    await stub.fetch("https://hub.internal/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event }),
    });
  }

  async friendIdsFor(session) {
    try {
      const response = await fetch(`${AZURECORD_API_URL}/api/friends`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (Array.isArray(data?.friends) ? data.friends : [])
        .map(friend => String(friend?.id || ""))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async peerIdsFor(session) {
    try {
      const response = await fetch(`${AZURECORD_API_URL}/api/realtime/peers`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!response.ok) return this.friendIdsFor(session);
      const data = await response.json();
      return (Array.isArray(data?.peers) ? data.peers : []).map(String).filter(Boolean);
    } catch {
      return this.friendIdsFor(session);
    }
  }

  async serverMemberIdsFor(session, serverId) {
    try {
      const response = await fetch(
        `${AZURECORD_API_URL}/api/servers/${encodeURIComponent(serverId)}/members`,
        { headers: { Authorization: `Bearer ${session.token}` } }
      );
      if (!response.ok) return [];
      const data = await response.json();
      return (Array.isArray(data?.members) ? data.members : [])
        .map(member => String(member?.id || ""))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async webSocketMessage(ws, raw) {
    const session = await this.sessionFor(ws);
    if (!session) return;

    let message;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }

    if (message?.type === "ping") {
      try { ws.send(JSON.stringify({ type: "pong", at: Date.now() })); } catch {}
      return;
    }

    if (message?.type === "presence.commit") {
      const status = ["online", "idle", "dnd", "offline"].includes(String(message.status))
        ? String(message.status)
        : "online";
      const peerIds = await this.peerIdsFor(session);
      const event = {
        type: "presence.changed",
        eventId: crypto.randomUUID(),
        userId: session.userId,
        status,
        at: Date.now(),
      };
      await Promise.allSettled([
        this.notifyUser(session.userId, event),
        ...peerIds.map(userId => this.notifyUser(userId, event)),
      ]);
      return;
    }

    if (message?.type === "typing") {
      const active = message.active !== false;
      const scope = String(message.scope || "");
      if (scope === "dm") {
        const targetUserId = String(message.targetUserId || "");
        if (!targetUserId || targetUserId === session.userId) return;
        const friends = await this.friendIdsFor(session);
        if (!friends.includes(targetUserId)) return;
        await this.notifyUser(targetUserId, {
          type: "typing",
          eventId: crypto.randomUUID(),
          scope: "dm",
          userId: session.userId,
          active,
          at: Date.now(),
        });
        return;
      }
      if (scope === "channel") {
        const serverId = String(message.serverId || "");
        const channelId = String(message.channelId || "");
        if (!serverId || !channelId) return;
        const members = await this.serverMemberIdsFor(session, serverId);
        if (!members.includes(session.userId)) return;
        const event = {
          type: "typing",
          eventId: crypto.randomUUID(),
          scope: "channel",
          userId: session.userId,
          serverId,
          channelId,
          active,
          at: Date.now(),
        };
        await Promise.allSettled(
          members.filter(userId => userId !== session.userId).map(userId => this.notifyUser(userId, event))
        );
        return;
      }
    }

    if (message?.type === "call.signal") {
      const targetUserId = String(message.targetUserId || "");
      const rawSignal = message.signal && typeof message.signal === "object" ? message.signal : null;
      if (!targetUserId || targetUserId === session.userId || !rawSignal) return;
      const friends = await this.friendIdsFor(session);
      if (!friends.includes(targetUserId)) return;
      const kind = String(rawSignal.kind || "");
      const callId = String(rawSignal.callId || "").slice(0, 120);
      const callType = ["voice", "video", "screen"].includes(String(rawSignal.callType)) ? String(rawSignal.callType) : "voice";
      if (!callId || !["ring","offer","answer","ice","ice-restart","accepted","hangup","decline","busy"].includes(kind)) return;
      const signalId = String(rawSignal.signalId || "").slice(0, 120);
      const signal = { kind, callId, callType, signalId };
      if ((kind === "offer" || kind === "answer") && rawSignal.description && typeof rawSignal.description === "object") signal.description = rawSignal.description;
      if (kind === "ice" && rawSignal.candidate && typeof rawSignal.candidate === "object") signal.candidate = rawSignal.candidate;
      if (rawSignal.reason) signal.reason = String(rawSignal.reason).slice(0, 80);
      if (JSON.stringify(signal).length > 180000) return;
      await this.notifyUser(targetUserId, {
        type: "call.signal",
        eventId: crypto.randomUUID(),
        fromUserId: session.userId,
        signal,
        at: Date.now(),
      });
      return;
    }

    if (message?.type === "account.commit") {
      await this.notifyUser(session.userId, {
        type: "account.changed",
        eventId: crypto.randomUUID(),
        reason: String(message.reason || "account"),
        at: Date.now(),
      });
      return;
    }

    if (message?.type === "social.commit") {
      const targetUserId = String(message.targetUserId || "");
      const event = { type: "social.changed", eventId: crypto.randomUUID(), reason: String(message.reason || "social"), at: Date.now() };
      const targets = [session.userId];
      if (targetUserId && targetUserId !== session.userId) targets.push(targetUserId);
      await Promise.allSettled(targets.map(userId => this.notifyUser(userId, event)));
      return;
    }

    if (message?.type === "server.commit") {
      const serverId = String(message.serverId || "");
      if (!serverId) return;
      let members = [];
      try {
        const response = await fetch(`${AZURECORD_API_URL}/api/servers/${encodeURIComponent(serverId)}/members`, {
          headers: { Authorization: `Bearer ${session.token}` },
        });
        if (!response.ok) return;
        const data = await response.json();
        members = Array.isArray(data?.members) ? data.members : [];
      } catch {
        return;
      }
      const event = { type: "server.changed", eventId: crypto.randomUUID(), serverId, reason: String(message.reason || "server"), at: Date.now() };
      await Promise.allSettled(members.map(member => String(member?.id || "")).filter(Boolean).map(userId => this.notifyUser(userId, event)));
      return;
    }

    if (message?.type === "dm.commit") {
      const targetUserId = String(message.targetUserId || "");
      if (!targetUserId || targetUserId === session.userId) return;

      try {
        const response = await fetch(`${AZURECORD_API_URL}/api/friends`, {
          headers: { Authorization: `Bearer ${session.token}` },
        });
        if (!response.ok) return;
        const data = await response.json();
        const allowed = Array.isArray(data?.friends) && data.friends.some(friend => String(friend?.id || "") === targetUserId);
        if (!allowed) return;
      } catch {
        return;
      }

      let canonical = null;
      try {
        const response = await fetch(`${AZURECORD_API_URL}/api/dms/${encodeURIComponent(targetUserId)}`, {
          headers: { Authorization: `Bearer ${session.token}` },
        });
        if (response.ok) {
          const data = await response.json();
          const messages = Array.isArray(data?.messages) ? data.messages : [];
          canonical = messages.find(m =>
            String(m?.id || "") === String(message.messageId || "") ||
            (message.clientId && String(m?.clientId || "") === String(message.clientId))
          ) || null;
        }
      } catch {}

      const eventId = crypto.randomUUID();
      const makeEvent = peerId => canonical
        ? { type: "dm.upsert", eventId, peerId, message: canonical, at: Date.now() }
        : { type: "dm.changed", eventId, peerId, at: Date.now() };

      await Promise.allSettled([
        this.notifyUser(session.userId, makeEvent(targetUserId)),
        this.notifyUser(targetUserId, makeEvent(session.userId)),
      ]);
      return;
    }

    if (message?.type === "channel.commit") {
      const serverId = String(message.serverId || "");
      const channelId = String(message.channelId || "");
      if (!serverId || !channelId) return;

      let members = [];
      try {
        const response = await fetch(
          `${AZURECORD_API_URL}/api/servers/${encodeURIComponent(serverId)}/members`,
          { headers: { Authorization: `Bearer ${session.token}` } }
        );
        if (!response.ok) return;
        const data = await response.json();
        members = Array.isArray(data?.members) ? data.members : [];
      } catch {
        return;
      }

      let canonical = null;
      try {
        const response = await fetch(
          `${AZURECORD_API_URL}/api/servers/${encodeURIComponent(serverId)}/channels/${encodeURIComponent(channelId)}/messages?limit=100`,
          { headers: { Authorization: `Bearer ${session.token}` } }
        );
        if (response.ok) {
          const data = await response.json();
          const messages = Array.isArray(data?.messages) ? data.messages : [];
          canonical = messages.find(m =>
            String(m?.id || "") === String(message.messageId || "") ||
            (message.clientId && String(m?.clientId || "") === String(message.clientId))
          ) || null;
        }
      } catch {}

      const event = {
        type: canonical ? "channel.upsert" : "channel.changed",
        eventId: crypto.randomUUID(),
        serverId,
        channelId,
        ...(canonical ? { message: canonical } : {}),
        at: Date.now(),
      };

      await Promise.allSettled(
        members
          .map(member => String(member?.id || ""))
          .filter(Boolean)
          .map(userId => this.notifyUser(userId, event))
      );
      return;
    }
  }

  webSocketClose(ws, code, reason) {
    const session = ws.deserializeAttachment?.() || null;
    if (session?.userId && session?.token) {
      this.ctx.waitUntil((async () => {
        const others = this.ctx.getWebSockets().filter(socket => socket !== ws);
        if (others.length) return;
        const peerIds = await this.peerIdsFor(session);
        const event = {
          type: "presence.changed",
          eventId: crypto.randomUUID(),
          userId: session.userId,
          status: "offline",
          at: Date.now(),
        };
        await Promise.allSettled(peerIds.map(userId => this.notifyUser(userId, event)));
      })());
    }
    try { ws.close(code, reason); } catch {}
  }

  webSocketError() {}
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return json({ ok: true }, 204);

    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json({
        ok: true,
        service: "azurecord-realtime",
        version: "1.5.0",
        transport: "websocket",
        hibernation: true,
      });
    }

    if (url.pathname !== "/ws") return json({ ok: false, error: "Not Found" }, 404);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ ok: false, error: "WebSocket upgrade required" }, 426);
    }

    const auth = websocketAuth(request);
    if (!auth.selectedProtocol || !auth.token) {
      return json({ ok: false, error: "Unsupported WebSocket protocol" }, 400);
    }

    const user = await validateToken(auth.token);
    if (!user?.id) return json({ ok: false, error: "Unauthorized" }, 401);

    const hub = env.USER_HUB.get(env.USER_HUB.idFromName(String(user.id)));
    const headers = new Headers(request.headers);
    headers.set("X-Azurecord-User-Id", String(user.id));
    headers.set("X-Azurecord-Session", auth.token);
    headers.set("X-Azurecord-Protocol", auth.selectedProtocol);
    headers.set("Sec-WebSocket-Protocol", auth.selectedProtocol);

    return hub.fetch(new Request("https://hub.internal/connect", {
      method: "GET",
      headers,
    }));
  },
};
