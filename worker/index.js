// Set & Steal on Cloudflare.
//
// The game files in public/ are served as static assets (free, never hits this code).
// This Worker only answers /api/*:
//   /api/rooms  create, join, start, save moves, leave, read the room   (same API as api/rooms.js)
//   /api/chat   read and send room chat                                (same API as api/chat.js)
//   /api/live   a WebSocket that pushes room and chat updates the moment they happen
// Each room lives in its own Durable Object ("Room"), which keeps the room, the game state and
// the last 150 chat messages, and deletes itself after 7 days without activity.
import { DurableObject } from "cloudflare:workers";

const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PLAYERS = 5;
const MAX_MESSAGES = 150;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS } });
const fail = (status, error, extra = {}) => ({ status, data: { error, ...extra } });

function randomString(chars, length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}
const makeCode = () => randomString(ALPHABET, 6);
const makeToken = () => randomString("abcdefghijklmnopqrstuvwxyz0123456789", 32);
const cleanName = (v) => (typeof v === "string" ? v.trim().replace(/[<>]/g, "").slice(0, 24) : "");

async function readBody(request) {
  // Clients send JSON as text/plain so cross-site calls need no CORS preflight.
  try { return JSON.parse(await request.text()) || {}; } catch { return {}; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const roomStub = (code) => env.ROOMS.get(env.ROOMS.idFromName(code));

    if (url.pathname === "/api/live") {
      const code = String(url.searchParams.get("code") || "").toUpperCase();
      if (!CODE_RE.test(code)) return json({ error: "Enter a valid 6-character room code." }, 400);
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "Expected a WebSocket." }, 426);
      return roomStub(code).fetch(request);
    }

    if (url.pathname !== "/api/rooms" && url.pathname !== "/api/chat") return json({ error: "Not found." }, 404);
    if (request.method !== "GET" && request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const input = request.method === "GET" ? Object.fromEntries(url.searchParams) : await readBody(request);

    if (url.pathname === "/api/rooms" && request.method === "POST" && input.action === "create") {
      const name = cleanName(input.name);
      if (!name) return json({ error: "Enter your name to create a room." }, 400);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = makeCode();
        const r = await roomStub(code).create(code, name);
        if (r.status !== 409) return json({ ...r.data, live: true }, r.status);
      }
      return json({ error: "Could not generate a room code. Try again." }, 503);
    }

    const code = String(input.code || "").trim().toUpperCase();
    if (!CODE_RE.test(code)) {
      return url.pathname === "/api/chat" ? json({ error: "Join this room to chat." }, 403) : json({ error: "Enter a valid 6-character room code." }, 400);
    }
    const stub = roomStub(code);
    if (url.pathname === "/api/chat") { const r = await stub.chat(request.method, input); return json(r.data, r.status); }
    // `live: true` tells the game it can use /api/live instead of polling.
    const r = await stub.rooms(request.method, input);
    return json({ ...r.data, live: true }, r.status);
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the room up.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    this.lastPost = new Map();
  }

  // ---------- storage ----------
  load() { return this.ctx.storage.get("room"); }
  async store(room) {
    room.updatedAt = new Date().toISOString();
    await this.ctx.storage.put("room", room);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }
  publicRoom(room) {
    return {
      code: room.code, status: room.status, revision: room.revision,
      players: room.players.map((p) => ({ id: p.id, name: p.name, isHost: !!p.isHost })),
      gameState: room.gameState || null, updatedAt: room.updatedAt,
    };
  }
  broadcast(message) {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(text); } catch {} }
  }
  pushRoom(room) { this.broadcast({ type: "room", room: this.publicRoom(room) }); }

  // ---------- rooms ----------
  async create(code, name) {
    if (await this.load()) return fail(409, "Code in use.");
    const token = makeToken();
    const room = { code, hostToken: token, status: "lobby", revision: 0, gameState: null, createdAt: new Date().toISOString(),
      players: [{ id: token.slice(0, 12), token, name, isHost: true, joinedAt: Date.now() }] };
    await this.store(room);
    return { status: 201, data: { token, room: this.publicRoom(room) } };
  }

  async rooms(method, input) {
    const room = await this.load();
    if (!room) return fail(404, "Room not found. Check the code and try again.");
    const token = String(input.token || "");

    if (method === "GET") {
      if (!room.players.some((p) => p.token === token)) return fail(403, "Join this room before viewing its game state.");
      return { status: 200, data: { room: this.publicRoom(room) } };
    }

    const action = String(input.action || "");
    if (action === "join") {
      const name = cleanName(input.name);
      if (!name) return fail(400, "Enter your name to join.");
      if (room.status !== "lobby") return fail(409, "This game has already started.");
      if (room.players.length >= MAX_PLAYERS) return fail(409, "This room is full (5 players max).");
      if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return fail(409, "That name is already in this room. Choose another.");
      const playerToken = makeToken();
      room.players.push({ id: playerToken.slice(0, 12), token: playerToken, name, isHost: false, joinedAt: Date.now() });
      await this.store(room); this.pushRoom(room);
      return { status: 200, data: { token: playerToken, room: this.publicRoom(room) } };
    }

    const player = room.players.find((p) => p.token === token);
    if (!player) return fail(403, "This room session is not valid. Join the room again.");

    if (action === "start") {
      if (room.hostToken !== token) return fail(403, "Only the room creator can start the game.");
      if (room.players.length < 2) return fail(409, "Invite at least one more player first.");
      if (!input.gameState || typeof input.gameState !== "object") return fail(400, "Game state is missing.");
      if (room.status !== "lobby") return fail(409, "This room has already started.");
      room.status = "playing"; room.gameState = input.gameState; room.revision++;
      await this.store(room); this.pushRoom(room);
      return { status: 200, data: { room: this.publicRoom(room) } };
    }

    if (action === "save") {
      if (room.status !== "playing") return fail(409, "The game has not started yet.");
      if (!input.gameState || typeof input.gameState !== "object") return fail(400, "Game state is missing.");
      if (Number(input.revision) !== room.revision) return fail(409, "A newer move arrived from another player.", { room: this.publicRoom(room) });
      room.gameState = input.gameState; room.revision++;
      await this.store(room); this.pushRoom(room);
      return { status: 200, data: { room: this.publicRoom(room) } };
    }

    if (action === "leave") {
      if (room.status === "lobby" && !player.isHost) {
        room.players = room.players.filter((p) => p.token !== token);
        await this.store(room);
        for (const ws of this.ctx.getWebSockets(player.id)) { try { ws.close(1000, "Left the room"); } catch {} }
        this.pushRoom(room);
        return { status: 200, data: { left: true, room: this.publicRoom(room) } };
      }
      return { status: 200, data: { left: true } };
    }

    return fail(400, "Unknown room action.");
  }

  // ---------- chat ----------
  async chat(method, input) {
    const room = await this.load();
    const me = room && room.players.find((p) => p.token === String(input.token || ""));
    if (!me) return fail(403, "Join this room to chat.");
    const messages = (await this.ctx.storage.get("messages")) || [];

    if (method === "GET") {
      const after = Number(input.after) || 0;
      return { status: 200, data: { messages: messages.filter((m) => m.id > after).slice(-60) } };
    }

    const body = String(input.text || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240);
    if (!body) return fail(400, "Type a message first.");
    const now = Date.now();
    if (now - (this.lastPost.get(me.name) || 0) < 350) return fail(429, "Slow down a little.");
    this.lastPost.set(me.name, now);
    const seq = ((await this.ctx.storage.get("seq")) || 0) + 1;
    const message = { id: seq, name: me.name, body, at: new Date(now).toISOString() };
    await this.ctx.storage.put({ seq, messages: messages.concat(message).slice(-MAX_MESSAGES) });
    await this.store(room);
    this.broadcast({ type: "chat", message });
    return { status: 201, data: { message } };
  }

  // ---------- live connection ----------
  async fetch(request) {
    const url = new URL(request.url);
    const room = await this.load();
    const player = room && room.players.find((p) => p.token === String(url.searchParams.get("token") || ""));
    if (!player) return json({ error: "Join this room first." }, 403);
    const { 0: client, 1: server } = new WebSocketPair();
    // Hibernation API: the room sleeps between messages, so open connections cost nothing while idle.
    this.ctx.acceptWebSocket(server, [player.id]);
    server.send(JSON.stringify({ type: "room", room: this.publicRoom(room) }));
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage() {} // clients only listen; keep-alive pings are auto-answered
  async webSocketClose(ws, code) { try { ws.close(code === 1005 ? 1000 : code, "Closed"); } catch {} }

  // ---------- clean-up ----------
  async alarm() {
    const room = await this.load();
    if (room && Date.now() - Date.parse(room.updatedAt) < ROOM_TTL_MS) { await this.ctx.storage.setAlarm(Date.parse(room.updatedAt) + ROOM_TTL_MS); return; }
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, "Room expired"); } catch {} }
    await this.ctx.storage.deleteAll();
  }
}
