const AZURECORD_API_URL = "https://azurecord-api.giovannisilvaalves604.workers.dev";
const WS_PROTOCOL = "azurecord-v1";

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
        headers: { "Sec-WebSocket-Protocol": WS_PROTOCOL },
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

  webSocketClose(ws, code, reason) {
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
        version: "1.1.0",
        transport: "websocket",
        hibernation: true,
      });
    }

    if (url.pathname !== "/ws") return json({ ok: false, error: "Not Found" }, 404);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ ok: false, error: "WebSocket upgrade required" }, 426);
    }

    const protocols = parseProtocols(request);
    if (!protocols.includes(WS_PROTOCOL)) {
      return json({ ok: false, error: "Unsupported WebSocket protocol" }, 400);
    }

    const token = protocols.find(value => value !== WS_PROTOCOL) || "";
    const user = await validateToken(token);
    if (!user?.id) return json({ ok: false, error: "Unauthorized" }, 401);

    const hub = env.USER_HUB.get(env.USER_HUB.idFromName(String(user.id)));
    const headers = new Headers(request.headers);
    headers.set("X-Azurecord-User-Id", String(user.id));
    headers.set("X-Azurecord-Session", token);
    headers.set("Sec-WebSocket-Protocol", WS_PROTOCOL);

    return hub.fetch(new Request("https://hub.internal/connect", {
      method: "GET",
      headers,
    }));
  },
};
