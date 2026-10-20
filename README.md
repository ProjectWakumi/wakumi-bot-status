# Wakumi Bot Status — คู่มือติดตั้ง

บอทรันจาก VS Code บนคอมเหมือนเดิม ส่ง Heartbeat ทุก 20 วินาทีไปที่ Cloudflare Worker แล้วเว็บ `wakumi.pages.dev` ดึงสถานะไปแสดงในการ์ด Bot All One
ถ้าบอทปิด คอมดับ หรืออินเทอร์เน็ตหลุด สถานะจะเป็น Offline เองเมื่อไม่ได้รับ Heartbeat เกิน 90 วินาที

## ที่ต่างจากเอกสารออกแบบ (และเหตุผล)

| เอกสารเดิม | ที่ทำจริง | เหตุผล |
|---|---|---|
| เก็บสถานะใน **KV** | เก็บใน **Durable Object (SQLite)** | KV แผนฟรีเขียนได้ **1,000 ครั้ง/วัน** แต่ Heartbeat ทุก 20 วินาที = 4,320 ครั้ง/วัน/บอท โควตาหมดใน ~5 ชม. แล้วเว็บจะขึ้น Offline ทั้งที่บอทออนไลน์ (ตรวจจากเอกสาร Cloudflare) Durable Object แบบ SQLite ใช้บนแผนฟรีได้ และอ่านเขียนได้ทันที ไม่มีดีเลย์กระจายข้อมูล |
| `os.environ["STATUS_API_URL"]` ตอน import | อ่านตอนโหลด Cog และปิดระบบเงียบ ๆ ถ้าไม่ได้ตั้งค่า | ของเดิมจะ `KeyError` ทำให้โหลดส่วนเสริมไม่ขึ้นถ้าลืมตั้งค่า |
| โค้ด Python ในเอกสารจบกลางคัน (`payload = {`) | เขียนต่อให้ครบ + แจ้งปิดตัวตอนบอทปิด + กันค่า Ping เป็น NaN | `bot.latency` เป็น NaN ก่อนเชื่อมต่อ ซึ่ง API เดิมจะปฏิเสธ |
| เทียบ Token ด้วย `!==` | เทียบแบบเวลาคงที่ + จำกัดขนาด Request + จำกัดความถี่ต่อบอท | ตามข้อควรระวังที่เอกสารเขียนไว้เอง |
| เว็บดึงทุก 15 วินาที | ทุก 30 วินาที และหยุดเมื่อแท็บถูกซ่อน | ประหยัดโควตา Worker ฟรี 100,000 คำขอ/วัน |

## ขั้นตอนติดตั้ง

### 1) Worker (`bot-status-api/`)

```bash
cd bot-status-api
npm install
npx wrangler login
npx wrangler deploy            # สร้าง Worker + Durable Object (ไม่ต้องสร้าง KV)
```

เก็บ URL ที่แสดง เช่น `https://wakumi-bot-status.<ชื่อบัญชี>.workers.dev`

สร้าง API token แยกสำหรับบอทแต่ละตัว (คนละอันกับ Discord Token):

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

รวมเป็น JSON บรรทัดเดียว (key = Discord Application ID ของบอท) แล้วตั้งเป็น Secret:

```bash
npx wrangler secret put BOT_TOKENS
# วาง: {"1438439831502979082":"<token ของ KaoHorm>","<id บอทตัวอื่น>":"<token ของตัวนั้น>"}
```

ทดสอบ: เปิด `https://<worker-url>/api/status` ควรได้ `{"bots":[],...}`

> ถ้าเว็บใช้โดเมนอื่นนอกจาก `wakumi.pages.dev` ให้แก้ `ALLOWED_ORIGINS` ใน `wrangler.toml` (คั่นด้วย `,`) แล้ว `npx wrangler deploy` ใหม่

### 2) บอท (`KaoHormDiscordBot/`)

- คัดลอกโฟลเดอร์ `monitoring/` ไปไว้ข้าง `main.py`
- `main.py` และ `.env.example` ในนี้รวมการแก้ระบบ Banner ที่ส่งไปก่อนหน้าไว้แล้ว ถ้าใช้ไฟล์ของคุณเอง ให้เพิ่มแค่ `"monitoring.status_reporter",` ใน `EXTENSIONS`
- ใส่ใน `.env`:

```
STATUS_API_URL=https://wakumi-bot-status.<ชื่อบัญชี>.workers.dev
STATUS_API_TOKEN=<token ของ KaoHorm ที่ใส่ใน BOT_TOKENS>
STATUS_BOT_NAME=KaoHorm
```

- รีสตาร์ตบอท ใน log ควรเห็น `เปิดการรายงานสถานะไปยัง ... ทุก 20 วินาที`
- ไม่ต้องติดตั้งอะไรเพิ่ม (`aiohttp` มากับ discord.py)

### 3) เว็บไซต์ (`website/`)

- `index.html`: แก้ `data-api-url="https://wakumi-bot-status.REPLACE_ME.workers.dev"` เป็น URL Worker จริง (ตรงส่วน `id="botStatusSection"`)
- คัดลอก `assets/js/bot-status.js` และแทนที่ `index.html`, `style.css` (เพิ่มเฉพาะ 10 บรรทัดใน HTML และ 19 บรรทัดท้าย CSS)
- ⚠️ โฟลเดอร์ `dist/` ใน zip เป็นสำเนา build เก่า (ถูก `.gitignore` กัน และต่างจากไฟล์ราก) ไฟล์ที่แก้อยู่ที่ราก ต้อง build/คัดลอกเข้า `dist/` ตามขั้นตอน deploy ของคุณเอง

## ทดสอบหลังติดตั้ง

1. เปิดบอท → รอ ~20 วินาที → `/api/status` ควรมีบอทและ `online: true`
2. เปิดเว็บ ดูการ์ด LIVE BOT STATUS ในส่วน Bot All One
3. ปิดบอทปกติ → ควรเป็น Offline ทันที (บอทแจ้งปิดตัว) / ปิดแบบดึงปลั๊ก → Offline ภายใน 90 วินาที
4. ชุดทดสอบอัตโนมัติ (ยิงใส่ Worker): `BASE_URL=... BOT_ID=... BOT_TOKEN=... node test/smoke.mjs`
   ⚠️ สคริปต์เขียนข้อมูลจริง ใช้กับบอททดสอบแยกต่างหาก หรือรันกับ `npx wrangler dev` (ใส่ token ทดสอบใน `.dev.vars` ตาม `.dev.vars.example`)

## โควตาแผนฟรี (ประมาณการ)

Worker 100,000 คำขอ/วัน: Heartbeat ~4,320/วัน/บอท + เว็บที่เปิดค้างไว้ ~2,880/วัน/แท็บ (ทุก 30 วินาที) → รองรับแท็บที่เปิดค้างพร้อมกันได้ราว 30 แท็บ แท็บที่ซ่อนอยู่ไม่นับ
ถ้าบอทเพิ่มหรือคนดูเยอะขึ้น ให้พิจารณาแผน Workers Paid ($5/เดือน)

## ข้อจำกัดที่ควรรู้

- สมาชิกคือยอดสะสมจากทุกเซิร์ฟเวอร์ (คนที่อยู่หลายเซิร์ฟเวอร์ถูกนับซ้ำ) และอาศัย `member_count` ที่ Discord ส่งมา
- Ping คือ WebSocket latency ของบอท ไม่ใช่ความเร็วเว็บไซต์
- บอทที่ไม่ส่ง Heartbeat เกิน 30 วันจะถูกลบออกจากรายการอัตโนมัติ
- ยังไม่มี Rate limiting ระดับ IP (มีเฉพาะจำกัดความถี่ต่อบอท) ถ้าเปิดใช้จริงจังควรเพิ่ม Cloudflare Rate Limiting Rule
