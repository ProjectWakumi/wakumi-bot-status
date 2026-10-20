// Wakumi Bot Status API — Cloudflare Worker + Durable Object (SQLite)
//
//   POST /api/heartbeat  (บอทส่งทุก ~20 วินาที ต้องมี Bearer Token ของบอทนั้น)
//   GET  /api/status     (เว็บไซต์ดึงไปแสดง — ข้อมูลสาธารณะ)
//
// ใช้ Durable Object แทน KV: KV แผนฟรีเขียนได้แค่ 1,000 ครั้ง/วัน แต่ Heartbeat ทุก 20 วินาที
// = 4,320 ครั้ง/วัน/บอท ส่วน Durable Object (SQLite) ใช้ได้บนแผนฟรีและอ่านเขียนได้ทันที ไม่มีดีเลย์กระจายข้อมูล
import { DurableObject } from "cloudflare:workers";

const DEFAULT_OFFLINE_AFTER_S = 90;
const DEFAULT_ALLOWED_ORIGINS = ["https://wakumi.pages.dev/"];
const MIN_HEARTBEAT_INTERVAL_MS = 5_000; // กันยิงถี่ผิดปกติ (ปกติบอทส่งทุก 20 วินาที)
const MAX_BODY_BYTES = 2_048;
const STALE_BOT_DAYS = 365; // บอทที่หายไปเกินนี้จะถูกลบออกจากรายการ (ยาวพอให้เว็บยังขึ้น Offline แทนที่จะกลายเป็น "ตรวจสอบไม่ได้")

// ---------------------------------------------------------------- helpers
function allowedOrigins(env) {
  const extra = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return extra.length ? extra : DEFAULT_ALLOWED_ORIGINS;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Cache-Control, Pragma",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status = 200, origin = null, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(origin ? corsHeaders(origin) : {}),
      ...extra,
    },
  });
}

// เทียบ Token แบบเวลาคงที่ (กัน timing attack) โดยเทียบ SHA-256 ของทั้งสองค่า
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const ax = new Uint8Array(x);
  const by = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ax.length; i++) diff |= ax[i] ^ by[i];
  return diff === 0;
}

function validateStatus(body) {
  const isInt = Number.isInteger;
  if (typeof body.name !== "string" || body.name.length < 1 || body.name.length > 80) return false;
  if (typeof body.connected !== "boolean") return false;
  if (!isInt(body.guilds) || body.guilds < 0 || body.guilds > 100_000) return false;
  if (!isInt(body.members) || body.members < 0 || body.members > 100_000_000) return false;
  if (body.ping !== null && body.ping !== undefined) {
    if (typeof body.ping !== "number" || !Number.isFinite(body.ping) || body.ping < 0 || body.ping > 60_000) return false;
  }
  return true;
}

// ---------------------------------------------------------------- Durable Object
export class StatusHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS bots (
        id        TEXT PRIMARY KEY,
        name      TEXT    NOT NULL,
        connected INTEGER NOT NULL,
        guilds    INTEGER NOT NULL,
        members   INTEGER NOT NULL,
        ping      REAL,
        last_seen INTEGER NOT NULL
      )
    `);
  }

  // บันทึก Heartbeat — คืน { ok, retryAfterMs? }
  async report(rec) {
    const now = Date.now();
    const prev = this.sql.exec("SELECT connected, last_seen FROM bots WHERE id = ?", rec.id).toArray()[0];
    // จำกัดความถี่ แต่ยอมให้ "สถานะเปลี่ยน" (เช่น แจ้งปิดตัว) ผ่านเสมอ
    if (prev && Boolean(prev.connected) === rec.connected && now - prev.last_seen < MIN_HEARTBEAT_INTERVAL_MS) {
      return { ok: false, retryAfterMs: MIN_HEARTBEAT_INTERVAL_MS - (now - prev.last_seen) };
    }
    this.sql.exec(
      `INSERT INTO bots (id, name, connected, guilds, members, ping, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, connected = excluded.connected, guilds = excluded.guilds,
         members = excluded.members, ping = excluded.ping, last_seen = excluded.last_seen`,
      rec.id, rec.name, rec.connected ? 1 : 0, rec.guilds, rec.members, rec.ping ?? null, now,
    );
    this.sql.exec("DELETE FROM bots WHERE last_seen < ?", now - STALE_BOT_DAYS * 86_400_000);
    return { ok: true };
  }

  async list() {
    return this.sql
      .exec("SELECT id, name, connected, guilds, members, ping, last_seen FROM bots ORDER BY name COLLATE NOCASE")
      .toArray();
  }
}

// ---------------------------------------------------------------- Worker
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const requestOrigin = request.headers.get("Origin");
    const origins = allowedOrigins(env);

    // เบราว์เซอร์ที่ส่ง Origin ต้องอยู่ในรายการที่อนุญาต (บอทที่ไม่ใช่เบราว์เซอร์ไม่มี Origin)
    if (requestOrigin && !origins.includes(requestOrigin)) {
      return json({ error: "Origin not allowed" }, 403);
    }
    const cors = requestOrigin; // echo เฉพาะ Origin ที่ผ่านการตรวจแล้ว

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors ? corsHeaders(cors) : {} });
    }

    const hub = env.STATUS_HUB.get(env.STATUS_HUB.idFromName("hub"));

    // ---- Public: สถานะบอททั้งหมด
    if (url.pathname === "/api/status" && request.method === "GET") {
      const offlineAfterMs = (Number(env.OFFLINE_AFTER_SECONDS) || DEFAULT_OFFLINE_AFTER_S) * 1000;
      const rows = await hub.list();
      const now = Date.now();
      const bots = rows.map((r) => {
        const age = now - r.last_seen;
        const online = r.connected === 1 && age >= 0 && age <= offlineAfterMs;
        return {
          id: r.id,
          name: r.name,
          online,
          guilds: r.guilds,
          members: r.members,
          ping: online && r.ping !== null ? Math.round(r.ping) : null,
          lastSeen: r.last_seen,
        };
      });
      return json({ bots, checkedAt: now }, 200, cors);
    }

    // ---- Private: รับ Heartbeat จากบอท
    if (url.pathname === "/api/heartbeat" && request.method === "POST") {
      const declared = Number(request.headers.get("Content-Length") || 0);
      if (declared > MAX_BODY_BYTES) return json({ error: "Payload too large" }, 413, cors);
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return json({ error: "Payload too large" }, 413, cors);

      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return json({ error: "Invalid JSON" }, 400, cors);
      }
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return json({ error: "Invalid JSON" }, 400, cors);
      }
      if (typeof body.id !== "string" || !/^\d{15,25}$/.test(body.id)) {
        return json({ error: "Invalid bot ID" }, 400, cors);
      }

      let tokens;
      try {
        tokens = JSON.parse(env.BOT_TOKENS);
      } catch {
        return json({ error: "Server configuration error" }, 500, cors);
      }
      const expected = typeof tokens?.[body.id] === "string" ? tokens[body.id] : "";
      const header = request.headers.get("Authorization") || "";
      const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
      // เทียบเสมอแม้ไม่มี Token เพื่อให้เวลาตอบสนองใกล้เคียงกัน
      const match = await safeEqual(supplied, expected || "\u0000no-such-token");
      if (!expected || !supplied || !match) return json({ error: "Unauthorized" }, 401, cors);

      if (!validateStatus(body)) return json({ error: "Invalid status fields" }, 400, cors);

      const result = await hub.report({
        id: body.id,
        name: body.name,
        connected: body.connected,
        guilds: body.guilds,
        members: body.members,
        ping: body.ping ?? null,
      });
      if (!result.ok) {
        return json({ error: "Too many requests" }, 429, cors, {
          "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)),
        });
      }
      return json({ ok: true }, 200, cors);
    }

    return json({ error: "Not found" }, 404, cors);
  },
};
