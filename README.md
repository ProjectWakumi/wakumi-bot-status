# Wakumi Bot Status — คู่มือติดตั้ง

แสดงสถานะ **ออนไลน์ / ออฟไลน์** ของ Discord Bot ในส่วน `02 / PUBLIC BOT PROJECT` บนเว็บไซต์ Wakumi
อัปเดตเองทุก 30 วินาทีโดยไม่ต้องรีเฟรชหน้า

| สถานะบนเว็บ | ความหมาย |
|---|---|
| 🟢 บอทกำลังออนไลน์ | บอทต่อ Discord Gateway อยู่จริง และยังส่ง Heartbeat เข้ามาสด ๆ |
| 🔴 บอทออฟไลน์ | บอทปิดตัวปกติ, หลุดจาก Discord นานเกิน 15 วินาที, หรือเงียบหายไปเกิน 90 วินาที (โปรแกรมค้าง/คอมดับ/เน็ตหลุด) |
| ⚪ ไม่สามารถตรวจสอบสถานะได้ | เว็บเรียก API ไม่ได้ (เน็ต, API ล่ม, ตั้งโดเมนผิด) หรือ API ยังไม่เคยได้รับข้อมูลจากบอทตัวนี้ — **ไม่ใช่การบอกว่าออฟไลน์** |

## โครงสร้างระบบ

```
บอท (รันบนคอมคุณ)  ──ส่ง Heartbeat ทุก 20 วินาที (Bearer Token)──►  Cloudflare Worker (bot-status-api/)
                                                                         │ เก็บสถานะใน Durable Object
เว็บ (Cloudflare Pages)  ◄──ดึง GET /api/status ทุก 30 วินาที (ข้อมูลสาธารณะ)──┘
```

- สถานะมาจากการเชื่อมต่อ Discord จริง: บอทตามดู event ของ Gateway (`on_ready` / `on_resumed` / `on_disconnect`) ไม่ได้ดูแค่ว่าโปรแกรม Python ยังรันอยู่
- ถ้าบอทดับแบบดึงปลั๊ก ไม่มีใครส่งอะไรได้ — Worker จึงถือว่า Offline เองเมื่อไม่ได้รับ Heartbeat เกิน 90 วินาที (ตัวเว็บจึงตรวจพบภายใน ~2 นาทีในกรณีแย่สุด)
- เว็บไม่มี Token ใด ๆ ใน HTML/JS มีแค่ URL ของ API ซึ่งเป็นข้อมูลสาธารณะ

## ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | หน้าที่ |
|---|---|
| `bot-status-api/index.js`, `wrangler.toml` | API (Cloudflare Worker + Durable Object) |
| `Bot Discord/monitoring/status_reporter.py` | ส่ง Heartbeat จากบอท (โหลดผ่าน `EXTENSIONS` ใน `main.py` แล้ว) |
| `WebPage-main/bot-status.js` | ดึงสถานะและอัปเดตการ์ดบนเว็บ |
| `WebPage-main/index.html` | บล็อก `id="botStatusSection"` ในส่วนบอท (ตั้ง `data-api-url`, `data-bot-id`) |
| `WebPage-main/style.css` | สไตล์การ์ด (ท้ายไฟล์ ส่วน `Bot Live Status`) |
| `WebPage-main/dist/…` | สำเนาที่แพตช์ไว้ให้เท่านั้น ดูหัวข้อ "เว็บไซต์" ด้านล่าง |

## ติดตั้ง

### 1) Worker

```bash
cd bot-status-api
npm install
npx wrangler login
npx wrangler deploy
```

ได้ URL เช่น `https://wakumi-bot-status.<ชื่อบัญชี>.workers.dev` (ของคุณคือ `wakumi-bot-status.wakumi.workers.dev`)

ตั้ง Token ของบอท (key = Discord Application ID ของบอท, value = token ที่สร้างเองสำหรับระบบนี้ **ห้ามใช้ Discord Bot Token**):

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
npx wrangler secret put BOT_TOKENS
# วาง: {"1438439831502979082":"<token ที่เพิ่งสร้าง>"}
```

> ⚠️ ใช้ token ยาวและสุ่มตามคำสั่งด้านบนเท่านั้น **ห้ามใช้ Application ID ของบอทเป็น token** เพราะ ID นี้เปิดเผยอยู่แล้วในลิงก์เชิญบอทบนเว็บ ใครก็ปลอม Heartbeat ให้เว็บขึ้น 🟢 ทั้งที่บอทดับได้ ค่าเดียวกันนี้ต้องใส่ใน `.env` ของบอทด้วย (บอทจะเตือนใน log ถ้า token สั้นกว่า 24 ตัวหรือเป็น Application ID)

ถ้าแก้ `index.js` หรือ `wrangler.toml` ต้อง `npx wrangler deploy` ใหม่ทุกครั้ง

### 2) บอท

ใน `Bot Discord/.env` (ใส่ URL ต่อท้ายด้วย `/api/heartbeat` หรือไม่ใส่ก็ได้):

```
STATUS_API_URL=https://wakumi-bot-status.wakumi.workers.dev
STATUS_API_TOKEN=<token เดียวกับที่ใส่ใน BOT_TOKENS>
STATUS_BOT_NAME=KaoHorm
```

รีสตาร์ตบอท แล้วใน log ต้องเห็น `เปิดการรายงานสถานะไปยัง ... ทุก 20 วินาที`

ถ้าไม่ตั้งค่า หรือ API ล่ม บอทยังทำงานตามปกติ (แค่บันทึกคำเตือนใน log)

### 3) เว็บไซต์

- `index.html` → บล็อก `id="botStatusSection"` ตั้งค่าไว้แล้ว: `data-api-url="https://wakumi-bot-status.wakumi.workers.dev"` และ `data-bot-id="1438439831502979082"` (ตรงกับลิงก์เชิญบอท)
- **โดเมนเว็บต้องอยู่ใน `ALLOWED_ORIGINS`** ของ `wrangler.toml` (ค่าเริ่มต้น `https://wakumi.pages.dev`) ถ้าเปิดเว็บจากโดเมนอื่น (โดเมนของคุณเอง, ลิงก์พรีวิว) ให้เพิ่มแล้ว `npx wrangler deploy` ใหม่ ไม่เช่นนั้นเว็บจะขึ้น ⚪ เสมอ
- วางไฟล์ในโฟลเดอร์ `WebPage-main` ทับของเดิมแล้ว deploy ตามปกติ
- `dist/` เป็นสำเนา build เก่าของเว็บ (เนื้อหาไม่ตรงกับไฟล์ราก) ผมแพตช์ส่วนสถานะเข้าไปให้ด้วยเพื่อให้ใช้ได้ทั้งสองทาง แต่ถ้าคุณ deploy จาก `dist/` ควรคัดลอกไฟล์รากเข้า `dist/` ให้เป็นปัจจุบัน

## ทดสอบหลังติดตั้ง

PowerShell:

```powershell
Invoke-RestMethod https://wakumi-bot-status.wakumi.workers.dev/api/status
```

1. เปิดบอท → รอ ~20 วินาที → ผลลัพธ์ต้องมีบอทที่ `online: True`
2. เปิดเว็บ ดูการ์ดสถานะระหว่างข้อมูลบอทกับปุ่ม "เชิญบอท" → ต้องเป็น 🟢
3. ปิดบอทปกติ (Ctrl+C) → 🔴 ภายในรอบดึงถัดไป (≤ 30 วินาที) โดยไม่ต้องรีเฟรช
4. ปิดแบบดึงปลั๊ก/ปิดโปรแกรมแรง ๆ → 🔴 ภายใน ~2 นาที
5. ปิดอินเทอร์เน็ตของเครื่องที่เปิดเว็บ หรือตั้ง `data-api-url` ผิดชั่วคราว → ⚪

ชุดทดสอบอัตโนมัติของ API (ยิงใส่ Worker จริงหรือ `wrangler dev`):

```bash
BASE_URL=http://127.0.0.1:8787 BOT_ID=<id> BOT_TOKEN=<token> node smoke.mjs
```

⚠️ สคริปต์เขียนข้อมูลจริงลง Worker ที่ยิงใส่ ใช้ `npx wrangler dev` พร้อมไฟล์ `.dev.vars` (`BOT_TOKENS={"<id>":"<token ทดสอบ>"}`) แทนการยิงใส่ Worker จริง

## แก้ปัญหา

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| เว็บขึ้น ⚪ ตลอด | โดเมนเว็บไม่อยู่ใน `ALLOWED_ORIGINS` (ดู Console ในเบราว์เซอร์จะเห็นข้อความ CORS/403) หรือ `data-api-url` ผิด |
| เว็บขึ้น ⚪ "ยังไม่มีข้อมูลสถานะของบอทนี้" | API ยังไม่เคยได้ Heartbeat จากบอท: ตรวจ log บอท, `STATUS_API_TOKEN`, และ Application ID ใน `BOT_TOKENS` |
| log บอทขึ้น `STATUS_API_TOKEN อ่อนเกินไป` | ตั้ง token ใหม่ที่ยาวและสุ่ม แล้วอัปเดตทั้ง `.env` และ `npx wrangler secret put BOT_TOKENS` |
| log บอทขึ้น `Status API ปฏิเสธ Token (401)` | `STATUS_API_TOKEN` ไม่ตรงกับค่าใน `BOT_TOKENS` หรือ ID ไม่ตรง |
| log บอทขึ้น `Status API ตอบ HTTP 404` | URL ผิด ต้องเป็นรากของ Worker (ต่อท้าย `/api/heartbeat` ได้) |
| เว็บขึ้น 🔴 ทั้งที่บอทออนไลน์ | บอทส่ง Heartbeat ไม่ถึง (ดู log) หรือเวลาของ Worker/บอทผิดปกติ |

## โควตาแผนฟรีของ Cloudflare (ประมาณการ)

Worker 100,000 คำขอ/วัน: Heartbeat ~4,320/วัน/บอท + เว็บที่เปิดค้าง ~2,880/วัน/แท็บ (ทุก 30 วินาที) รองรับแท็บที่เปิดค้างพร้อมกันได้ราว 30 แท็บ แท็บที่ถูกซ่อนจะหยุดดึงเองและไม่นับโควตา

## ข้อจำกัดที่ควรรู้

- จำนวนสมาชิกที่ API เก็บเป็นยอดรวมจากทุกเซิร์ฟเวอร์ (คนอยู่หลายเซิร์ฟเวอร์ถูกนับซ้ำ) ส่วน Ping คือ WebSocket latency ของบอท ไม่ใช่ความเร็วเว็บไซต์ (เว็บแสดงเฉพาะ Ping และจำนวนเซิร์ฟเวอร์)
- ยังไม่มี Rate limit ระดับ IP (มีเฉพาะจำกัดความถี่ต่อบอท) ถ้าเปิดใช้จริงจังควรเพิ่ม Cloudflare Rate Limiting Rule
- ขอบเขตการตรวจจับ: ถ้า Discord ล่มทั้งระบบแต่เน็ตคุณปกติ เว็บจะขึ้น 🔴 ภายใน ~35–50 วินาที (grace 15 วินาที + รอบส่ง 20 วินาที + รอบดึงเว็บ)
