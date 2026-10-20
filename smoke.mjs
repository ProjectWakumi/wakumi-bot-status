// ทดสอบ Worker ที่กำลังรันอยู่ (wrangler dev หรือที่ deploy แล้ว)
// ⚠️ สคริปต์นี้เขียนข้อมูลจริงลงระบบ (ชื่อ SmokeTestBot + สลับ online/offline) — ถ้ารันกับ Worker จริง
//    ให้ใช้ BOT_ID/BOT_TOKEN ของบอททดสอบแยกต่างหาก ไม่ใช่ของ KaoHorm
//   BASE_URL=http://127.0.0.1:8787 BOT_ID=<Application ID> BOT_TOKEN=<API token ของบอทนั้น> node test/smoke.mjs
// ตัวเลือก: ORIGIN (ค่าเริ่มต้น https://wakumi.pages.dev) | OFFLINE_AFTER_SECONDS=<ค่าเดียวกับ Worker> เพื่อทดสอบการหมดอายุ
const BASE = (process.env.BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const BOT_ID = process.env.BOT_ID;
const TOKEN = process.env.BOT_TOKEN;
const ORIGIN = process.env.ORIGIN || "https://wakumi.pages.dev";
const WAIT_S = Number(process.env.OFFLINE_AFTER_SECONDS || 0);
if (!BOT_ID || !TOKEN) { console.error("ต้องตั้ง BOT_ID และ BOT_TOKEN"); process.exit(2); }

let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  → " + extra : ""}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = async (headers = {}) => (await fetch(`${BASE}/api/status`, { headers })).json();
const beat = (body, auth = `Bearer ${TOKEN}`, headers = {}) =>
  fetch(`${BASE}/api/heartbeat`, { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}), ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const good = { id: BOT_ID, name: "SmokeTestBot", connected: true, guilds: 12, members: 8420, ping: 48.4 };

let r = await fetch(`${BASE}/api/status`);
check("GET /api/status ตอบ JSON ที่มี bots", r.status === 200 && Array.isArray((await r.json()).bots));

check("ไม่มี Authorization → 401", (await beat(good, null)).status === 401);
check("Token ผิด → 401", (await beat(good, "Bearer wrong-token")).status === 401);
check("Bot ID ที่ไม่ได้ลงทะเบียน → 401", (await beat({ ...good, id: "999999999999999999" })).status === 401);
check("ใช้ Token ของบอทตัวอื่นกับ Bot ID นี้ → 401 (Token ผูกกับ ID)", (await beat({ ...good, id: process.env.OTHER_BOT_ID || "123456789012345678" })).status === 401);
check("Bot ID รูปแบบผิด → 400", (await beat({ ...good, id: "abc" })).status === 400);
check("JSON พัง → 400", (await beat("{not json")).status === 400);
check("JSON ไม่ใช่ object → 400", (await beat("[1,2]")).status === 400);
check("ฟิลด์ผิดประเภท (guilds เป็น string) → 400", (await beat({ ...good, guilds: "12" })).status === 400);
check("ping ติดลบ → 400", (await beat({ ...good, ping: -5 })).status === 400);
check("ชื่อบอทยาวเกิน → 400", (await beat({ ...good, name: "x".repeat(81) })).status === 400);
check("Payload ใหญ่เกิน → 413", (await beat({ ...good, pad: "x".repeat(5000) })).status === 413);

r = await beat(good);
check("Heartbeat ถูกต้อง → 200", r.status === 200, String(r.status));
let s = (await status()).bots.find((b) => b.id === BOT_ID);
check("สถานะขึ้น Online พร้อมข้อมูลครบ", s?.online === true && s.guilds === 12 && s.members === 8420 && s.ping === 48 && s.lastSeen > 0, JSON.stringify(s));

r = await beat(good);
check("ยิงซ้ำภายใน 5 วินาที → 429 พร้อม Retry-After", r.status === 429 && Number(r.headers.get("Retry-After")) >= 1, `${r.status} / ${r.headers.get("Retry-After")}`);

r = await beat({ ...good, connected: false, ping: null });
check("แจ้งปิดตัว (connected:false) ผ่านได้แม้ยิงถี่ → 200", r.status === 200, String(r.status));
s = (await status()).bots.find((b) => b.id === BOT_ID);
check("หลังแจ้งปิดตัว สถานะเป็น Offline และ ping เป็น null", s?.online === false && s.ping === null, JSON.stringify(s));

await sleep(5200);
r = await beat({ ...good, ping: null });
check("กลับมาออนไลน์ → 200", r.status === 200);
check("Origin ที่ไม่อนุญาต → 403", (await fetch(`${BASE}/api/status`, { headers: { Origin: "https://evil.example" } })).status === 403);
r = await fetch(`${BASE}/api/status`, { headers: { Origin: ORIGIN } });
check("Origin ที่อนุญาต → มี CORS header", r.status === 200 && r.headers.get("access-control-allow-origin") === ORIGIN);
r = await fetch(`${BASE}/api/heartbeat`, { method: "OPTIONS", headers: { Origin: ORIGIN } });
check("Preflight OPTIONS → 204", r.status === 204);
check("เส้นทางที่ไม่มี → 404", (await fetch(`${BASE}/nope`)).status === 404);
check("GET /api/heartbeat → 404 (รับเฉพาะ POST)", (await fetch(`${BASE}/api/heartbeat`)).status === 404);

if (WAIT_S > 0) {
  console.log(`⏳ รอ ${WAIT_S + 1} วินาทีเพื่อทดสอบการหมดอายุ (บอทดับ/อินเทอร์เน็ตหลุด)…`);
  await sleep((WAIT_S + 1) * 1000);
  s = (await status()).bots.find((b) => b.id === BOT_ID);
  check("ไม่ได้รับ Heartbeat เกินกำหนด → Offline อัตโนมัติ", s?.online === false, JSON.stringify(s));
}
console.log(failed ? `\n❌ ไม่ผ่าน ${failed} รายการ` : "\n🎉 ผ่านทั้งหมด");
process.exit(failed ? 1 : 0);
